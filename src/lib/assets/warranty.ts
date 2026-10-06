import { diffDays, maxDate } from "$lib/dates";

export const WARRANTY_EXPIRING_DAYS = 90;

export const WARRANTY_STATUSES = [
  "valid",
  "expiring",
  "expired",
  "unknown",
] as const;
export type WarrantyStatus = (typeof WARRANTY_STATUSES)[number];

export type WarrantyInfo = {
  status: WarrantyStatus;
  /** The date the warranty ends: the later of `warrantyUntil` and `warrantyExtendedUntil`. */
  until: string | null;
  /** Days from today to `until`; negative once expired. */
  daysLeft: number | null;
};

type WarrantyDates = {
  warrantyUntil: string | null;
  warrantyExtendedUntil: string | null;
};

/** Traffic light for an asset's warranty as of `today` (`YYYY-MM-DD`, household time zone). */
export function warrantyStatus(
  asset: WarrantyDates,
  today: string,
): WarrantyInfo {
  const { warrantyUntil, warrantyExtendedUntil } = asset;
  const until =
    warrantyUntil && warrantyExtendedUntil
      ? maxDate(warrantyUntil, warrantyExtendedUntil)
      : (warrantyExtendedUntil ?? warrantyUntil);
  if (!until) return { status: "unknown", until: null, daysLeft: null };
  const daysLeft = diffDays(until, today);
  if (daysLeft < 0) return { status: "expired", until, daysLeft };
  if (daysLeft <= WARRANTY_EXPIRING_DAYS) {
    return { status: "expiring", until, daysLeft };
  }
  return { status: "valid", until, daysLeft };
}
