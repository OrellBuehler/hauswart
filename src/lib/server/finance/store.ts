import { and, eq } from "drizzle-orm";
import type { FinanceSuggestionKind } from "$lib/api/enums";
import {
  assetSuggestionPayloadSchema,
  billTaskSuggestionPayloadSchema,
  costSuggestionPayloadSchema,
  storedLinkPayloadSchema,
} from "$lib/api/schemas/finance";
import { financeSuggestions } from "$lib/server/db";
import { parseStored } from "$lib/server/json";
import { notFound, type ServiceContext } from "$lib/server/service";

type Db = Pick<ServiceContext, "db">;

export type SuggestionRow = typeof financeSuggestions.$inferSelect;

const PAYLOADS = {
  cost: costSuggestionPayloadSchema,
  asset: assetSuggestionPayloadSchema,
  bill_task: billTaskSuggestionPayloadSchema,
  link: storedLinkPayloadSchema,
} as const;

/** The payload of a stored suggestion, checked against the shape of its kind. */
export function payloadOf(row: SuggestionRow) {
  return parseStored(PAYLOADS[row.kind], row.payloadJson, "finance suggestion");
}

export function findSuggestion(
  ctx: Db,
  connectionId: string,
  kind: FinanceSuggestionKind,
  providerRef: string,
): SuggestionRow | undefined {
  return ctx.db
    .select()
    .from(financeSuggestions)
    .where(
      and(
        eq(financeSuggestions.connectionId, connectionId),
        eq(financeSuggestions.kind, kind),
        eq(financeSuggestions.providerRef, providerRef),
      ),
    )
    .get();
}

export function markAccepted(
  ctx: Db,
  id: string,
  entityId: string,
): SuggestionRow {
  return ctx.db
    .update(financeSuggestions)
    .set({ status: "accepted", acceptedEntityId: entityId })
    .where(eq(financeSuggestions.id, id))
    .returning()
    .get();
}

/** One of the person's own suggestions; another person's is a 404, exactly like a missing one. */
export function getOwnSuggestion(
  ctx: Db,
  userId: string,
  id: string,
): SuggestionRow {
  const row = ctx.db
    .select()
    .from(financeSuggestions)
    .where(
      and(eq(financeSuggestions.id, id), eq(financeSuggestions.userId, userId)),
    )
    .get();
  if (!row) throw notFound("Suggestion");
  return row;
}
