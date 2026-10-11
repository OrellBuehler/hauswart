import type { OdometerUnit } from "$lib/api/enums";
import { isApiError } from "$lib/api/errors";
import { formatDay } from "$lib/format";
import { m } from "$lib/paraglide/messages";
import { formatOdometer } from "./format";

/** What the server said about the reading a new one is lower than; `null` parts when it could not be read. */
export type LowerThanReading = {
  value: number | null;
  date: string | null;
};

const LOWER =
  /^Lower than the reading of (\d+(?:\.\d+)?) on (\d{4}-\d{2}-\d{2})/;

/**
 * Whether an API error is the refusal of a reading lower than the one before it: a 400 on the
 * value field whose message starts "Lower than the reading of <value> on <date>". That is the one
 * refusal `force` can lift (a replaced instrument cluster), so the form offers "save anyway" for
 * it and for nothing else. `field` is the request field the server names: `value` for a reading,
 * `counterValue` for a completion.
 */
export function lowerThanReading(
  err: unknown,
  field = "value",
): LowerThanReading | null {
  if (!isApiError(err) || err.code !== "invalid_request") return null;
  const messages = (
    err.details as
      { body?: { fieldErrors?: Record<string, unknown> } } | undefined
  )?.body?.fieldErrors?.[field];
  const first = Array.isArray(messages) ? messages[0] : undefined;
  if (
    typeof first !== "string" ||
    !first.startsWith("Lower than the reading")
  ) {
    return null;
  }
  const match = LOWER.exec(first);
  return match
    ? { value: Number(match[1]), date: match[2] ?? null }
    : { value: null, date: null };
}

export type RefusedReading = {
  direction: "lower" | "higher";
  value: number | null;
  date: string | null;
};

const REFUSED =
  /^(Lower than the reading|Higher than the later reading)(?: of (\d+(?:\.\d+)?) on (\d{4}-\d{2}-\d{2}))?/;

export function refusedReading(
  err: unknown,
  field: string,
): RefusedReading | null {
  if (!isApiError(err) || err.code !== "invalid_request") return null;
  const messages = (
    err.details as
      { body?: { fieldErrors?: Record<string, unknown> } } | undefined
  )?.body?.fieldErrors?.[field];
  const first = Array.isArray(messages) ? messages[0] : undefined;
  if (typeof first !== "string") return null;
  const match = REFUSED.exec(first);
  if (!match) return null;
  return {
    direction: match[1] === "Lower than the reading" ? "lower" : "higher",
    value: match[2] === undefined ? null : Number(match[2]),
    date: match[3] ?? null,
  };
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

export function refusedMessage(
  refused: RefusedReading,
  unit: OdometerUnit,
): string {
  if (refused.value === null || refused.date === null) {
    return m.vehicle_odometer_refused_unknown();
  }
  const values = {
    value: formatOdometer(refused.value, unit),
    date: formatDay(refused.date),
  };
  return refused.direction === "lower"
    ? m.vehicle_odometer_refused_lower(values)
    : m.vehicle_odometer_refused_higher(values);
}
