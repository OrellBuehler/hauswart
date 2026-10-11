import { eq } from "drizzle-orm";
import { triggerSchema } from "$lib/tasks/engine";
import { assetIdOfOdometerKey } from "$lib/vehicles/odometer";
import { dateInZone, householdTimeZone } from "$lib/server/config";
import { assets, tasks } from "$lib/server/db";
import { onEvent } from "$lib/server/events";
import { writeOdometer, removeReadingsOfSource } from "./odometer";
import { readingOnOrBefore } from "./summary";

type RecordedPayload = Parameters<
  Parameters<typeof onEvent<"completionRecorded">>[1]
>[0];
type RevokedPayload = Parameters<
  Parameters<typeof onEvent<"completionRevoked">>[1]
>[0];

/** The vehicle a task counts the odometer of, if it does and the vehicle exists. */
function odometerVehicleOf(
  ctx: RecordedPayload["ctx"],
  taskId: string,
): string | null {
  const task = ctx.db
    .select({ trigger: tasks.trigger })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .get();
  const trigger = triggerSchema.safeParse(task?.trigger);
  if (!trigger.success || trigger.data.type !== "counter_delta") return null;
  const assetId = assetIdOfOdometerKey(trigger.data.entityId);
  if (!assetId) return null;
  const asset = ctx.db
    .select({ kind: assets.kind })
    .from(assets)
    .where(eq(assets.id, assetId))
    .get();
  return asset?.kind === "vehicle" ? assetId : null;
}

/**
 * Completing a task that counts a vehicle's odometer with a reading (the service done at 84,200 km)
 * records that reading for the vehicle, dated the day of the completion (today at the latest). A reading that merely
 * repeats the newest one (the counter snapshot a completion takes by itself) adds nothing. A
 * reading lower than the one before is refused like any other, which stops the completion too:
 * it is reported on `counterValue`.
 */
export function onCompletionRecorded({
  ctx,
  completion,
}: RecordedPayload): void {
  if (completion.counterValue === null) return;
  const assetId = odometerVehicleOf(ctx, completion.taskId);
  if (!assetId) return;
  // A completion may be a few minutes ahead of the clock, which at midnight is already tomorrow;
  // a reading is never dated in the future.
  const today = dateInZone(ctx.now, householdTimeZone());
  const date =
    completion.completedDate > today ? today : completion.completedDate;
  // The reading of that day already says it (the snapshot a completion takes by itself, or the
  // value somebody typed that the odometer showed then): nothing to add.
  if (
    readingOnOrBefore(ctx.db, assetId, date)?.value === completion.counterValue
  )
    return;
  writeOdometer(
    ctx,
    {
      assetId,
      date,
      value: completion.counterValue,
      source: "completion",
      sourceId: completion.id,
      createdBy: completion.userId,
    },
    { date: "completedAt", value: "counterValue", asset: "counterValue" },
  );
}

/** Undoing the completion takes its reading back. */
export function onCompletionRevoked({ ctx, completion }: RevokedPayload): void {
  removeReadingsOfSource(ctx, "completion", completion.id);
}

export function registerVehicleEvents(): void {
  onEvent("completionRecorded", onCompletionRecorded);
  onEvent("completionRevoked", onCompletionRevoked);
}
