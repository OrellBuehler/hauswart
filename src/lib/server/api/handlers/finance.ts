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
import { financeProviders } from "$lib/server/finance/providers";
import {
  acceptSuggestion,
  dismissSuggestion,
  listSuggestions,
  payloadOf,
  type SuggestionRow,
} from "$lib/server/finance/suggestions";
import { notFound } from "$lib/server/service";
import type { AuthedContext } from "../context";
import type { Handler } from "../bind";

/**
 * `openBooks` are the books that are not archived: a book offered with a cost suggestion that has been archived or
 * deleted since is shown as no book, so a client never preselects one it cannot book into.
 */
export function wireSuggestion(
  row: SuggestionRow,
  openBooks: ReadonlySet<string>,
): z.input<typeof financeSuggestionSchema> {
  const payload = payloadOf(row);
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    acceptedEntityId: row.acceptedEntityId,
    payload:
      row.kind === "cost" && "bookId" in payload
        ? {
            ...payload,
            bookId:
              payload.bookId && openBooks.has(payload.bookId)
                ? payload.bookId
                : null,
          }
        : payload,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  } as z.input<typeof financeSuggestionSchema>;
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
  const openBooks = openCostBookIds(ctx);
  return {
    items: page.items.map((row) => wireSuggestion(row, openBooks)),
    nextCursor: page.nextCursor,
  };
};

export const accept: Handler<
  typeof endpoints.financeSuggestionsAccept
> = async ({ ctx, params, body }) => {
  const { row, entity } = await acceptSuggestion(
    ctx,
    ctx.user.id,
    params.id,
    body,
  );
  return { suggestion: wireSuggestion(row, openCostBookIds(ctx)), entity };
};

export const dismiss: Handler<typeof endpoints.financeSuggestionsDismiss> = ({
  ctx,
  params,
}) =>
  wireSuggestion(
    dismissSuggestion(ctx, ctx.user.id, params.id),
    openCostBookIds(ctx),
  );

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
