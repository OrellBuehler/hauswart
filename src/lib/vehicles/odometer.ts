/**
 * The signal key under which a vehicle's latest odometer reading is stored, and the entity id a
 * `counter_delta` trigger reads it by. Not an entity id of any outside system: the adapters never
 * ask for it (Home Assistant ids look like `sensor.name`).
 */
export const ODOMETER_KEY_PREFIX = "odometer:";

export function odometerSignalKey(assetId: string): string {
  return `${ODOMETER_KEY_PREFIX}${assetId}`;
}

export function isOdometerKey(key: string): boolean {
  return (
    key.startsWith(ODOMETER_KEY_PREFIX) &&
    key.length > ODOMETER_KEY_PREFIX.length
  );
}

/** The asset an odometer key belongs to, or null for any other key. */
export function assetIdOfOdometerKey(key: string): string | null {
  return isOdometerKey(key) ? key.slice(ODOMETER_KEY_PREFIX.length) : null;
}

/** The vehicle a task's trigger counts the odometer of (a `counter_delta` on `odometer:<asset id>`), else null. */
export function odometerAssetOfTrigger(
  trigger: { type?: unknown; entityId?: unknown } | null | undefined,
): string | null {
  return trigger?.type === "counter_delta" &&
    typeof trigger.entityId === "string"
    ? assetIdOfOdometerKey(trigger.entityId)
    : null;
}

/**
 * What a task at hand says about the vehicle whose odometer it counts on: the id, `null` for a task
 * that counts on none, `undefined` when it says nothing (neither the dashboard's `odometerAssetId`
 * nor the trigger came with it). `odometerAssetId` wins; the dashboard computed it from the stored trigger.
 */
export function knownOdometerAsset(task: {
  odometerAssetId?: string | null | undefined;
  trigger?: { type?: unknown; entityId?: unknown } | null | undefined;
}): string | null | undefined {
  if (task.odometerAssetId !== undefined) return task.odometerAssetId;
  return task.trigger ? odometerAssetOfTrigger(task.trigger) : undefined;
}
