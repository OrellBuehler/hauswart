import type { CostBudgetPeriod } from "../api/enums";
import {
  BUDGET_WARNING_PERCENT,
  type CostBudgetState,
} from "../api/schemas/cost-budgets";
import { daysInMonth, formatDate } from "../dates";

/** The calendar month (of `year`/`month`) or the calendar year a budget is measured for, as `from` to `to`, both included. */
export function budgetRange(
  period: CostBudgetPeriod,
  year: number,
  month: number,
): { from: string; to: string } {
  if (period === "year") {
    return { from: formatDate(year, 1, 1), to: formatDate(year, 12, 31) };
  }
  return {
    from: formatDate(year, month, 1),
    to: formatDate(year, month, daysInMonth(year, month)),
  };
}

/**
 * What is left of a budget and how far it is used. The percentage is rounded down and 0 while nothing net was spent; the
 * state is `warning` from `warningPercent` of the amount and `exceeded` once the whole amount is spent, worked out on
 * the amounts, not on the rounded percentage.
 */
export function budgetUsage(
  spentMinor: number,
  amountMinor: number,
  warningPercent = BUDGET_WARNING_PERCENT,
): { remainingMinor: number; percentUsed: number; state: CostBudgetState } {
  const used = Math.max(0, spentMinor);
  const state: CostBudgetState =
    used >= amountMinor
      ? "exceeded"
      : used * 100 >= amountMinor * warningPercent
        ? "warning"
        : "ok";
  return {
    remainingMinor: amountMinor - spentMinor,
    percentUsed: Math.floor((used * 100) / amountMinor),
    state,
  };
}
