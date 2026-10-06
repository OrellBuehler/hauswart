import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { ApiError } from "$lib/api/errors";
import {
  notificationDeliveries,
  notifications,
  taskCompletions,
  tasks,
} from "$lib/server/db";
import type { ServiceContext } from "$lib/server/service";
import { completeTask } from "$lib/server/tasks/completions";
import { getTask } from "$lib/server/tasks/tasks";

/** The action id of the "done" button: `HW_DONE_<token>`. Phones post it back verbatim. */
export const ACTION_DONE_PREFIX = "HW_DONE_";
export const ACTION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const TOKEN_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function hashActionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 24 random bytes, base64url (32 characters); only its hash is stored. */
export function mintActionToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString("base64url");
  return { token, hash: hashActionToken(token) };
}

/** The token inside a `HW_DONE_<token>` action id, or null for any other (user-controlled) input. */
export function parseDoneAction(action: unknown): string | null {
  if (typeof action !== "string" || !action.startsWith(ACTION_DONE_PREFIX)) {
    return null;
  }
  const token = action.slice(ACTION_DONE_PREFIX.length);
  return TOKEN_RE.test(token) ? token : null;
}

export interface ActionResult {
  taskId: string;
  completionId: string;
  /** True when the token had been used before and the first completion is returned again. */
  replayed: boolean;
}

const gone = (message: string) => new ApiError("gone", message);

/**
 * Carries out a "done" tap on a notification. The token resolves to the task
 * occurrence the notification was about and to the person it was sent to; the
 * completion is attributed to that person (source `notification`), not to the
 * token that delivered the request. A token that is unknown is 404; one that
 * expired, whose task is gone or whose occurrence was settled otherwise is
 * 410. Tapping twice (or a retried request) answers with the first completion
 * (`replayed`) as long as it still stands; once it was undone the token is
 * 410.
 */
export async function performDoneAction(
  ctx: ServiceContext,
  action: string,
): Promise<ActionResult> {
  const token = parseDoneAction(action);
  if (token === null) throw new ApiError("not_found", "Unknown action");
  const hash = hashActionToken(token);
  const delivery = ctx.db
    .select()
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.actionTokenHash, hash))
    .get();
  if (!delivery) throw new ApiError("not_found", "Unknown action");

  if (delivery.actionUsedAt) {
    const completion = delivery.actionCompletionId
      ? ctx.db
          .select()
          .from(taskCompletions)
          .where(eq(taskCompletions.id, delivery.actionCompletionId))
          .get()
      : undefined;
    if (!completion || completion.revokedAt) {
      throw gone("This action has already been used");
    }
    return {
      taskId: completion.taskId,
      completionId: completion.id,
      replayed: true,
    };
  }
  if (
    !delivery.actionExpiresAt ||
    delivery.actionExpiresAt.getTime() <= ctx.now
  ) {
    throw gone("This action has expired");
  }

  const notification = ctx.db
    .select()
    .from(notifications)
    .where(eq(notifications.id, delivery.notificationId))
    .get();
  if (!notification?.taskId || !notification.userId) {
    throw gone("This notification has no task to complete");
  }
  const task = ctx.db
    .select({ id: tasks.id, archivedAt: tasks.archivedAt })
    .from(tasks)
    .where(eq(tasks.id, notification.taskId))
    .get();
  if (!task || task.archivedAt) throw gone("The task no longer exists");
  const current = getTask(ctx, task.id).state?.occurrenceKey ?? null;
  if (delivery.occurrenceKey && current !== delivery.occurrenceKey) {
    throw gone("This has already been dealt with");
  }

  const result = await completeTask(ctx, task.id, {
    kind: "done",
    source: "notification",
    userId: notification.userId,
    ...(delivery.occurrenceKey
      ? { occurrenceKey: delivery.occurrenceKey }
      : {}),
    idempotencyKey: `notification:${hash}`,
  });
  ctx.db
    .update(notificationDeliveries)
    .set({
      actionUsedAt: new Date(ctx.now),
      actionCompletionId: result.completion.id,
    })
    .where(
      and(
        eq(notificationDeliveries.actionTokenHash, hash),
        isNull(notificationDeliveries.actionUsedAt),
      ),
    )
    .run();
  return {
    taskId: task.id,
    completionId: result.completion.id,
    replayed: result.replayed,
  };
}
