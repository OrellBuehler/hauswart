const DEFAULT_TIME_ZONE = "Europe/Zurich";

let validated: string | null = null;

/** The household time zone (`HAUSWART_TZ`). Throws a readable error for an unknown zone. */
export function householdTimeZone(): string {
  const zone = process.env.HAUSWART_TZ?.trim() || DEFAULT_TIME_ZONE;
  if (validated === zone) return zone;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
  } catch (cause) {
    throw new Error(
      `HAUSWART_TZ is not a valid IANA time zone. Use a name like ${DEFAULT_TIME_ZONE}.`,
      { cause },
    );
  }
  validated = zone;
  return zone;
}

/** Today's calendar date as `YYYY-MM-DD` in the given zone (never the server zone). */
export function dateInZone(now: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function todayInHouseholdZone(now: number = Date.now()): string {
  return dateInZone(now, householdTimeZone());
}

/** The optional first-run setup token (`HAUSWART_SETUP_TOKEN`); null when unset or blank. */
export function setupToken(): string | null {
  const value = process.env.HAUSWART_SETUP_TOKEN?.trim();
  return value ? value : null;
}
