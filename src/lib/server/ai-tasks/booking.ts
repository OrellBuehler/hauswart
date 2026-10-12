import { eq } from "drizzle-orm";
import { aiTasks } from "$lib/server/db";
import {
  conflict,
  invalidField,
  type ServiceContext,
} from "$lib/server/service";

/**
 * A booking names the receipt task it is for (`receiptTaskId`): that task has to exist (400 on the field) and still wait
 * for its result (409, `details.status` says what became of it), so nothing is booked for a task that was closed by
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
    throw conflict("This receipt task is not waiting any more", {
      status: task.status,
    });
  }
}
