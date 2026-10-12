import type { z } from "zod";
import type { endpoints } from "$lib/api/registry";
import type {
  costBudgetSchema,
  costBudgetStatusSchema,
} from "$lib/api/schemas/cost-budgets";
import { toIso } from "$lib/api/schemas/common";
import {
  costBudgetStatus,
  createCostBudget,
  deleteCostBudget,
  getCostBudget,
  listCostBudgets,
  updateCostBudget,
  type CostBudgetRecord,
} from "$lib/server/costs/budgets";
import type { Handler } from "../bind";

export function wireCostBudget(
  b: CostBudgetRecord,
): z.input<typeof costBudgetSchema> {
  return {
    id: b.id,
    bookId: b.bookId,
    bookName: b.bookName,
    category: b.category,
    period: b.period,
    amountMinor: b.amountMinor,
    currency: b.currency,
    active: b.active,
    createdAt: toIso(b.createdAt),
    updatedAt: toIso(b.updatedAt),
  };
}

export const list: Handler<typeof endpoints.costBudgetsList> = ({ ctx }) => ({
  items: listCostBudgets(ctx).map(wireCostBudget),
});

export const create: Handler<typeof endpoints.costBudgetsCreate> = ({
  ctx,
  body,
}) => wireCostBudget(createCostBudget(ctx, body));

export const get: Handler<typeof endpoints.costBudgetsGet> = ({
  ctx,
  params,
}) => wireCostBudget(getCostBudget(ctx, params.id));

export const update: Handler<typeof endpoints.costBudgetsUpdate> = ({
  ctx,
  params,
  body,
}) => wireCostBudget(updateCostBudget(ctx, params.id, body));

export const remove: Handler<typeof endpoints.costBudgetsDelete> = ({
  ctx,
  params,
}) => {
  deleteCostBudget(ctx, params.id);
  return null;
};

export const status: Handler<typeof endpoints.costBudgetsStatus> = ({
  ctx,
  query,
}): z.input<typeof costBudgetStatusSchema> => {
  const s = costBudgetStatus(ctx, query);
  return {
    year: s.year,
    month: s.month,
    currency: s.currency,
    warningPercent: s.warningPercent,
    items: s.items.map((i) => ({
      budget: wireCostBudget(i.budget),
      periodFrom: i.periodFrom,
      periodTo: i.periodTo,
      spentMinor: i.spentMinor,
      entryCount: i.entryCount,
      remainingMinor: i.remainingMinor,
      percentUsed: i.percentUsed,
      state: i.state,
    })),
  };
};
