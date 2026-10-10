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
