import type { z } from "zod";
import type { endpoints } from "$lib/api/registry";
import type { costEntrySchema } from "$lib/api/schemas/costs";
import { toIso } from "$lib/api/schemas/common";
import { costBalances } from "$lib/server/costs/balances";
import { getCostBookRow } from "$lib/server/costs/books";
import {
  deleteCost,
  getCost,
  listCosts,
  recordCost,
  reviewCost,
  updateCost,
  type CostRecord,
} from "$lib/server/costs/costs";
import { costsCsv } from "$lib/server/costs/csv";
import { moveCostsToBook } from "$lib/server/costs/move";
import { recentCategories } from "$lib/server/costs/recent-categories";
import { costsSummary } from "$lib/server/costs/summary";
import { invalidField } from "$lib/server/service";
import { reply, type Handler } from "../bind";

const yearOf = (today: string) => Number(today.slice(0, 4));

export function wireCost(
  c: CostRecord,
  viewerId: string,
): z.input<typeof costEntrySchema> {
  return {
    id: c.id,
    bookId: c.bookId,
    bookName: c.bookName,
    bookTaxRelevant: c.bookTaxRelevant,
    date: c.date,
    title: c.title,
    amountMinor: c.amountMinor,
    currency: c.currency,
    category: c.category,
    assetId: c.assetId,
    assetName: c.assetName,
    roomId: c.roomId,
    roomName: c.roomName,
    defectId: c.defectId,
    defectNumber: c.defectNumber,
    defectTitle: c.defectTitle,
    serviceLogId: c.serviceLogId,
    serviceLogTitle: c.serviceLogTitle,
    payee: c.payee,
    notes: c.notes,
    paidByUserId: c.paidByUserId,
    paidByName: c.paidByName,
    splitMode: c.splitMode,
    shares: c.shares,
    countsAsExpense: c.countsAsExpense,
    deductible: c.deductible,
    source: c.source,
    // The address of the item in the person's own finance app is theirs alone.
    providerUrl: c.createdBy === viewerId ? c.providerUrl : null,
    fuelLogId: c.fuelLogId,
    reviewNeeded: c.reviewNeeded,
    reviewedAt: c.reviewedAt ? toIso(c.reviewedAt) : null,
    reviewedByUserId: c.reviewedByUserId,
    receiptTaskId: c.aiTaskId,
    commentCount: c.commentCount,
    createdBy: c.createdBy,
    createdAt: toIso(c.createdAt),
    updatedAt: toIso(c.updatedAt),
  };
}

export const list: Handler<typeof endpoints.costsList> = ({ ctx, query }) => {
  const { cursor, limit, ...filter } = query;
  const page = listCosts(ctx, filter, { cursor, limit }, ctx.user.id);
  return {
    items: page.items.map((c) => wireCost(c, ctx.user.id)),
    nextCursor: page.nextCursor,
  };
};

export const create: Handler<typeof endpoints.costsCreate> = ({
  ctx,
  body,
}) => {
  const { cost, replayed } = recordCost(ctx, body, ctx.user.id);
  const out = wireCost(cost, ctx.user.id);
  return replayed ? reply(200, out) : out;
};

export const get: Handler<typeof endpoints.costsGet> = ({ ctx, params }) =>
  wireCost(getCost(ctx, params.id), ctx.user.id);

export const update: Handler<typeof endpoints.costsUpdate> = ({
  ctx,
  params,
  body,
}) => wireCost(updateCost(ctx, params.id, body), ctx.user.id);

export const remove: Handler<typeof endpoints.costsDelete> = ({
  ctx,
  params,
}) => {
  deleteCost(ctx, params.id);
  return null;
};

export const review: Handler<typeof endpoints.costsReview> = ({
  ctx,
  params,
}) => wireCost(reviewCost(ctx, params.id, ctx.user.id), ctx.user.id);

export const moveToBook: Handler<typeof endpoints.costsMoveToBook> = ({
  ctx,
  body,
}) => moveCostsToBook(ctx, body);

export const summary: Handler<typeof endpoints.costsSummary> = ({
  ctx,
  query,
}) =>
  costsSummary(ctx, query.year ?? yearOf(ctx.today), {
    assetId: query.assetId,
    bookId: query.bookId,
  });

export const recentCategoryCounts: Handler<
  typeof endpoints.costsRecentCategories
> = ({ ctx, query }) => recentCategories(ctx, query);

export const balances: Handler<typeof endpoints.costsBalances> = ({
  ctx,
  query,
}) => {
  if (query.bookId && query.all === true) {
    throw invalidField("all", "Give a book or all=true, not both", "query");
  }
  if (!query.bookId && query.all === false) {
    throw invalidField("bookId", "A book is needed when all=false", "query");
  }
  return costBalances(ctx, { bookId: query.bookId });
};

export const exportCsv: Handler<typeof endpoints.costsExport> = ({
  ctx,
  query,
}) => {
  const year = query.year ?? yearOf(ctx.today);
  const book = query.bookId ? getCostBookRow(ctx, query.bookId) : undefined;
  const name = book
    ? `hauswart-costs-${year}-${book.slug}`
    : `hauswart-costs-${year}`;
  return new Response(costsCsv(ctx, year, { bookId: query.bookId }), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}.csv"`,
    },
  });
};
