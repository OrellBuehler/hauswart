import { z } from "zod";
import { endpoints } from "../../../src/lib/api/registry";
import type { CostBalances } from "../../../src/lib/api/schemas/costs";
import type { CostBook } from "../../../src/lib/api/schemas/cost-books";
import { ToolError } from "../errors";
import { plural } from "../format";
import { defineTool } from "../tool";
import { money, toMinor } from "./costs";

const bookRow = (b: CostBook) => ({
  id: b.id,
  name: b.name,
  defaultSplit: b.defaultSplitMode,
  taxRelevant: b.taxRelevant ? true : null,
  isDefault: b.isDefault ? true : null,
  archived: b.archivedAt !== null ? true : null,
  entries: b.entryCount,
  payments: b.settlementCount,
});

export const listCostBooks = defineTool({
  name: "list_cost_books",
  title: "List cost books",
  description:
    "The books cost entries are booked into (for example the apartment, everyday household spending, the car, a trip). Each has a default split for entries that name none, a flag for whether the tax class (deductible) applies to its entries, and the number of entries and recorded payments. The default book is where create_cost books without a book. Archived books are left out unless includeArchived is true.",
  mode: "read",
  input: { includeArchived: z.boolean().default(false) },
  async handler({ includeArchived }, ctx) {
    const page = await ctx.api.call(endpoints.costBooksList, {
      query: {
        includeArchived: includeArchived ? "true" : "false",
        limit: 200,
      },
    });
    const first = page.items.find((b) => b.isDefault);
    return {
      summary: `${plural(page.items.length, "cost book")}${first ? ` (default: ${first.name})` : ""}.`,
      data: { books: page.items.map(bookRow) },
    };
  },
});

function balancesData(b: CostBalances) {
  const m = (n: number) => money(n, b.currency);
  return {
    scope: b.book?.name ?? "all books",
    currency: b.currency,
    people: b.people.map((p) => ({
      person: p.userName ?? p.userId,
      paid: m(p.paidMinor),
      share: m(p.shareMinor),
      paymentsMade: p.sentMinor ? m(p.sentMinor) : null,
      paymentsReceived: p.receivedMinor ? m(p.receivedMinor) : null,
      balance: m(p.balanceMinor),
    })),
    suggestedPayments: b.suggestedPayments.map((t) => ({
      from: t.fromName ?? t.fromUserId,
      to: t.toName ?? t.toUserId,
      amount: m(t.amountMinor),
    })),
    otherCurrencyEntries: b.otherCurrencyCount || null,
    splitEntriesWithoutPayer: b.unassignedPayerCount || null,
    paymentsAcrossAllBooksLeftOut: b.crossBookSettlements?.count
      ? {
          count: b.crossBookSettlements.count,
          total: m(b.crossBookSettlements.totalMinor),
        }
      : null,
  };
}

const owes = (b: CostBalances) =>
  b.suggestedPayments.length
    ? b.suggestedPayments
        .map(
          (t) =>
            `${t.fromName ?? t.fromUserId} owes ${t.toName ?? t.toUserId} ${money(t.amountMinor, b.currency)}`,
        )
        .join(", ")
    : "everybody is square";

export const getBalances = defineTool({
  name: "get_balances",
  title: "Who owes whom",
  description:
    "The running balance of every household member over all time: what each person paid, their share of what was split, the payments they made and received (record_settlement), and the balance (positive = the others owe this person), plus the fewest payments that would square everybody. Covers every book together, or one book with book (name or id; payments recorded across all books are then left out, and paymentsAcrossAllBooksLeftOut says how many). Only the household currency counts. The per-year settlement in cost_summary is separate and does not include recorded payments.",
  mode: "read",
  input: { book: z.string().min(1).max(64).optional() },
  async handler({ book }, ctx) {
    const b = book ? await ctx.resolveBook(book) : undefined;
    const balances = await ctx.api.call(endpoints.costsBalances, {
      query: b ? { bookId: b.id } : { all: "true" },
    });
    return {
      summary: `${balances.book?.name ?? "All books"}: ${owes(balances)}.`,
      data: balancesData(balances),
    };
  },
});

export const recordSettlement = defineTool({
  name: "record_settlement",
  title: "Record a payment between two people",
  description:
    "Records that one household member paid another to square what they owe each other (\"Ben paid Anna 45.00\"). It is not a cost: it counts in no expense total and only moves the balances. from defaults to the token's user, to is required (names, ids or 'me'); amount is a positive decimal such as '45.00' in the household currency unless currency is given. book (name or id, archived books allowed) ties the payment to one book, without it the payment settles across all books. date defaults to today. Look at get_balances first to see what is open; this answers with what is still open afterwards.",
  mode: "create",
  scopes: ["costs:write"],
  input: {
    to: z.string().min(1).max(100),
    from: z.string().min(1).max(100).optional(),
    amount: z
      .string()
      .trim()
      .min(1)
      .max(20)
      .describe("Positive decimal amount, e.g. '45.00'"),
    book: z.string().min(1).max(64).optional(),
    date: z.iso.date().optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    note: z.string().max(500).optional(),
  },
  async handler({ to, from, amount, book, date, currency, note }, ctx) {
    const amountMinor = toMinor(amount, currency ?? ctx.household.currency);
    if (amountMinor <= 0) {
      throw new ToolError("invalid_request", "The amount must be positive");
    }
    const [toId, fromId, b] = await Promise.all([
      ctx.resolveUser(to),
      from ? ctx.resolveUser(from) : ctx.me.id,
      book ? ctx.resolveBook(book) : undefined,
    ]);
    const s = await ctx.api.call(endpoints.settlementsCreate, {
      body: {
        fromUserId: fromId,
        toUserId: toId,
        amountMinor,
        currency,
        date,
        note,
        bookId: b?.id ?? null,
      },
    });
    const after = await ctx.api.call(endpoints.costsBalances, {
      query: b ? { bookId: b.id } : { all: "true" },
    });
    return {
      summary: `Recorded: ${s.fromName ?? s.fromUserId} paid ${s.toName ?? s.toUserId} ${money(s.amountMinor, s.currency)}. Now ${owes(after)}.`,
      data: {
        id: s.id,
        from: s.fromName ?? s.fromUserId,
        to: s.toName ?? s.toUserId,
        amount: money(s.amountMinor, s.currency),
        date: s.date,
        book: s.bookName,
        note: s.note,
        stillOpen: after.suggestedPayments.map((t) => ({
          from: t.fromName ?? t.fromUserId,
          to: t.toName ?? t.toUserId,
          amount: money(t.amountMinor, after.currency),
        })),
      },
    };
  },
});

export const costBookTools = [listCostBooks, getBalances, recordSettlement];
