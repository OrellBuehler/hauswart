import type { CostsSummary } from "$lib/api/schemas/costs";

/** Whether any split entry with a payer exists, so that "all square" means something. */
export function hasSettlementData(
  summary: Pick<CostsSummary, "people">,
): boolean {
  return summary.people.some((p) => p.paidMinor !== 0 || p.shareMinor !== 0);
}
