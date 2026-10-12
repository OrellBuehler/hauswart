import { z } from "zod";
import { endpoints } from "../../../src/lib/api/registry";
import { plural } from "../format";
import { defineTool } from "../tool";
import { money } from "./costs";

export const getBudgetStatus = defineTool({
  name: "get_budget_status",
  title: "Budget status",
  description:
    "Where the household's cost budgets stand. A budget is a limit for a book, a category or both per calendar month or year (set in the app). For every active budget: what was spent in the period (entries that count as an expense, refunds netted off, in the budget's currency), what is left, the whole percent used and a state: ok, warning from 80 % or exceeded from 100 %. Monthly budgets are measured for month (1 to 12) of year, yearly ones for the whole year; both default to today. The budgets with the highest use come first. Nothing is notified by itself, so look here when asked about spending limits.",
  mode: "read",
  input: {
    year: z.number().int().min(1990).max(2200).optional(),
    month: z.number().int().min(1).max(12).optional(),
  },
  async handler({ year, month }, ctx) {
    const s = await ctx.api.call(endpoints.costBudgetsStatus, {
      query: { year, month },
    });
    const items = [...s.items].sort(
      (a, b) =>
        b.percentUsed - a.percentUsed ||
        a.periodFrom.localeCompare(b.periodFrom),
    );
    const flagged = items.filter((i) => i.state !== "ok").length;
    return {
      summary: `${plural(items.length, "active budget")} for ${s.year}-${String(s.month).padStart(2, "0")}${
        flagged ? `: ${flagged} at 80 % or more` : ""
      }.`,
      data: {
        year: s.year,
        month: s.month,
        budgets: items.map((i) => ({
          id: i.budget.id,
          book: i.budget.bookName,
          category: i.budget.category,
          period: i.budget.period,
          from: i.periodFrom,
          to: i.periodTo,
          budget: money(i.budget.amountMinor, i.budget.currency),
          spent: money(i.spentMinor, i.budget.currency),
          remaining: money(i.remainingMinor, i.budget.currency),
          percentUsed: i.percentUsed,
          state: i.state,
        })),
      },
    };
  },
});

export const costBudgetTools = [getBudgetStatus];
