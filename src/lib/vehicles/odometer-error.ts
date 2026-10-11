import type { OdometerUnit } from "$lib/api/enums";
import { isApiError } from "$lib/api/errors";
import {
  odometerRefusalDetailsSchema,
  type OdometerRefusalDetails,
} from "$lib/api/schemas/vehicles";
import { formatDay } from "$lib/format";
import { m } from "$lib/paraglide/messages";
import { formatOdometer } from "./format";

/** Why the server refused a reading and which neighbouring reading is in the way (`details` of the 400). */
export type RefusedReading = OdometerRefusalDetails;

/**
 * The structured reason of a refused reading: a 400 whose `details` say `lower_than_previous` or
 * `higher_than_next`, with the neighbouring reading. These are the two refusals `force` can lift (a
 * replaced instrument cluster); every other problem with a reading has no code and gives null. The
 * English field error is never read. `field` is the request field this form shows the reading under
 * (`value`, `odometer` or `counterValue`): a refusal reported on another field is not this form's.
 */
export function refusedReading(
  err: unknown,
  field?: string,
): RefusedReading | null {
  if (!isApiError(err) || err.code !== "invalid_request") return null;
  const parsed = odometerRefusalDetailsSchema.safeParse(err.details);
  if (!parsed.success) return null;
  return field === undefined || parsed.data.field === field
    ? parsed.data
    : null;
}

export function readingOwner(
  err: unknown,
): { source: string; sourceId: string | null } | null {
  if (!isApiError(err) || err.code !== "conflict") return null;
  const details = err.details as
    { source?: unknown; sourceId?: unknown } | undefined;
  if (typeof details?.source !== "string") return null;
  return {
    source: details.source,
    sourceId: typeof details.sourceId === "string" ? details.sourceId : null,
  };
}

export function canDeleteReading(reading: { source: string }): boolean {
  return reading.source === "manual";
}

/** The refusal in words, with the reading in the way; `canForce` adds that the form can save it anyway. */
export function refusedMessage(
  refused: RefusedReading,
  unit: OdometerUnit,
  options: { canForce?: boolean } = {},
): string {
  const values = {
    value: formatOdometer(refused.reading.value, unit),
    date: formatDay(refused.reading.date),
  };
  if (refused.code === "lower_than_previous") {
    return options.canForce
      ? m.vehicle_odometer_lower(values)
      : m.vehicle_odometer_refused_lower(values);
  }
  return options.canForce
    ? m.vehicle_odometer_higher(values)
    : m.vehicle_odometer_refused_higher(values);
}

/** The short wording under the field of a refusal. */
export function refusedShort(refused: RefusedReading): string {
  return refused.code === "lower_than_previous"
    ? m.vehicle_odometer_lower_short()
    : m.vehicle_odometer_higher_short();
}
