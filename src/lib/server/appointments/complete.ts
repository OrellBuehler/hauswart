import { and, eq } from "drizzle-orm";
import type { CompletionSource } from "$lib/api/enums";
import { appointments, taskCompletions } from "$lib/server/db";
import { conflict, type ServiceContext } from "$lib/server/service";
import {
  completeTask,
  getCompletion,
  type CompletionRecord,
} from "$lib/server/tasks/completions";
import { getTask, type TaskRecord } from "$lib/server/tasks/tasks";
import { getAppointment, type AppointmentRecord } from "./appointments";

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
 * Marks the appointment done and, when it belongs to a task, completes that task's occurrence (the
 * appointment's own `occurrenceKey`, else the one the task shows) with the key `appointment:<id>`, so
 * a repeated request completes nothing twice and answers with the first completion.
 *
 * The task is left alone, and `completion` is null, when it is archived or when the appointment is
 * for an occurrence that has been settled in the meantime (completing it again would count the work
 * twice). A cancelled appointment cannot be completed (409); a done one answers as a repeat.
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
    } else if (
      !task.archivedAt &&
      (appointment.occurrenceKey === null ||
        task.state?.occurrenceKey === appointment.occurrenceKey)
    ) {
      const result = await completeTask(ctx, appointment.taskId, {
        kind: "done",
        source: input.source,
        userId: input.userId,
        note: input.note,
        occurrenceKey: appointment.occurrenceKey ?? undefined,
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
