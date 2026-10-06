import { eq, sql } from "drizzle-orm";
import { onEvent } from "$lib/server/events";
import { partMovements, taskParts } from "$lib/server/db";
import { applyMovement } from "./parts";

/**
 * Completing a task takes the linked parts out of stock (never below zero:
 * the shelf count may simply be out of date) and leaves a `used` movement per
 * part, tied to the completion. Skipping a task uses nothing.
 */
export function onCompletionRecorded(
  payload: Parameters<Parameters<typeof onEvent<"completionRecorded">>[1]>[0],
): void {
  const { ctx, completion } = payload;
  if (completion.kind !== "done") return;
  const links = ctx.db
    .select({ partId: taskParts.partId, qty: taskParts.qty })
    .from(taskParts)
    .where(eq(taskParts.taskId, completion.taskId))
    .all();
  for (const link of links) {
    applyMovement(
      ctx,
      link.partId,
      {
        delta: -link.qty,
        reason: "used",
        userId: completion.userId,
        completionId: completion.id,
      },
      { clamp: true },
    );
  }
}

/** Undoing the completion puts back exactly what it took out, as a correction. */
export function onCompletionRevoked(
  payload: Parameters<Parameters<typeof onEvent<"completionRevoked">>[1]>[0],
): void {
  const { ctx, completion, revokedBy } = payload;
  const net = ctx.db
    .select({
      partId: partMovements.partId,
      delta: sql<number>`sum(${partMovements.delta})`,
    })
    .from(partMovements)
    .where(eq(partMovements.completionId, completion.id))
    .groupBy(partMovements.partId)
    .all();
  for (const row of net) {
    const delta = Number(row.delta);
    if (delta === 0) continue;
    applyMovement(ctx, row.partId, {
      delta: -delta,
      reason: "correction",
      userId: revokedBy,
      completionId: completion.id,
    });
  }
}

export function registerPartsEvents(): void {
  onEvent("completionRecorded", onCompletionRecorded);
  onEvent("completionRevoked", onCompletionRevoked);
}
