import { and, asc, eq, sql } from "drizzle-orm";
import type {
  CreateCostBudgetRequest,
  UpdateCostBudgetRequest,
} from "$lib/api/schemas/cost-budgets";
import { BUDGET_WARNING_PERCENT } from "$lib/api/schemas/cost-budgets";
import { budgetRange, budgetUsage } from "$lib/costs/budget";
import { costBooks, costBudgets, costEntries } from "$lib/server/db";
import { getHousehold } from "$lib/server/household/household";
import {
  conflict,
  invalidField,
  isUniqueViolation,
  notFound,
  type ServiceContext,
} from "$lib/server/service";
import { clockAt } from "$lib/server/tasks/evaluator";
import { requireCostBook } from "./books";

type Db = Pick<ServiceContext, "db">;

export type CostBudgetRow = typeof costBudgets.$inferSelect;

export interface CostBudgetRecord extends CostBudgetRow {
  bookName: string | null;
}

const duplicate = () =>
  conflict("There is a budget for this book, category and period already");

const scopeProblem = () =>
  invalidField("bookId", "Give a book, a category or both.");

function select(ctx: Db) {
  return ctx.db
    .select({ budget: costBudgets, bookName: costBooks.name })
    .from(costBudgets)
    .leftJoin(costBooks, eq(costBooks.id, costBudgets.bookId));
}

const recordOf = (row: {
  budget: CostBudgetRow;
  bookName: string | null;
}): CostBudgetRecord => ({ ...row.budget, bookName: row.bookName });

const inOrder = [asc(sql`${costBudgets}.rowid`)];

/** Every budget, active or not, in the order they were made. */
export function listCostBudgets(ctx: Db): CostBudgetRecord[] {
  return select(ctx)
    .orderBy(...inOrder)
    .all()
    .map(recordOf);
}

export function getCostBudget(ctx: Db, id: string): CostBudgetRecord {
  const row = select(ctx).where(eq(costBudgets.id, id)).get();
  if (!row) throw notFound("Cost budget");
  return recordOf(row);
}

/** The amount is in the household currency of the day it is set; changing the household currency later does not convert it. */
export function createCostBudget(
  ctx: Db,
  input: CreateCostBudgetRequest,
): CostBudgetRecord {
  if (!input.bookId && !input.category) throw scopeProblem();
  if (input.bookId) requireCostBook(ctx, input.bookId);
  try {
    const row = ctx.db
      .insert(costBudgets)
      .values({
        bookId: input.bookId ?? null,
        category: input.category ?? null,
        period: input.period,
        amountMinor: input.amountMinor as never,
        currency: getHousehold(ctx).currency,
        active: input.active ?? true,
      })
      .returning({ id: costBudgets.id })
      .get();
    return getCostBudget(ctx, row.id);
  } catch (err) {
    if (isUniqueViolation(err)) throw duplicate();
    throw err;
  }
}

export function updateCostBudget(
  ctx: Db,
  id: string,
  patch: UpdateCostBudgetRequest,
): CostBudgetRecord {
  const current = getCostBudget(ctx, id);
  const bookId = patch.bookId === undefined ? current.bookId : patch.bookId;
  const category =
    patch.category === undefined ? current.category : patch.category;
  if (!bookId && !category) throw scopeProblem();
  if (patch.bookId) requireCostBook(ctx, patch.bookId);
  try {
    ctx.db
      .update(costBudgets)
      .set({
        bookId,
        category,
        ...(patch.period === undefined ? {} : { period: patch.period }),
        ...(patch.amountMinor === undefined
          ? {}
          : { amountMinor: patch.amountMinor as never }),
        ...(patch.active === undefined ? {} : { active: patch.active }),
      })
      .where(eq(costBudgets.id, id))
      .run();
  } catch (err) {
    if (isUniqueViolation(err)) throw duplicate();
    throw err;
  }
  return getCostBudget(ctx, id);
}

export function deleteCostBudget(ctx: Db, id: string): void {
  getCostBudget(ctx, id);
  ctx.db.delete(costBudgets).where(eq(costBudgets.id, id)).run();
}

export interface CostBudgetStatusRecord {
  budget: CostBudgetRecord;
  periodFrom: string;
  periodTo: string;
  spentMinor: number;
  entryCount: number;
  remainingMinor: number;
  percentUsed: number;
  state: "ok" | "warning" | "exceeded";
}

/**
 * Where every active budget stands: what the expense entries (those that count as an expense, refunds netted off) of
 * its book and category, in its currency, add up to in the month `year`-`month` (a monthly budget) or the whole year
 * `year` (a yearly one). `year` and `month` default to today in the household zone.
 */
export function costBudgetStatus(
  ctx: Pick<ServiceContext, "db" | "now">,
  query: { year?: number; month?: number } = {},
) {
  const { today } = clockAt(ctx.now);
  const year = query.year ?? Number(today.slice(0, 4));
  const month = query.month ?? Number(today.slice(5, 7));
  const items: CostBudgetStatusRecord[] = listCostBudgets(ctx)
    .filter((b) => b.active)
    .map((budget) => {
      const { from, to } = budgetRange(budget.period, year, month);
      const total = ctx.db
        .select({
          spent: sql<number>`coalesce(sum(${costEntries.amountMinor}), 0)`,
          count: sql<number>`count(*)`,
        })
        .from(costEntries)
        .where(
          and(
            eq(costEntries.countsAsExpense, true),
            eq(costEntries.currency, budget.currency),
            sql`${costEntries.date} >= ${from}`,
            sql`${costEntries.date} <= ${to}`,
            budget.bookId ? eq(costEntries.bookId, budget.bookId) : undefined,
            budget.category
              ? eq(costEntries.category, budget.category)
              : undefined,
          ),
        )
        .get();
      const spent = Number(total?.spent ?? 0);
      return {
        budget,
        periodFrom: from,
        periodTo: to,
        spentMinor: spent,
        entryCount: Number(total?.count ?? 0),
        ...budgetUsage(spent, budget.amountMinor),
      };
    });
  return {
    year,
    month,
    currency: getHousehold(ctx).currency,
    warningPercent: BUDGET_WARNING_PERCENT,
    items,
  };
}
