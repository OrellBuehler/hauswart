import type { WarrantyStatus } from "$lib/api/enums";
import type { Warranty } from "$lib/api/schemas/warranties";

const ORDER: Record<WarrantyStatus, number> = {
  expiring: 0,
  valid: 1,
  expired: 2,
};

/** Warranties that need attention first (soonest end first), then valid ones, then expired ones (latest first). */
export function sortWarranties(warranties: Warranty[]): Warranty[] {
  return [...warranties].sort(
    (a, b) =>
      ORDER[a.status] - ORDER[b.status] ||
      (a.status === "expired"
        ? b.effectiveUntil.localeCompare(a.effectiveUntil)
        : a.effectiveUntil.localeCompare(b.effectiveUntil)) ||
      a.assetName.localeCompare(b.assetName),
  );
}
