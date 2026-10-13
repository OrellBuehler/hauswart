import { and, eq, sql } from "drizzle-orm";
import { AI_TASK_CLAIM_MINUTES } from "$lib/api/schemas/ai-tasks";
import { costConflict } from "$lib/server/costs/conflicts";
import { aiTasks } from "$lib/server/db";
import { invalidField, type ServiceContext } from "$lib/server/service";

/**
 * A booking names the receipt task it is for (`receiptTaskId`): that task has to exist (400 on the field) and still wait
 * for its result (409 `receipt_task_closed`, `details.status` says what became of it), so nothing is booked for a task that was closed by
 * somebody else in the meantime. A module of its own, apart from the rest of the queue, so that the cost service can ask
 * without importing it.
 */
export function assertTaskOpenForBooking(
  ctx: Pick<ServiceContext, "db">,
  taskId: string,
): void {
  const task = ctx.db
    .select({ status: aiTasks.status })
    .from(aiTasks)
    .where(eq(aiTasks.id, taskId))
    .get();
  if (!task) {
    throw invalidField("receiptTaskId", "Receipt task does not exist");
  }
  if (task.status !== "pending") {
    throw costConflict(
      "receipt_task_closed",
      "This receipt task is not waiting any more",
      { status: task.status },
    );
  }
}

const CLAIM_MS = AI_TASK_CLAIM_MINUTES * 60_000;

/** Whether a lease taken at `claimedAt` still lasts at `now`. */
export function claimIsActive(claimedAt: Date | null, now: number): boolean {
  return claimedAt !== null && now < claimedAt.getTime() + CLAIM_MS;
}

/**
 * Marks a pending task as being worked on by `userId` from now on. The person's own lease is renewed and a lapsed one is
 * taken; one that somebody else holds is left alone (a warning for the next client, never a lock). A lease is not a change
 * of the task, so `updatedAt` stays.
 */
export function takeLease(
  ctx: Pick<ServiceContext, "db" | "now">,
  taskId: string,
  userId: string | null,
): void {
  if (userId === null) return;
  const task = ctx.db
    .select({
      status: aiTasks.status,
      claimedByUserId: aiTasks.claimedByUserId,
      claimedAt: aiTasks.claimedAt,
    })
    .from(aiTasks)
    .where(eq(aiTasks.id, taskId))
    .get();
  if (!task || task.status !== "pending") return;
  if (
    claimIsActive(task.claimedAt, ctx.now) &&
    task.claimedByUserId !== userId
  ) {
    return;
  }
  ctx.db
    .update(aiTasks)
    .set({
      claimedByUserId: userId,
      claimedAt: new Date(ctx.now),
      updatedAt: sql`${aiTasks.updatedAt}`,
    })
    .where(and(eq(aiTasks.id, taskId), eq(aiTasks.status, "pending")))
    .run();
}
