import { z } from "zod";
import { COST_CATEGORIES, COST_DEDUCTIBLE } from "../../../src/lib/api/enums";
import { endpoints } from "../../../src/lib/api/registry";
import type { CostEntry } from "../../../src/lib/api/schemas/costs";
import {
  currencyExponent,
  minor,
  parseAmount,
  toDecimalString,
} from "../../../src/lib/money";
import { ToolError } from "../errors";
import { moreHint, plural } from "../format";
import { defineTool } from "../tool";

const date = z.iso.date();
const category = z.enum(COST_CATEGORIES);

/** `12.50 CHF`, `-3 CHF`: the amount as a plain decimal in the currency's own precision. */
export const money = (amountMinor: number, currency: string) =>
  `${toDecimalString(minor(amountMinor), currencyExponent(currency))} ${currency}`;

const costRow = (c: CostEntry) => ({
  id: c.id,
  date: c.date,
  title: c.title,
  amount: money(c.amountMinor, c.currency),
  category: c.category,
  payee: c.payee,
  paidBy: c.paidByName,
  split: c.splitMode,
  shares: c.shares.length
    ? c.shares.map(
        (s) => `${s.userName ?? s.userId}: ${money(s.amountMinor, c.currency)}`,
      )
    : null,
  asset: c.assetName,
  room: c.roomName,
  defect:
    c.defectNumber === null ? null : `#${c.defectNumber} ${c.defectTitle}`,
  countsAsExpense: c.countsAsExpense ? null : false,
  deductible: c.deductible === "unknown" ? null : c.deductible,
  notes: c.notes,
});

export const listCosts = defineTool({
  name: "list_costs",
  title: "List costs",
  description:
    "Cost entries of the apartment (repairs, utilities, renewal fund, purchases, mortgage, insurance ...), newest first. Amounts are decimals in the entry's currency: positive = expense, negative = refund. Filters: year or from/to, category, asset and room (id or name), paidBy (me, a name or id), q (text in title, payee, notes). Totals and who owes whom are in cost_summary.",
  mode: "read",
  input: {
    year: z.number().int().min(1990).max(2200).optional(),
    from: date.optional(),
    to: date.optional(),
    category: category.optional(),
    asset: z.string().min(1).max(120).optional(),
    room: z.string().min(1).max(100).optional(),
    paidBy: z.string().min(1).max(100).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    limit: z.number().int().min(1).max(100).default(30),
    cursor: z.string().min(1).max(512).optional(),
  },
  async handler({ asset, room, paidBy, ...rest }, ctx) {
    const [a, r, p] = await Promise.all([
      asset ? ctx.resolveAsset(asset) : undefined,
      room ? ctx.resolveRoom(room) : undefined,
      paidBy ? ctx.resolveUser(paidBy) : undefined,
    ]);
    const page = await ctx.api.call(endpoints.costsList, {
      query: { ...rest, assetId: a?.id, roomId: r?.id, paidBy: p },
    });
    return {
      summary: `${plural(page.items.length, "cost entry")}.${moreHint(page.nextCursor)}`,
      data: { costs: page.items.map(costRow), nextCursor: page.nextCursor },
    };
  },
});

export const costSummary = defineTool({
  name: "cost_summary",
  title: "Costs of a year",
  description:
    "What a year cost: expense total (mortgage repayments are equity and counted separately), per category, per month, the assets with the highest costs, the tax classes (maintenance = deductible, investment = not), and the settlement between the people (who paid what, who owes whom). Default year: the current one.",
  mode: "read",
  input: { year: z.number().int().min(1990).max(2200).optional() },
  async handler({ year }, ctx) {
    const s = await ctx.api.call(endpoints.costsSummary, { query: { year } });
    const m = (n: number) => money(n, s.currency);
    return {
      summary: `${s.year}: ${m(s.expenseTotalMinor)} in expenses${
        s.settlement.length
          ? `; ${s.settlement.map((t) => `${t.fromName ?? t.fromUserId} owes ${t.toName ?? t.toUserId} ${m(t.amountMinor)}`).join(", ")}`
          : "; nothing to settle"
      }.`,
      data: {
        year: s.year,
        currency: s.currency,
        expenseTotal: m(s.expenseTotalMinor),
        equityTotal: m(s.equityTotalMinor),
        byCategory: s.byCategory.map((c) => ({
          category: c.category,
          total: m(c.totalMinor),
          count: c.count,
        })),
        byMonth: s.byMonth.map((x) => ({
          month: x.month,
          total: m(x.totalMinor),
        })),
        topAssets: s.byAsset.map((x) => ({
          asset: x.assetName,
          total: m(x.totalMinor),
          count: x.count,
        })),
        byDeductible: s.byDeductible.map((x) => ({
          deductible: x.deductible,
          total: m(x.totalMinor),
        })),
        people: s.people.map((x) => ({
          person: x.userName ?? x.userId,
          paid: m(x.paidMinor),
          share: m(x.shareMinor),
          balance: m(x.balanceMinor),
        })),
        settlement: s.settlement.map((t) => ({
          from: t.fromName ?? t.fromUserId,
          to: t.toName ?? t.toUserId,
          amount: m(t.amountMinor),
        })),
        otherCurrencyEntries: s.otherCurrencyCount || null,
        splitEntriesWithoutPayer: s.unassignedPayerCount || null,
      },
    };
  },
});

export const createCost = defineTool({
  name: "create_cost",
  title: "Book a cost",
  description:
    "Books an expense (or, with a negative amount, a refund). amount is a decimal such as '123.45' in the household currency unless currency is given. category is required. paidBy defaults to the token's user; split defaults to 'ownership' (by the people's ownership shares), or 'equal' or 'none' (not shared). date defaults to today. asset and room can be given by name. deductible: maintenance (value-preserving, tax deductible) or investment (value-increasing); countsAsExpense is false for mortgage repayments by default. Check list_costs first to avoid booking twice.",
  mode: "create",
  scopes: ["costs:write"],
  input: {
    title: z.string().trim().min(1).max(200),
    amount: z
      .string()
      .trim()
      .min(1)
      .max(20)
      .describe("Decimal amount, e.g. '123.45'; negative for a refund"),
    category,
    date: date.optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    asset: z.string().min(1).max(120).optional(),
    room: z.string().min(1).max(100).optional(),
    payee: z.string().max(200).optional(),
    notes: z.string().max(4000).optional(),
    paidBy: z.string().min(1).max(100).optional(),
    split: z.enum(["ownership", "equal", "none"]).default("ownership"),
    deductible: z.enum(COST_DEDUCTIBLE).optional(),
    countsAsExpense: z.boolean().optional(),
  },
  async handler(args, ctx) {
    const { amount, asset, room, paidBy, split, currency, ...rest } = args;
    let amountMinor: number;
    try {
      amountMinor = parseAmount(
        amount,
        currencyExponent(currency ?? ctx.household.currency),
      );
    } catch (err) {
      throw new ToolError(
        "invalid_request",
        err instanceof Error ? err.message : "The amount is not valid",
      );
    }
    const [a, r, p] = await Promise.all([
      asset ? ctx.resolveAsset(asset) : undefined,
      room ? ctx.resolveRoom(room) : undefined,
      paidBy ? ctx.resolveUser(paidBy) : ctx.me.id,
    ]);
    const cost = await ctx.api.call(endpoints.costsCreate, {
      body: {
        ...rest,
        amountMinor,
        currency,
        assetId: a?.id,
        roomId: r?.id,
        paidByUserId: p,
        splitMode: split,
      },
    });
    return {
      summary: `Booked ${money(cost.amountMinor, cost.currency)} "${cost.title}" (${cost.category}), paid by ${cost.paidByName ?? "nobody"}.`,
      data: costRow(cost),
    };
  },
});

export const costTools = [listCosts, costSummary, createCost];
