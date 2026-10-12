import type { z } from "zod";
import type { endpoints } from "$lib/api/registry";
import type { financeSuggestionSchema } from "$lib/api/schemas/finance";
import { toIso } from "$lib/api/schemas/common";
import type { IntegrationKind } from "$lib/api/enums";
import {
  getConnectionRow,
  ownerFor,
  runOperation,
} from "$lib/server/connections/connections";
import { openCostBookIds } from "$lib/server/costs/books";
import {
  linkedEntries,
  type LinkedEntrySummary,
} from "$lib/server/finance/links";
import { financeProviders } from "$lib/server/finance/providers";
import {
  acceptSuggestion,
  dismissSuggestion,
  listSuggestions,
  matchingCostSuggestions,
  payloadOf,
  type SuggestionRow,
} from "$lib/server/finance/suggestions";
import { getHousehold } from "$lib/server/household/household";
import { notFound } from "$lib/server/service";
import type { AuthedContext } from "../context";
import type { Handler } from "../bind";

/** A book offered with a cost suggestion that has been archived or deleted since is shown as no book. */
const offeredBook = (bookId: string | null, openBooks: ReadonlySet<string>) =>
  bookId && openBooks.has(bookId) ? bookId : null;

/**
 * `openBooks` are the books that are not archived: a book offered with a cost suggestion that has been archived or
 * deleted since is shown as no book, so a client never preselects one it cannot book into. `entries` are the cost
 * entries link suggestions point at, as they are now (see `linkedEntries`).
 */
export function wireSuggestion(
  row: SuggestionRow,
  openBooks: ReadonlySet<string>,
  entries: ReadonlyMap<string, LinkedEntrySummary> = new Map(),
): z.input<typeof financeSuggestionSchema> {
  const payload = payloadOf(row);
  const wired =
    row.kind === "cost" && "bookId" in payload
      ? { ...payload, bookId: offeredBook(payload.bookId, openBooks) }
      : row.kind === "link" && "transaction" in payload
        ? {
            entryId: payload.entryId,
            entry: entries.get(payload.entryId) ?? null,
            transaction: {
              ...payload.transaction,
              bookId: offeredBook(payload.transaction.bookId, openBooks),
            },
          }
        : payload;
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    acceptedEntityId: row.acceptedEntityId,
    payload: wired,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  } as z.input<typeof financeSuggestionSchema>;
}

/** Several suggestions at once: the entries their links point at are read together. */
export function wireSuggestions(
  ctx: AuthedContext,
  rows: readonly SuggestionRow[],
) {
  const openBooks = openCostBookIds(ctx);
  const entries = linkedEntries(
    ctx,
    rows.flatMap((row) =>
      row.kind === "link"
        ? [(payloadOf(row) as { entryId: string }).entryId]
        : [],
    ),
  );
  return rows.map((row) => wireSuggestion(row, openBooks, entries));
}

export const listAll: Handler<typeof endpoints.financeSuggestionsList> = ({
  ctx,
  query,
}) => {
  const { cursor, limit, kind, status } = query;
  const page = listSuggestions(
    ctx,
    ctx.user.id,
    { kind, status },
    { cursor, limit },
  );
  return {
    items: wireSuggestions(ctx, page.items),
    nextCursor: page.nextCursor,
  };
};

export const matches: Handler<typeof endpoints.financeMatches> = ({
  ctx,
  query,
}) => ({
  items: wireSuggestions(
    ctx,
    matchingCostSuggestions(ctx, ctx.user.id, {
      amountMinor: query.amountMinor,
      currency: query.currency ?? getHousehold(ctx).currency,
      date: query.date,
    }),
  ) as never,
});

export const accept: Handler<
  typeof endpoints.financeSuggestionsAccept
> = async ({ ctx, params, body }) => {
  const { row, entity } = await acceptSuggestion(
    ctx,
    ctx.user.id,
    params.id,
    body,
  );
  return { suggestion: wireSuggestions(ctx, [row])[0], entity };
};

export const dismiss: Handler<typeof endpoints.financeSuggestionsDismiss> = ({
  ctx,
  params,
}) => wireSuggestions(ctx, [dismissSuggestion(ctx, ctx.user.id, params.id)])[0];

export const sync: Handler<typeof endpoints.financeSync> = async ({ ctx }) => {
  for (const provider of financeProviders()) {
    const row = getConnectionRow(ctx, provider.kind, ctx.user.id);
    if (!row?.enabled) continue;
    const result = await provider.sync(ctx, row);
    return {
      ok: result.ok,
      error: result.error ?? null,
      stats: result.stats,
    };
  }
  throw notFound("Finance connection");
};

function ownOperation(ctx: AuthedContext, kind: IntegrationKind, name: string) {
  return runOperation(ctx, kind, ownerFor(kind, ctx.user.id), name, {});
}

export const categories: Handler<
  typeof endpoints.integrationsCategories
> = async ({ ctx, params }) =>
  (await ownOperation(ctx, params.kind, "categories")) as never;

export const accounts: Handler<typeof endpoints.integrationsAccounts> = async ({
  ctx,
  params,
}) => (await ownOperation(ctx, params.kind, "accounts")) as never;
