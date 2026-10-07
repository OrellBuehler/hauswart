import { and, count, desc, eq, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type {
  FinanceSuggestionKind,
  FinanceSuggestionStatus,
} from "$lib/api/enums";
import type { CreateCostRequest } from "$lib/api/schemas/costs";
import {
  assetSuggestionPayloadSchema,
  billTaskSuggestionPayloadSchema,
  costSuggestionPayloadSchema,
  type AcceptFinanceSuggestionRequest,
} from "$lib/api/schemas/finance";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import { createAsset } from "$lib/server/assets/assets";
import { createCost, updateCost } from "$lib/server/costs/costs";
import {
  connections,
  costEntries,
  financeSuggestions,
  type DB,
} from "$lib/server/db";
import { parseStored } from "$lib/server/json";
import { decodeCursor, pageOf } from "$lib/server/pagination";
import {
  conflict,
  invalidField,
  notFound,
  type ServiceContext,
} from "$lib/server/service";
import { clockAt } from "$lib/server/tasks/evaluator";
import { upsertFinanceBillTask } from "./bill-tasks";

export type SuggestionRow = typeof financeSuggestions.$inferSelect;

/** `assets.externalSource` of assets created from a suggestion of a transaction. */
export const FINANCE_ASSET_SOURCE = "finance_transaction";

const PAYLOADS = {
  cost: costSuggestionPayloadSchema,
  asset: assetSuggestionPayloadSchema,
  bill_task: billTaskSuggestionPayloadSchema,
} as const;

/** The payload of a stored suggestion, checked against the shape of its kind. */
export function payloadOf(row: SuggestionRow) {
  return parseStored(PAYLOADS[row.kind], row.payloadJson, "finance suggestion");
}

export interface SuggestionInput {
  connectionId: string;
  userId: string;
  kind: FinanceSuggestionKind;
  providerRef: string;
  payload: Record<string, unknown>;
  billRefs?: string[];
}

/**
 * Records what a provider offers one person. A new item becomes `pending`; an
 * item seen before keeps its status (a dismissed one stays dismissed, an
 * accepted one stays accepted) and only a pending one takes the fresh
 * payload, so a corrected description reaches the inbox.
 */
export function recordSuggestion(
  ctx: Pick<ServiceContext, "db">,
  input: SuggestionInput,
  status: FinanceSuggestionStatus = "pending",
): { row: SuggestionRow; created: boolean } {
  const existing = ctx.db
    .select()
    .from(financeSuggestions)
    .where(
      and(
        eq(financeSuggestions.connectionId, input.connectionId),
        eq(financeSuggestions.kind, input.kind),
        eq(financeSuggestions.providerRef, input.providerRef),
      ),
    )
    .get();
  if (existing) {
    if (existing.status !== "pending") return { row: existing, created: false };
    const row = ctx.db
      .update(financeSuggestions)
      .set({
        payloadJson: input.payload,
        billRefsJson: input.billRefs ?? [],
      })
      .where(eq(financeSuggestions.id, existing.id))
      .returning()
      .get();
    return { row, created: false };
  }
  const row = ctx.db
    .insert(financeSuggestions)
    .values({
      connectionId: input.connectionId,
      userId: input.userId,
      kind: input.kind,
      providerRef: input.providerRef,
      payloadJson: input.payload,
      billRefsJson: input.billRefs ?? [],
      status,
    })
    .returning()
    .get();
  return { row, created: true };
}

/** The cost suggestions (any status) of the connection that name this bill as settled by them. */
export function suggestionsCoveringBill(
  ctx: Pick<ServiceContext, "db">,
  connectionId: string,
  billRef: string,
): SuggestionRow[] {
  return ctx.db
    .select()
    .from(financeSuggestions)
    .where(
      and(
        eq(financeSuggestions.connectionId, connectionId),
        eq(financeSuggestions.kind, "cost"),
        sql`exists (select 1 from json_each(${financeSuggestions.billRefsJson}) where json_each.value = ${billRef})`,
      ),
    )
    .all();
}

export function findSuggestion(
  ctx: Pick<ServiceContext, "db">,
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
  ctx: Pick<ServiceContext, "db">,
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

/** Drops a pending suggestion that another one made redundant. */
export function discardSuggestion(
  ctx: Pick<ServiceContext, "db">,
  id: string,
): void {
  ctx.db
    .delete(financeSuggestions)
    .where(
      and(
        eq(financeSuggestions.id, id),
        eq(financeSuggestions.status, "pending"),
      ),
    )
    .run();
}

const cursorSchema = z.object({ t: z.number().int(), id: z.string() });

/** The person's own suggestions, newest first. Other people's rows are never selected. */
export function listSuggestions(
  ctx: Pick<ServiceContext, "db">,
  userId: string,
  filter: { kind?: FinanceSuggestionKind; status: FinanceSuggestionStatus },
  page: { cursor?: string; limit: number },
) {
  const where: SQL[] = [
    eq(financeSuggestions.userId, userId),
    eq(financeSuggestions.status, filter.status),
  ];
  if (filter.kind) where.push(eq(financeSuggestions.kind, filter.kind));
  if (page.cursor) {
    const at = decodeCursor(page.cursor, cursorSchema);
    where.push(
      or(
        lt(financeSuggestions.createdAt, new Date(at.t)),
        and(
          eq(financeSuggestions.createdAt, new Date(at.t)),
          lt(financeSuggestions.id, at.id),
        ),
      ) as SQL,
    );
  }
  const rows = ctx.db
    .select()
    .from(financeSuggestions)
    .where(and(...where))
    .orderBy(desc(financeSuggestions.createdAt), desc(financeSuggestions.id))
    .limit(page.limit + 1)
    .all();
  return pageOf(rows, page.limit, (r) => ({
    t: r.createdAt.getTime(),
    id: r.id,
  }));
}

/** How many of the person's own suggestions wait for a decision. */
export function countPendingSuggestions(
  ctx: Pick<ServiceContext, "db">,
  userId: string,
): number {
  return (
    ctx.db
      .select({ n: count() })
      .from(financeSuggestions)
      .where(
        and(
          eq(financeSuggestions.userId, userId),
          eq(financeSuggestions.status, "pending"),
        ),
      )
      .get()?.n ?? 0
  );
}

/** One of the person's own suggestions; another person's is a 404, exactly like a missing one. */
export function getOwnSuggestion(
  ctx: Pick<ServiceContext, "db">,
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

export function dismissSuggestion(
  ctx: Pick<ServiceContext, "db">,
  userId: string,
  id: string,
): SuggestionRow {
  const row = getOwnSuggestion(ctx, userId, id);
  if (row.status === "accepted") {
    throw conflict("This suggestion was accepted already");
  }
  if (row.status === "dismissed") return row;
  return ctx.db
    .update(financeSuggestions)
    .set({ status: "dismissed" })
    .where(eq(financeSuggestions.id, id))
    .returning()
    .get();
}

const ONLY: Record<FinanceSuggestionKind, readonly string[]> = {
  cost: [
    "title",
    "category",
    "notes",
    "assetId",
    "roomId",
    "defectId",
    "serviceLogId",
    "paidByUserId",
    "splitMode",
    "shares",
    "countsAsExpense",
    "deductible",
  ],
  asset: ["name", "assetKind", "roomId"],
  bill_task: ["title"],
};

function assertOverrides(
  kind: FinanceSuggestionKind,
  body: AcceptFinanceSuggestionRequest,
) {
  for (const key of Object.keys(body)) {
    if (!ONLY[kind].includes(key)) {
      throw invalidField(key, `Not applicable to a ${kind} suggestion`);
    }
  }
}

export interface Accepted {
  row: SuggestionRow;
  entity: { type: "cost" | "asset" | "task"; id: string };
}

/** The cost entry a suggestion becomes: the provider's facts, the person as payer, split by ownership unless the body says otherwise. */
function costInput(
  row: SuggestionRow,
  body: AcceptFinanceSuggestionRequest,
): CreateCostRequest {
  const p = payloadOf(row) as z.output<typeof costSuggestionPayloadSchema>;
  return {
    date: p.date,
    title: body.title ?? p.title,
    amountMinor: p.amountMinor,
    currency: p.currency,
    category: body.category ?? p.category,
    assetId: body.assetId !== undefined ? body.assetId : p.assetId,
    roomId: body.roomId,
    defectId: body.defectId,
    serviceLogId: body.serviceLogId,
    payee: p.payee,
    notes: body.notes,
    paidByUserId:
      body.paidByUserId !== undefined ? body.paidByUserId : row.userId,
    splitMode: body.splitMode ?? "ownership",
    shares: body.shares,
    countsAsExpense: body.countsAsExpense,
    deductible: body.deductible ?? "unknown",
  };
}

/**
 * Turns the person's pending suggestion into what it offers: a cost entry
 * (booked with the transaction as its origin, so it is never booked twice), an
 * asset, or a bill task. Everything happens in one transaction.
 */
export async function acceptSuggestion(
  ctx: ServiceContext,
  userId: string,
  id: string,
  body: AcceptFinanceSuggestionRequest,
): Promise<Accepted> {
  const row = getOwnSuggestion(ctx, userId, id);
  if (row.status !== "pending") {
    throw conflict(
      row.status === "accepted"
        ? "This suggestion was accepted already"
        : "This suggestion was dismissed",
    );
  }
  assertOverrides(row.kind, body);

  if (row.kind === "bill_task") {
    const p = payloadOf(row) as z.output<
      typeof billTaskSuggestionPayloadSchema
    >;
    const connection = ctx.db
      .select()
      .from(connections)
      .where(eq(connections.id, row.connectionId))
      .get();
    if (!connection) throw notFound("Connection");
    const { taskId } = await upsertFinanceBillTask(ctx, {
      connectionId: row.connectionId,
      kind: connection.kind,
      ownerId: row.userId,
      billId: row.providerRef,
      title: body.title ?? p.title,
      dueDate: p.dueDate,
      status: p.dueDate < clockAt(ctx.now).today ? "overdue" : "open",
      amountMinor: p.amountMinor,
      currency: p.currency,
      url: p.url,
    });
    if (!taskId) throw conflict("The task cannot be created");
    return {
      row: markAccepted(ctx, row.id, taskId),
      entity: { type: "task", id: taskId },
    };
  }

  if (row.kind === "asset") {
    const p = payloadOf(row) as z.output<typeof assetSuggestionPayloadSchema>;
    const asset = ctx.db.transaction((tx) => {
      const inner = { ...ctx, db: tx as unknown as DB };
      const created = createAsset(
        inner,
        createAssetRequestSchema.parse({
          kind: body.assetKind ?? "device",
          name: body.name ?? p.name,
          roomId: body.roomId ?? null,
          purchaseDate: p.purchaseDate,
          externalSource: FINANCE_ASSET_SOURCE,
          externalRef: `${row.connectionId}:${row.providerRef}`,
        }),
      );
      attachAssetToCost(inner, row, created.id);
      markAccepted(inner, row.id, created.id);
      return created;
    });
    return {
      row: getOwnSuggestion(ctx, userId, id),
      entity: { type: "asset", id: asset.id },
    };
  }

  const cost = ctx.db.transaction((tx) => {
    const inner = { ...ctx, db: tx as unknown as DB };
    const origin = {
      source: (payloadOf(row) as z.output<typeof costSuggestionPayloadSchema>)
        .source as "finance_transaction" | "finance_bill",
      connectionId: row.connectionId,
      ref: row.providerRef,
      url: (payloadOf(row) as z.output<typeof costSuggestionPayloadSchema>).url,
    };
    const created = createCost(inner, costInput(row, body), userId, origin);
    markAccepted(inner, row.id, created.id);
    return created;
  });
  return {
    row: getOwnSuggestion(ctx, userId, id),
    entity: { type: "cost", id: cost.id },
  };
}

/**
 * The asset of a purchase belongs to the cost of the same transaction:
 * a pending cost suggestion offers it as default, a booked entry gets it.
 */
function attachAssetToCost(
  ctx: ServiceContext,
  asset: SuggestionRow,
  assetId: string,
) {
  const cost = ctx.db
    .select()
    .from(financeSuggestions)
    .where(
      and(
        eq(financeSuggestions.connectionId, asset.connectionId),
        eq(financeSuggestions.kind, "cost"),
        eq(financeSuggestions.providerRef, asset.providerRef),
      ),
    )
    .get();
  if (!cost) return;
  if (cost.status === "pending") {
    ctx.db
      .update(financeSuggestions)
      .set({ payloadJson: { ...cost.payloadJson, assetId } })
      .where(eq(financeSuggestions.id, cost.id))
      .run();
  } else if (cost.status === "accepted" && cost.acceptedEntityId) {
    const entry = ctx.db
      .select({ id: costEntries.id, assetId: costEntries.assetId })
      .from(costEntries)
      .where(eq(costEntries.id, cost.acceptedEntityId))
      .get();
    if (entry && entry.assetId === null) {
      updateCost(ctx, entry.id, { assetId });
    }
  }
}
