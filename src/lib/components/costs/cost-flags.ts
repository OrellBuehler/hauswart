import type { CostEntry } from "$lib/api/schemas/costs";

/** Whether an entry carries a badge (review, refund, equity, imported): rows only make room for the badges when it does. */
export function hasCostFlags(
  cost: Pick<
    CostEntry,
    "amountMinor" | "countsAsExpense" | "source" | "reviewNeeded"
  >,
): boolean {
  return (
    cost.reviewNeeded ||
    cost.amountMinor < 0 ||
    !cost.countsAsExpense ||
    cost.source !== "manual"
  );
}
