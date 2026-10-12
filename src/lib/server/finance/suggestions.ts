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
  type FinanceMatchesQuery,
} from "$lib/api/schemas/finance";
import { MATCH_DAYS } from "$lib/costs/match";
import { addDays, diffDays } from "$lib/dates";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import { createAsset } from "$lib/server/assets/assets";
import { openCostBookId } from "$lib/server/costs/books";
import { createCost, updateCost } from "$lib/server/costs/costs";
import {
  connections,
  costEntries,
  financeSuggestions,
  type DB,
} from "$lib/server/db";
import { decodeCursor, pageOf } from "$lib/server/pagination";
import {
  conflict,
  invalidField,
  notFound,
  type ServiceContext,
} from "$lib/server/service";
import { clockAt } from "$lib/server/tasks/evaluator";
import { upsertFinanceBillTask } from "./bill-tasks";
import {
  acceptLink,
  dismissLink,
  findMatchingEntry,
  insertLinkSuggestion,
} from "./links";
import {
  findSuggestion,
  getOwnSuggestion,
  markAccepted,
  payloadOf,
  type SuggestionRow,
} from "./store";

export { findSuggestion, getOwnSuggestion, markAccepted, payloadOf };
export type { SuggestionRow };

/** `assets.externalSource` of assets created from a suggestion of a transaction. */
export const FINANCE_ASSET_SOURCE = "finance_transaction";

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
 *
 * A new pending **cost** that looks like an entry somebody booked by hand (`findMatchingEntry`: the same amount and
 * currency, at most 3 days apart, similar text, paid by this person, not tied to a finance item yet) is recorded as a
 * `link` suggestion instead, so accepting it ties the entry to the transaction and books nothing twice; dismissing the
 * link offers the transaction as a cost after all. An item that is a link already stays one (its transaction is
 * refreshed while it waits). Something recorded as already decided is never linked.
 */
export function recordSuggestion(
  ctx: Pick<ServiceContext, "db">,
  input: SuggestionInput,
  status: FinanceSuggestionStatus = "pending",
): { row: SuggestionRow; created: boolean } {
  const existing = findSuggestion(
    ctx,
    input.connectionId,
    input.kind,
    input.providerRef,
  );
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
  if (input.kind === "cost") {
    const tied = findSuggestion(
      ctx,
      input.connectionId,
      "link",
      input.providerRef,
    );
    if (tied) return { row: refreshLink(ctx, tied, input), created: false };
    const payload = costSuggestionPayloadSchema.safeParse(input.payload);
    if (status === "pending" && payload.success) {
      const entry = findMatchingEntry(ctx, input.userId, payload.data);
      if (entry) {
        return {
          row: insertLinkSuggestion(ctx, {
            connectionId: input.connectionId,
            userId: input.userId,
            providerRef: input.providerRef,
            entryId: entry.id,
            transaction: payload.data,
            billRefs: input.billRefs ?? [],
          }),
          created: true,
        };
      }
    }
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

/** A pending link takes the transaction as the provider reports it now; a decided one stays as it is. */
function refreshLink(
  ctx: Pick<ServiceContext, "db">,
  link: SuggestionRow,
  input: SuggestionInput,
): SuggestionRow {
  const payload = costSuggestionPayloadSchema.safeParse(input.payload);
  if (link.status !== "pending" || !payload.success) return link;
  const { entryId } = payloadOf(link) as { entryId: string };
  return ctx.db
    .update(financeSuggestions)
    .set({
      payloadJson: { entryId, transaction: payload.data },
      billRefsJson: input.billRefs ?? [],
    })
    .where(eq(financeSuggestions.id, link.id))
    .returning()
    .get();
}

/**
 * The cost suggestions (any status) of the connection that name this bill as settled by them, and the links of
 * transactions that do (pending or accepted ones; a dismissed link was replaced by a cost suggestion).
 */
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
        or(
          eq(financeSuggestions.kind, "cost"),
          and(
            eq(financeSuggestions.kind, "link"),
            sql`${financeSuggestions.status} <> 'dismissed'`,
          ),
        ),
        sql`exists (select 1 from json_each(${financeSuggestions.billRefsJson}) where json_each.value = ${billRef})`,
      ),
    )
    .all();
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
  if (row.kind === "link") {
    return ctx.db.transaction((tx) =>
      dismissLink({ db: tx as unknown as DB }, row),
    );
  }
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
    "bookId",
    "category",
    "notes",
    "assetId",
    "roomId",
    "defectId",
    "serviceLogId",
    "paidByUserId",
    "splitMode",
    "shares",
    "participantIds",
    "countsAsExpense",
    "deductible",
    "tagIds",
    "receiptTaskId",
  ],
  asset: ["name", "assetKind", "roomId"],
  bill_task: ["title"],
  link: [],
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

/**
 * The cost entry a suggestion becomes: the provider's facts, the person as payer, in the book the body names, else the
 * one offered with the suggestion (`offeredBookId`, when it is still open), else the default book, and split as that
 * book says (or as the body says).
 */
function costInput(
  row: SuggestionRow,
  body: AcceptFinanceSuggestionRequest,
  offeredBookId: string | undefined,
): CreateCostRequest {
  const p = payloadOf(row) as z.output<typeof costSuggestionPayloadSchema>;
  return {
    bookId: body.bookId ?? offeredBookId,
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
    splitMode: body.splitMode,
    shares: body.shares,
    participantIds: body.participantIds,
    countsAsExpense: body.countsAsExpense,
    deductible: body.deductible ?? "unknown",
    tagIds: body.tagIds,
    receiptTaskId: body.receiptTaskId,
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

  if (row.kind === "link") {
    const { row: accepted, entryId } = acceptLink(ctx, row);
    return { row: accepted, entity: { type: "cost", id: entryId } };
  }

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
    const offered = (
      payloadOf(row) as z.output<typeof costSuggestionPayloadSchema>
    ).bookId;
    const created = createCost(
      inner,
      costInput(row, body, openCostBookId(inner, offered)),
      userId,
      origin,
    );
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

/** How many suggestions `matchingCostSuggestions` answers at most. */
export const MATCHES_LIMIT = 20;

/**
 * The person's own pending cost suggestions that could be the entry being typed: the same amount and currency, booked at
 * most 3 days from `date`. Nearest date first, then the newest offer. Strictly the caller's own.
 */
export function matchingCostSuggestions(
  ctx: Pick<ServiceContext, "db">,
  userId: string,
  query: Required<FinanceMatchesQuery>,
): SuggestionRow[] {
  const field = (name: string) =>
    sql`json_extract(${financeSuggestions.payloadJson}, ${`$.${name}`})`;
  return ctx.db
    .select()
    .from(financeSuggestions)
    .where(
      and(
        eq(financeSuggestions.userId, userId),
        eq(financeSuggestions.kind, "cost"),
        eq(financeSuggestions.status, "pending"),
        sql`${field("amountMinor")} = ${query.amountMinor}`,
        sql`${field("currency")} = ${query.currency}`,
        sql`${field("date")} >= ${addDays(query.date, -MATCH_DAYS)}`,
        sql`${field("date")} <= ${addDays(query.date, MATCH_DAYS)}`,
      ),
    )
    .all()
    .map((row) => ({
      row,
      days: Math.abs(
        diffDays((payloadOf(row) as { date: string }).date, query.date),
      ),
    }))
    .sort(
      (a, b) =>
        a.days - b.days ||
        b.row.createdAt.getTime() - a.row.createdAt.getTime() ||
        b.row.id.localeCompare(a.row.id),
    )
    .slice(0, MATCHES_LIMIT)
    .map((m) => m.row);
}
