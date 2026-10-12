import type { CostsSummary } from "$lib/api/schemas/costs";

/** Whether any split entry with a payer exists, so that "all square" means something. */
export function hasSettlementData(
  summary: Pick<CostsSummary, "people">,
): boolean {
  return summary.people.some((p) => p.paidMinor !== 0 || p.shareMinor !== 0);
}

/**
 * The sum of the tax breakdown. Only tax relevant books are in it, so it is not the year's expense total: the shares of
 * its rows are measured against this, or they would add up to less than 100%.
 */
export function taxTotal(summary: Pick<CostsSummary, "byDeductible">): number {
  return summary.byDeductible.reduce((sum, row) => sum + row.totalMinor, 0);
}

/** A part of a whole in basis points (what `formatPercent` takes), rounded; `null` without a positive whole. */
export function shareBps(value: number, whole: number): number | null {
  return whole > 0 ? Math.round((value / whole) * 10_000) : null;
}
