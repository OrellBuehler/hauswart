import { z } from "zod";
import type { CostRecurrence } from "../../../src/lib/api/schemas/cost-recurrences";
import { endpoints } from "../../../src/lib/api/registry";
import { plural } from "../format";
import { defineTool } from "../tool";
import { money } from "./costs";

const UNIT = {
  monthly: "month",
  quarterly: "quarter",
  yearly: "year",
} as const;

/** "every 2 months on day 31 (the last day of shorter months), from 2026-01-31". */
function describeRule(r: CostRecurrence): string {
  const unit = UNIT[r.frequency];
  const every =
    r.interval === 1 ? `every ${unit}` : `every ${r.interval} ${unit}s`;
  const day = `on day ${r.dayOfMonth}${r.dayOfMonth > 28 ? " (the last day of shorter months)" : ""}`;
  return `${every} ${day}, from ${r.startDate}${r.endDate ? ` to ${r.endDate}` : ""}`;
}

export const listCostRecurrences = defineTool({
  name: "list_cost_recurrences",
  title: "List recurring costs",
  description:
    "The costs that repeat on their own (rent, an insurance premium, a subscription), set up in the app. Each is the template of an entry (amount, category, book, payer, split, tags) and a schedule; hauswart books an entry with source recurring on every date the schedule falls due, so do not book those by hand: check list_costs first. Shows the next date, the newest occurrence booked and, when a booking failed, why (book_archived: the book is closed, move the recurring cost to another one in the app). active true lists the ones that book, false the paused and finished ones.",
  mode: "read",
  input: { active: z.boolean().optional() },
  async handler({ active }, ctx) {
    const { items } = await ctx.api.call(endpoints.costRecurrencesList, {
      query: {
        active: active === undefined ? undefined : active ? "true" : "false",
      },
    });
    return {
      summary: `${plural(items.length, "recurring cost")}.`,
      data: {
        recurrences: items.map((r) => ({
          id: r.id,
          title: r.title,
          amount: money(r.amountMinor, r.currency),
          category: r.category,
          book: r.bookName,
          schedule: describeRule(r),
          next: r.nextDate,
          lastBooked: r.lastOccurrenceDate,
          status: !r.active
            ? "paused"
            : r.nextDate === null
              ? "finished"
              : null,
          problem: r.lastError,
          payee: r.payee,
          paidBy: r.paidByName,
          split: r.splitMode,
          asset: r.assetName,
          room: r.roomName,
          tags: r.tags.length ? r.tags.map((t) => t.name) : null,
          countsAsExpense: r.countsAsExpense ? null : false,
        })),
      },
    };
  },
});

export const costRecurrenceTools = [listCostRecurrences];
