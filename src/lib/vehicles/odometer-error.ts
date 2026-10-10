import { isApiError } from "$lib/api/errors";

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
