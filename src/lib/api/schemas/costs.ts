import { z } from "zod";
import {
  COST_CATEGORIES,
  COST_DEDUCTIBLE,
  COST_SOURCES,
  COST_SPLIT_MODES,
} from "../enums";
import {
  atLeastOne,
  dateSchema,
  idSchema,
  isoTimestampSchema,
  nullableText,
  paginated,
  paginationQuerySchema,
} from "./common";
import { currencySchema } from "./household";

export const costCategorySchema = z.enum(COST_CATEGORIES);
export const costSplitModeSchema = z.enum(COST_SPLIT_MODES);
export const costDeductibleSchema = z.enum(COST_DEDUCTIBLE);
export const costSourceSchema = z.enum(COST_SOURCES);

export const COST_TITLE_MAX = 200;
export const COST_NOTES_MAX = 4000;
export const MAX_COST_MINOR = 1_000_000_000_00;
export const SHARE_BPS_TOTAL = 10_000;

/** An expense is positive, a refund negative; zero is not a booking. */
export const costAmountSchema = z
  .number()
  .int()
  .min(-MAX_COST_MINOR)
  .max(MAX_COST_MINOR)
  .refine((v) => v !== 0, { error: "The amount must not be zero." });

export const costShareInputSchema = z.strictObject({
  userId: idSchema,
  shareBps: z.number().int().min(1).max(SHARE_BPS_TOTAL),
});
export const costSharesInputSchema = z
  .array(costShareInputSchema)
  .min(1)
  .max(20);

export const costShareSchema = z
  .object({
    userId: z.string(),
    userName: z.string().nullable(),
    shareBps: z.number().int(),
    /** The person's part of the amount in minor units; the parts add up to the amount exactly. */
    amountMinor: z.number().int(),
  })
  .meta({ id: "CostShare" });

export const costEntrySchema = z
  .object({
    id: z.string(),
    date: dateSchema,
    title: z.string(),
    /** Positive = expense, negative = refund. Minor units of `currency`. */
    amountMinor: z.number().int(),
    currency: z.string(),
    category: costCategorySchema,
    assetId: z.string().nullable(),
    assetName: z.string().nullable(),
    roomId: z.string().nullable(),
    roomName: z.string().nullable(),
    defectId: z.string().nullable(),
    defectNumber: z.number().int().nullable(),
    defectTitle: z.string().nullable(),
    serviceLogId: z.string().nullable(),
    serviceLogTitle: z.string().nullable(),
    payee: z.string().nullable(),
    notes: z.string().nullable(),
    paidByUserId: z.string().nullable(),
    paidByName: z.string().nullable(),
    splitMode: costSplitModeSchema,
    /** Who bears which part; empty for `none`. Frozen when the split was set. */
    shares: z.array(costShareSchema),
    /** False for what builds equity (mortgage repayment); such entries stay out of the expense totals. */
    countsAsExpense: z.boolean(),
    deductible: costDeductibleSchema,
    source: costSourceSchema,
    /** The entry in the person's finance app; shown only to the person who booked it from there. */
    providerUrl: z.string().nullable(),
    commentCount: z.number().int(),
    createdBy: z.string().nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .meta({ id: "CostEntry" });
export type CostEntry = z.infer<typeof costEntrySchema>;

const year = z.coerce.number().int().min(1990).max(2200);

export const listCostsQuerySchema = paginationQuerySchema.extend({
  year: year.optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  category: costCategorySchema.optional(),
  assetId: idSchema.optional(),
  roomId: idSchema.optional(),
  defectId: idSchema.optional(),
  /** A user id, or `me`. */
  paidBy: idSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export type ListCostsQuery = z.output<typeof listCostsQuerySchema>;
export const listCostsResponseSchema = paginated(costEntrySchema);

const costFields = {
  date: dateSchema,
  title: z.string().trim().min(1).max(COST_TITLE_MAX),
  amountMinor: costAmountSchema,
  currency: currencySchema,
  category: costCategorySchema,
  assetId: idSchema.nullable(),
  roomId: idSchema.nullable(),
  defectId: idSchema.nullable(),
  serviceLogId: idSchema.nullable(),
  payee: nullableText(200),
  notes: nullableText(COST_NOTES_MAX),
  paidByUserId: idSchema.nullable(),
  splitMode: costSplitModeSchema,
  shares: costSharesInputSchema,
  countsAsExpense: z.boolean(),
  deductible: costDeductibleSchema,
};

/**
 * `date` defaults to today, `currency` to the household's, `splitMode` to
 * `ownership`, `countsAsExpense` to true (false for a mortgage repayment).
 * `shares` are required for `custom` and refused otherwise.
 */
export const createCostRequestSchema = z.strictObject({
  date: costFields.date.optional(),
  title: costFields.title,
  amountMinor: costFields.amountMinor,
  currency: costFields.currency.optional(),
  category: costFields.category,
  assetId: costFields.assetId.optional(),
  roomId: costFields.roomId.optional(),
  defectId: costFields.defectId.optional(),
  serviceLogId: costFields.serviceLogId.optional(),
  payee: costFields.payee.optional(),
  notes: costFields.notes.optional(),
  paidByUserId: costFields.paidByUserId.optional(),
  splitMode: costFields.splitMode.default("ownership"),
  shares: costFields.shares.optional(),
  countsAsExpense: costFields.countsAsExpense.optional(),
  deductible: costFields.deductible.default("unknown"),
});
export type CreateCostRequest = z.output<typeof createCostRequestSchema>;

/**
 * Setting `splitMode` to `ownership` or `equal` splits again by the people's
 * current shares; sending `shares` needs `custom`. Changing only the amount
 * keeps the frozen shares.
 */
export const updateCostRequestSchema = atLeastOne(
  z.strictObject({
    date: costFields.date.optional(),
    title: costFields.title.optional(),
    amountMinor: costFields.amountMinor.optional(),
    currency: costFields.currency.optional(),
    category: costFields.category.optional(),
    assetId: costFields.assetId.optional(),
    roomId: costFields.roomId.optional(),
    defectId: costFields.defectId.optional(),
    serviceLogId: costFields.serviceLogId.optional(),
    payee: costFields.payee.optional(),
    notes: costFields.notes.optional(),
    paidByUserId: costFields.paidByUserId.optional(),
    splitMode: costFields.splitMode.optional(),
    shares: costFields.shares.optional(),
    countsAsExpense: costFields.countsAsExpense.optional(),
    deductible: costFields.deductible.optional(),
  }),
);
export type UpdateCostRequest = z.output<typeof updateCostRequestSchema>;

export const costsSummaryQuerySchema = z.object({ year: year.optional() });
export type CostsSummaryQuery = z.output<typeof costsSummaryQuerySchema>;

const totalByCategory = z.object({
  category: costCategorySchema,
  totalMinor: z.number().int(),
  count: z.number().int(),
});

export const costsSummarySchema = z
  .object({
    year: z.number().int(),
    /** The household currency: every total counts entries in this currency only. */
    currency: z.string(),
    /** Entries in another currency, left out of every total (they are in the CSV). */
    otherCurrencyCount: z.number().int(),
    /** What the year cost: entries that count as an expense, refunds netted off. */
    expenseTotalMinor: z.number().int(),
    /** Entries that build equity (mortgage repayment) and are not an expense. */
    equityTotalMinor: z.number().int(),
    /** Expenses per category, largest first; categories without entries are left out. */
    byCategory: z.array(totalByCategory),
    /** Expenses per month, always twelve entries (`YYYY-MM`). */
    byMonth: z.array(
      z.object({
        month: z.string(),
        totalMinor: z.number().int(),
        count: z.number().int(),
      }),
    ),
    /** The assets with the highest expenses, at most ten. */
    byAsset: z.array(
      z.object({
        assetId: z.string(),
        assetName: z.string(),
        totalMinor: z.number().int(),
        count: z.number().int(),
      }),
    ),
    /** Expenses per tax class (`unknown` until someone decides). */
    byDeductible: z.array(
      z.object({
        deductible: costDeductibleSchema,
        totalMinor: z.number().int(),
        count: z.number().int(),
      }),
    ),
    /**
     * Who paid what and who bears what, over every split entry with a payer
     * (equity entries included: it is about cash, not about expenses).
     * `balanceMinor` = paid - share: positive means the others owe this person.
     */
    people: z.array(
      z.object({
        userId: z.string(),
        userName: z.string().nullable(),
        paidMinor: z.number().int(),
        shareMinor: z.number().int(),
        balanceMinor: z.number().int(),
      }),
    ),
    /** The payments that settle the balances, fewest first ("A owes B CHF x"). */
    settlement: z.array(
      z.object({
        fromUserId: z.string(),
        fromName: z.string().nullable(),
        toUserId: z.string(),
        toName: z.string().nullable(),
        amountMinor: z.number().int(),
      }),
    ),
    /** Split entries without a payer: they cannot be settled until someone is named. */
    unassignedPayerCount: z.number().int(),
  })
  .meta({ id: "CostsSummary" });
export type CostsSummary = z.infer<typeof costsSummarySchema>;

/** The slice the dashboard shows: the year so far. */
export const dashboardCostsSchema = z
  .object({
    year: z.number().int(),
    currency: z.string(),
    totalMinor: z.number().int(),
    /** The three largest expense categories. */
    byCategory: z.array(totalByCategory),
    /** The payments that settle the balances so far. */
    settlement: costsSummarySchema.shape.settlement,
  })
  .meta({ id: "DashboardCosts" });

export const exportCostsQuerySchema = z.object({ year: year.optional() });
export type ExportCostsQuery = z.output<typeof exportCostsQuerySchema>;

/** Cost entries booked against a defect or service log entry. */
export const costsOfSchema = z
  .object({
    /** Sum of the entries in the household currency; refunds net off. */
    totalMinor: z.number().int(),
    count: z.number().int(),
  })
  .meta({ id: "CostsOf" });
