import { and, eq } from "drizzle-orm";
import type { CompletionSource } from "$lib/api/enums";
import { pinnableOccurrenceKey } from "$lib/appointments/occurrence";
import { lastDay } from "$lib/appointments/when";
import { householdTimeZone } from "$lib/server/config";
import { appointments, taskCompletions } from "$lib/server/db";
import { conflict, type ServiceContext } from "$lib/server/service";
import {
  completeTask,
  getCompletion,
  type CompletionRecord,
} from "$lib/server/tasks/completions";
import { getTask, type TaskRecord } from "$lib/server/tasks/tasks";
import { getAppointment, whenOf, type AppointmentRecord } from "./appointments";

/**
 * The idempotency key of the task completion an appointment makes. The first is
 * `appointment:<id>`; a later one (after that completion was undone and the appointment completed
 * again) is `appointment:<id>:<n>`, since a key is bound to its first completion for good.
 */
export function appointmentKey(id: string, n = 1): string {
  return n === 1 ? `appointment:${id}` : `appointment:${id}:${n}`;
}

/** The completion of this appointment that still stands, else the key the next one is made under. */
function keySlot(
  ctx: Pick<ServiceContext, "db">,
  appointmentId: string,
  taskId: string,
): { key: string; standingId: string | null } {
  for (let n = 1; ; n++) {
    const key = appointmentKey(appointmentId, n);
    const row = ctx.db
      .select({
        id: taskCompletions.id,
        taskId: taskCompletions.taskId,
        revokedAt: taskCompletions.revokedAt,
      })
      .from(taskCompletions)
      .where(eq(taskCompletions.idempotencyKey, key))
      .get();
    if (!row) return { key, standingId: null };
    // Undone, or made for the task the appointment used to belong to: that key is used up.
    if (!row.revokedAt && row.taskId === taskId) {
      return { key, standingId: row.id };
    }
  }
}

/** What the engine reports for the occurrence it shows when that one is handled already. */
const HANDLED_REASONS: readonly string[] = [
  "completed",
  "skipped",
  "acknowledged",
];

/**
 * Whether completing the appointment may complete the occurrence the task shows. It may when that
 * occurrence is the one the appointment is for and the engine does not report it as handled; it never
 * may when the task shows one the appointment could not have been for:
 *
 * - Pinned appointment (the normal case: creating one for a task, or moving it to one, pins the
 *   occurrence the task showed): the task must still show that occurrence. If it moved on, somebody
 *   settled it (or it was missed) and the one shown is a later cycle.
 * - Unpinned appointment (the task showed none, an explicit null, an older row): nothing says what it
 *   was for, so it settles the occurrence shown only if that is dated and fell due on or before the
 *   last day of the appointment. A later one belongs to a cycle the visit came before; an undated
 *   one has nothing to compare; a task that shows none has nothing to settle.
 *
 * "Handled" is the engine's verdict (`completed`, `skipped`, `acknowledged`), not a lookup of
 * completions with that key: a one-off, warranty or bill task keeps its key when it is done, so the key
 * does not tell, while a task that wants several completions in a period (`min_per_period`) shows the
 * same key until the last one, so a completion with that key does not mean it is settled.
 */
function mayComplete(
  appointment: AppointmentRecord,
  task: TaskRecord,
): boolean {
  const state = task.state;
  if (task.archivedAt || !state) return false;
  if (appointment.occurrenceKey !== null) {
    if (state.occurrenceKey !== appointment.occurrenceKey) return false;
  } else {
    if (pinnableOccurrenceKey(state.occurrenceKey) === null) return false;
    const day = lastDay(whenOf(appointment), householdTimeZone());
    if (state.dueDate === null || state.dueDate > day) return false;
  }
  return !state.reasons.some((reason) => HANDLED_REASONS.includes(reason));
}

export interface CompleteAppointmentInput {
  userId: string | null;
  source: CompletionSource;
  /** Goes on the completion of the task. */
  note?: string | null;
  /** ms since epoch, for the completion of the task; defaults to now. */
  completedAt?: number;
}

export interface CompleteAppointmentResult {
  appointment: AppointmentRecord;
  /** The completion of the task that stands for this appointment; null when none was made (see below). */
  completion: CompletionRecord | null;
  task: TaskRecord | null;
  /** Nothing new was written: the appointment was done already and its completion (if any) stands. */
  replayed: boolean;
}

/**
 * Marks the appointment done and, when it belongs to a task, completes the occurrence the appointment
 * is for (see `mayComplete`) with the key `appointment:<id>`, so a repeated request completes nothing
 * twice and answers with the first completion.
 *
 * The task is left alone, and `completion` is null, when it is archived or when the occurrence the
 * appointment is for has been settled in the meantime: completing it again would count the work twice,
 * and completing the next one would skip a cycle. A cancelled appointment cannot be completed (409);
 * a done one answers as a repeat.
 *
 * Undoing the task's completion later does not reopen the appointment: it took place either way.
 * Setting the status back to `planned` does not undo the completion either.
 */
export async function completeAppointment(
  ctx: ServiceContext,
  id: string,
  input: CompleteAppointmentInput,
): Promise<CompleteAppointmentResult> {
  const appointment = getAppointment(ctx, id);
  if (appointment.status === "cancelled") {
    throw conflict(
      "A cancelled appointment cannot be completed; set its status to planned first.",
    );
  }

  let completion: CompletionRecord | null = null;
  let task: TaskRecord | null = null;
  let replayedCompletion = true;
  if (appointment.taskId) {
    const slot = keySlot(ctx, id, appointment.taskId);
    task = getTask(ctx, appointment.taskId);
    if (slot.standingId) {
      completion = getCompletion(ctx, slot.standingId);
    } else if (mayComplete(appointment, task)) {
      const result = await completeTask(ctx, appointment.taskId, {
        kind: "done",
        source: input.source,
        userId: input.userId,
        note: input.note,
        occurrenceKey: task.state!.occurrenceKey,
        completedAt: input.completedAt,
        idempotencyKey: slot.key,
      });
      completion = result.completion;
      task = result.task;
      replayedCompletion = result.replayed;
    }
  }

  const wasDone = appointment.status === "done";
  if (!wasDone) {
    ctx.db
      .update(appointments)
      .set({ status: "done", updatedAt: new Date(ctx.now) })
      .where(and(eq(appointments.id, id), eq(appointments.status, "planned")))
      .run();
  }
  return {
    appointment: wasDone ? appointment : getAppointment(ctx, id),
    completion,
    // Read again: the task shows its next appointment, which this one no longer is.
    task: task && getTask(ctx, task.id),
    replayed: wasDone && replayedCompletion,
  };
}
