import type { z } from "zod";
import type { endpoints } from "$lib/api/registry";
import type { costBookSchema } from "$lib/api/schemas/cost-books";
import { toIso } from "$lib/api/schemas/common";
import {
  createCostBook,
  deleteCostBook,
  getCostBook,
  listCostBooks,
  updateCostBook,
  type CostBookRecord,
} from "$lib/server/costs/books";
import type { Handler } from "../bind";

export function wireCostBook(
  b: CostBookRecord,
): z.input<typeof costBookSchema> {
  return {
    id: b.id,
    name: b.name,
    slug: b.slug,
    icon: b.icon,
    defaultSplitMode: b.defaultSplitMode,
    taxRelevant: b.taxRelevant,
    archivedAt: b.archivedAt ? toIso(b.archivedAt) : null,
    sortOrder: b.sortOrder,
    isDefault: b.isDefault,
    entryCount: b.entryCount,
    settlementCount: b.settlementCount,
    createdAt: toIso(b.createdAt),
    updatedAt: toIso(b.updatedAt),
  };
}

export const list: Handler<typeof endpoints.costBooksList> = ({
  ctx,
  query,
}) => {
  const page = listCostBooks(ctx, query, query);
  return { items: page.items.map(wireCostBook), nextCursor: page.nextCursor };
};

export const create: Handler<typeof endpoints.costBooksCreate> = ({
  ctx,
  body,
}) => wireCostBook(createCostBook(ctx, body));

export const get: Handler<typeof endpoints.costBooksGet> = ({ ctx, params }) =>
  wireCostBook(getCostBook(ctx, params.id));

export const update: Handler<typeof endpoints.costBooksUpdate> = ({
  ctx,
  params,
  body,
}) => wireCostBook(updateCostBook(ctx, params.id, body));

export const remove: Handler<typeof endpoints.costBooksDelete> = ({
  ctx,
  params,
}) => {
  deleteCostBook(ctx, params.id);
  return null;
};
