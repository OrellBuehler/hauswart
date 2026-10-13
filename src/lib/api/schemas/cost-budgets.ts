import { z } from "zod";
import { COST_BUDGET_PERIODS } from "../enums";
import { atLeastOne, dateSchema, idSchema, isoTimestampSchema } from "./common";
import { MAX_COST_MINOR, costCategorySchema } from "./costs";

/** A budget at or above this share of its amount is a warning (80 %), at or above all of it exceeded. */
export const BUDGET_WARNING_PERCENT = 80;

export const costBudgetPeriodSchema = z.enum(COST_BUDGET_PERIODS);

export const COST_BUDGET_STATES = ["ok", "warning", "exceeded"] as const;
export const costBudgetStateSchema = z.enum(COST_BUDGET_STATES);
export type CostBudgetState = z.infer<typeof costBudgetStateSchema>;

const budgetAmount = z.number().int().min(1).max(MAX_COST_MINOR);

export const costBudgetSchema = z
  .object({
    id: z.string(),
    /** The book the budget is for; null = every book. */
    bookId: z.string().nullable(),
    bookName: z.string().nullable(),
    /** The category the budget is for; null = every category. A budget has a book, a category or both. */
    category: costCategorySchema.nullable(),
    period: costBudgetPeriodSchema,
    /** Minor units of `currency`, always positive. */
    amountMinor: z.number().int(),
    /** The household currency when the budget was set; only entries in this currency count against it. */
    currency: z.string(),
    /** An inactive budget is kept but left out of the status. */
    active: z.boolean(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .meta({ id: "CostBudget" });
export type CostBudget = z.infer<typeof costBudgetSchema>;

export const listCostBudgetsResponseSchema = z.object({
  items: z.array(costBudgetSchema),
});

const hasScope = (v: { bookId?: string | null; category?: string | null }) =>
  Boolean(v.bookId) || Boolean(v.category);

/**
 * A budget is for a book, a category or both (400 on `bookId` when it names neither): "groceries per month in the
 * everyday book", "everything in the holiday book per year". Only one budget per book, category and period (409).
 */
export const createCostBudgetRequestSchema = z
  .strictObject({
    bookId: idSchema.nullable().optional(),
    category: costCategorySchema.nullable().optional(),
    period: costBudgetPeriodSchema,
    amountMinor: budgetAmount,
    active: z.boolean().optional(),
  })
  .refine(hasScope, {
    error: "Give a book, a category or both.",
    path: ["bookId"],
  });
export type CreateCostBudgetRequest = z.output<
  typeof createCostBudgetRequestSchema
>;

/** `null` for `bookId` or `category` removes that half of the scope; what is left must still name one. */
export const updateCostBudgetRequestSchema = atLeastOne(
  z.strictObject({
    bookId: idSchema.nullable().optional(),
    category: costCategorySchema.nullable().optional(),
    period: costBudgetPeriodSchema.optional(),
    amountMinor: budgetAmount.optional(),
    active: z.boolean().optional(),
  }),
);
export type UpdateCostBudgetRequest = z.output<
  typeof updateCostBudgetRequestSchema
>;

export const costBudgetStatusQuerySchema = z.object({
  /** Defaults to the current year in the household zone. */
  year: z.coerce.number().int().min(1990).max(2200).optional(),
  /** 1 to 12; the month the monthly budgets are measured for. Defaults to the current month. */
  month: z.coerce.number().int().min(1).max(12).optional(),
});
export type CostBudgetStatusQuery = z.output<
  typeof costBudgetStatusQuerySchema
>;

export const costBudgetStatusItemSchema = z
  .object({
    budget: costBudgetSchema,
    /** The period measured: the month of the query for a monthly budget, the year for a yearly one. */
    periodFrom: dateSchema,
    periodTo: dateSchema,
    /** Expense entries of the period in the budget's scope and currency, refunds netted off; may be negative. */
    spentMinor: z.number().int(),
    entryCount: z.number().int(),
    /** `amountMinor` - `spentMinor`; negative once the budget is exceeded. */
    remainingMinor: z.number().int(),
    /** Whole percent of the amount spent (rounded down), 0 while nothing net was spent; may exceed 100. */
    percentUsed: z.number().int(),
    /** `warning` from 80 %, `exceeded` from 100 % (spent is at least the whole amount). */
    state: costBudgetStateSchema,
  })
  .meta({ id: "CostBudgetStatusItem" });
export type CostBudgetStatusItem = z.infer<typeof costBudgetStatusItemSchema>;

export const costBudgetStatusSchema = z
  .object({
    year: z.number().int(),
    month: z.number().int(),
    currency: z.string(),
    /** `BUDGET_WARNING_PERCENT`, so a client does not hard-code it. */
    warningPercent: z.number().int(),
    /** The active budgets, in the order they were made. */
    items: z.array(costBudgetStatusItemSchema),
  })
  .meta({ id: "CostBudgetStatus" });
export type CostBudgetStatus = z.infer<typeof costBudgetStatusSchema>;

/** How many budgets the dashboard names. */
export const DASHBOARD_BUDGET_ALERTS_TOP = 3;

/** A budget that is close to or over its amount, as the dashboard names it (the month and year of today are measured). */
export const dashboardBudgetAlertSchema = z
  .object({
    budgetId: z.string(),
    bookId: z.string().nullable(),
    bookName: z.string().nullable(),
    category: costCategorySchema.nullable(),
    period: costBudgetPeriodSchema,
    amountMinor: z.number().int(),
    /** Net of refunds; in `currency`. */
    spentMinor: z.number().int(),
    currency: z.string(),
    /** Whole percent of the amount spent (rounded down); at least 80. */
    percentUsed: z.number().int(),
    state: z.enum(["warning", "exceeded"]),
  })
  .meta({ id: "DashboardBudgetAlert" });

/**
 * Where the budgets stand this month and year, as much as a hint on the dashboard needs: how many are over their amount and
 * how many from `warningPercent` up, and the most urgent three (exceeded before warning, then the higher share used).
 * Household data, the same for every member.
 */
export const dashboardBudgetAlertsSchema = z
  .object({
    exceeded: z.number().int().min(0),
    warning: z.number().int().min(0),
    top: z.array(dashboardBudgetAlertSchema).max(DASHBOARD_BUDGET_ALERTS_TOP),
  })
  .meta({ id: "DashboardBudgetAlerts" });
export type DashboardBudgetAlerts = z.infer<typeof dashboardBudgetAlertsSchema>;
