import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import {
  assets,
  costEntries,
  costLinkRemovals,
  financeSyncState,
} from "$lib/server/db";
import {
  recordConnectionFailure,
  recordConnectionOk,
  resolveConnection,
  type ConnectionRow,
} from "$lib/server/connections/connections";
import {
  activeBillTasks,
  archiveBillTask,
  archiveSettledBillTasks,
  upsertFinanceBillTask,
  type BillTaskOutcome,
} from "$lib/server/finance/bill-tasks";
import type { FinanceSyncResult } from "$lib/server/finance/providers";
import {
  acceptSuggestion,
  discardSuggestion,
  recordSuggestion,
  suggestionsCoveringBill,
} from "$lib/server/finance/suggestions";
import type { ServiceContext } from "$lib/server/service";
import { clockAt } from "$lib/server/tasks/evaluator";
import { KeptClient } from "./client";
import { storedConfig, type KeptConfig } from "./config";
import { KIND, LINK_SOURCE, appOrigin, clientFor } from "./connection";
import { KeptError, describeError, errorCode } from "./errors";
import {
  SEED_TEXT_MAX,
  billTitle,
  billToTaskSeed,
  transactionToAssetSuggestion,
  transactionToCostSeed,
} from "./mappers";
import type { KeptBill, KeptTransaction } from "./schemas";

export const TX_PREFIX = "tx:";
export const BILL_PREFIX = "bill:";
/** How many back-links one run writes at most. */
export const LINKS_PER_RUN = 50;

export interface SyncStats extends Record<string, number> {
  suggestions: number;
  autoAccepted: number;
  assetSuggestions: number;
  tasksCreated: number;
  tasksUpdated: number;
  tasksCompleted: number;
  tasksReopened: number;
  tasksArchived: number;
  skipped: number;
  linksWritten: number;
  linksRemoved: number;
  linksFailed: number;
}

const emptyStats = (): SyncStats => ({
  suggestions: 0,
  autoAccepted: 0,
  assetSuggestions: 0,
  tasksCreated: 0,
  tasksUpdated: 0,
  tasksCompleted: 0,
  tasksReopened: 0,
  tasksArchived: 0,
  skipped: 0,
  linksWritten: 0,
  linksRemoved: 0,
  linksFailed: 0,
});

/** Codes only: messages can carry addresses, and finance data never reaches a log. */
function log(event: string, err: unknown) {
  console.error(JSON.stringify({ event, code: errorCode(err) }));
}

const clip = (text: string, max = SEED_TEXT_MAX) => {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
};

const isNewer = (a: string, b: string | null) =>
  b === null || Date.parse(a) > Date.parse(b);

interface Run {
  ctx: ServiceContext;
  row: ConnectionRow;
  ownerId: string;
  client: KeptClient;
  config: KeptConfig;
  stats: SyncStats;
}

function stateOf(ctx: Pick<ServiceContext, "db">, connectionId: string) {
  return ctx.db
    .select()
    .from(financeSyncState)
    .where(eq(financeSyncState.connectionId, connectionId))
    .get();
}

function saveState(
  ctx: ServiceContext,
  connectionId: string,
  values: Partial<typeof financeSyncState.$inferInsert>,
) {
  ctx.db
    .insert(financeSyncState)
    .values({ connectionId, lastRunAt: new Date(ctx.now), ...values })
    .onConflictDoUpdate({
      target: financeSyncState.connectionId,
      set: { lastRunAt: new Date(ctx.now), ...values },
    })
    .run();
}

// ---- transactions -----------------------------------------------------------

/**
 * One transaction of a mapped category becomes a cost suggestion (or, in an
 * automatic category, a cost entry at once); one in a purchase category may
 * also become an asset suggestion. The payment of a bill is booked once: an
 * offer made from the bill gives way, and a decision already taken on the bill
 * stands for the payment too.
 */
async function offerTransaction(run: Run, tx: KeptTransaction): Promise<void> {
  const { ctx, row, ownerId, config, stats } = run;
  const seed =
    tx.amount === 0 ? null : transactionToCostSeed(tx, config.categoryMap);
  if (seed) {
    const covering = seed.billIds.flatMap((billId) =>
      suggestionsCoveringBill(ctx, row.id, billId).filter((s) =>
        s.providerRef.startsWith(BILL_PREFIX),
      ),
    );
    const decided = covering.some((s) => s.status !== "pending");
    for (const s of covering) {
      if (s.status === "pending") discardSuggestion(ctx, s.id);
    }
    const { row: suggestion, created } = recordSuggestion(
      ctx,
      {
        connectionId: row.id,
        userId: ownerId,
        kind: "cost",
        providerRef: `${TX_PREFIX}${tx.id}`,
        billRefs: seed.billIds,
        payload: {
          source: "finance_transaction",
          date: seed.date,
          amountMinor: seed.amountMinor,
          currency: seed.currency,
          title: clip(seed.description ?? seed.payee ?? "—"),
          payee: seed.payee === null ? null : clip(seed.payee),
          category: seed.category,
          url: seed.url,
          assetId: null,
        },
      },
      decided ? "dismissed" : "pending",
    );
    if (decided && created) stats.skipped++;
    if (suggestion.status === "pending") {
      if (
        tx.categoryId !== null &&
        config.autoAcceptCategoryIds.includes(tx.categoryId)
      ) {
        await acceptSuggestion(ctx, ownerId, suggestion.id, {});
        stats.autoAccepted++;
      } else if (created) {
        stats.suggestions++;
      }
    }
  }
  const asset = transactionToAssetSuggestion(
    tx,
    new Set(config.purchaseCategoryIds),
  );
  if (asset) {
    const { created } = recordSuggestion(ctx, {
      connectionId: row.id,
      userId: ownerId,
      kind: "asset",
      providerRef: `${TX_PREFIX}${tx.id}`,
      payload: {
        name: clip(asset.name),
        purchaseDate: asset.purchaseDate,
        priceMinor: asset.priceMinor,
        currency: asset.currency,
        url: asset.url,
      },
    });
    if (created) stats.assetSuggestions++;
  }
}

const scopeOf = (parts: Array<string | undefined>) =>
  parts.map((p) => p ?? "").join("|");

/** Transactions of the mapped and purchase categories since the last run. */
async function syncTransactions(run: Run): Promise<void> {
  const { ctx, row, client, config } = run;
  const ids = [
    ...new Set([
      ...Object.keys(config.categoryMap),
      ...config.purchaseCategoryIds,
    ]),
  ].sort();
  if (ids.length === 0) return;
  const from = config.syncFrom ?? `${clockAt(ctx.now).today.slice(0, 4)}-01-01`;
  const scope = scopeOf([from, ...ids]);
  const state = stateOf(ctx, row.id);
  const since =
    state?.transactionsScope === scope ? state.transactionsSince : null;
  let newest = since;
  let firstError: unknown;
  for (const categoryId of ids) {
    for await (const page of client.iterateTransactions({
      categoryId,
      from,
      ...(since === null ? {} : { updatedSince: since }),
    })) {
      for (const tx of page) {
        try {
          await offerTransaction(run, tx);
        } catch (err) {
          firstError ??= err;
          log("kept.transaction_failed", err);
        }
        if (isNewer(tx.updatedAt, newest)) newest = tx.updatedAt;
      }
    }
  }
  // A transaction that failed is read again next time (everything is idempotent).
  if (firstError !== undefined) throw firstError;
  saveState(ctx, row.id, {
    transactionsSince: newest,
    transactionsScope: scope,
  });
}

// ---- bills ------------------------------------------------------------------

const normal = (value: string | null) => (value ?? "").trim().toLowerCase();

function creditorAllowed(config: KeptConfig, bill: KeptBill): boolean {
  if (config.billCreditorFilter.length === 0) return true;
  const creditor = normal(bill.creditorName);
  return config.billCreditorFilter.some((c) => normal(c) === creditor);
}

function countTask(stats: SyncStats, outcome: BillTaskOutcome) {
  if (outcome === "created") stats.tasksCreated++;
  else if (outcome === "updated") stats.tasksUpdated++;
  else if (outcome === "completed") stats.tasksCompleted++;
  else if (outcome === "reopened") stats.tasksReopened++;
}

/** The task of a bill follows the bill. A bill without a due date cannot be a task. */
async function followBill(
  run: Run,
  bill: KeptBill,
  fallbackDueDate: string | null,
): Promise<void> {
  const seed = billToTaskSeed(bill);
  const dueDate = seed.dueDate ?? fallbackDueDate;
  if (dueDate === null) {
    run.stats.skipped++;
    return;
  }
  const { outcome } = await upsertFinanceBillTask(run.ctx, {
    connectionId: run.row.id,
    kind: KIND,
    ownerId: run.ownerId,
    billId: bill.id,
    title: seed.title,
    dueDate,
    status: seed.status,
    // What is still to pay while it needs paying; the invoiced total once it is settled.
    amountMinor:
      seed.status === "open" || seed.status === "overdue"
        ? (seed.remainingMinor ?? seed.amountMinor)
        : seed.amountMinor,
    currency: seed.currency,
    url: seed.url,
  });
  countTask(run.stats, outcome);
}

/**
 * Open and overdue bills become tasks; tasks of bills that left that list
 * are brought up to date from the bill itself (paid, cancelled, open again)
 * or archived when Kept no longer knows it.
 */
async function syncBillTasks(run: Run): Promise<void> {
  const { ctx, row, client, config, stats } = run;
  const seen = new Set<string>();
  let firstError: unknown;
  for await (const page of client.iterateBills({
    status: ["open", "overdue"],
  })) {
    for (const bill of page) {
      seen.add(bill.id);
      if (!creditorAllowed(config, bill)) continue;
      try {
        await followBill(run, bill, null);
      } catch (err) {
        firstError ??= err;
        log("kept.bill_failed", err);
      }
    }
  }
  // Without the full list, "not listed" would mean nothing.
  if (firstError !== undefined) throw firstError;
  for (const task of activeBillTasks(ctx, row.id)) {
    // Settled tasks need no more calls: a bill that becomes payable again shows up in the open list.
    if (seen.has(task.billId) || task.status === "paid") continue;
    if (task.status === "cancelled") continue;
    try {
      let bill: KeptBill | null;
      try {
        bill = await client.getBill(task.billId);
      } catch (err) {
        if (!(err instanceof KeptError && err.code === "not_found")) throw err;
        bill = null;
      }
      if (bill === null) {
        await archiveBillTask(ctx, task.taskId);
        stats.tasksArchived++;
      } else {
        await followBill(run, bill, task.dueDate);
      }
    } catch (err) {
      firstError ??= err;
      log("kept.bill_failed", err);
    }
  }
  if (firstError !== undefined) throw firstError;
}

/** Paid invoices that no mapped transaction covers are offered as costs (when a category is set for them). */
async function syncPaidBills(run: Run): Promise<void> {
  const { ctx, row, ownerId, client, config, stats } = run;
  const category = config.billCostCategory;
  if (category === undefined) return;
  const from = config.syncFrom ?? `${clockAt(ctx.now).today.slice(0, 4)}-01-01`;
  const scope = scopeOf([from, category]);
  const state = stateOf(ctx, row.id);
  const since = state?.billsScope === scope ? state.billsSince : null;
  let newest = since;
  let firstError: unknown;
  for await (const page of client.iterateBills({
    status: ["paid"],
    ...(since === null ? {} : { updatedSince: since }),
  })) {
    for (const bill of page) {
      if (isNewer(bill.updatedAt, newest)) newest = bill.updatedAt;
      if (
        bill.kind !== "invoice" ||
        bill.amount === null ||
        bill.amount === 0 ||
        !creditorAllowed(config, bill)
      ) {
        continue;
      }
      const date =
        bill.lastPaymentDate ??
        bill.dueDate ??
        bill.issueDate ??
        clockAt(ctx.now).today;
      if (date < from) continue;
      try {
        const own = `${BILL_PREFIX}${bill.id}`;
        const covered = suggestionsCoveringBill(ctx, row.id, bill.id).some(
          (s) => s.providerRef !== own,
        );
        if (covered) continue;
        const { created } = recordSuggestion(ctx, {
          connectionId: row.id,
          userId: ownerId,
          kind: "cost",
          providerRef: own,
          billRefs: [bill.id],
          payload: {
            source: "finance_bill",
            date,
            amountMinor: bill.amount,
            currency: bill.currency,
            title: billTitle(bill),
            payee: bill.creditorName === null ? null : clip(bill.creditorName),
            category,
            url: bill.url,
            assetId: null,
          },
        });
        if (created) stats.suggestions++;
      } catch (err) {
        firstError ??= err;
        log("kept.bill_failed", err);
      }
    }
  }
  if (firstError !== undefined) throw firstError;
  saveState(ctx, row.id, { billsSince: newest, billsScope: scope });
}

// ---- back-links ----------------------------------------------------------------

function refTarget(ref: string): { type: "transaction" | "bill"; id: string } {
  return ref.startsWith(BILL_PREFIX)
    ? { type: "bill", id: ref.slice(BILL_PREFIX.length) }
    : { type: "transaction", id: ref.slice(TX_PREFIX.length) };
}

/** Failures that retrying will not fix: the item is gone, or Kept refuses more links on it. */
const PERMANENT = new Set(["not_found", "conflict", "invalid_input"]);

/**
 * Removes the back-links of deleted entries and writes or refreshes those of
 * booked ones. What fails stays queued (`linkSyncedAt` null, the removal row)
 * and is retried by the next run; a failure of the connection itself stops
 * the round so a broken token is not hammered.
 */
export async function syncLinks(
  ctx: ServiceContext,
  row: ConnectionRow,
  client: KeptClient,
  stats: SyncStats,
): Promise<void> {
  const removals = ctx.db
    .select()
    .from(costLinkRemovals)
    .where(eq(costLinkRemovals.connectionId, row.id))
    .orderBy(asc(costLinkRemovals.createdAt))
    .limit(LINKS_PER_RUN)
    .all();
  for (const removal of removals) {
    try {
      await client.deleteLink(removal.linkId);
    } catch (err) {
      // A link Kept no longer has is as good as removed.
      if (!(err instanceof KeptError && err.code === "not_found")) {
        stats.linksFailed++;
        log("kept.link_remove_failed", err);
        throw err;
      }
    }
    ctx.db
      .delete(costLinkRemovals)
      .where(eq(costLinkRemovals.id, removal.id))
      .run();
    stats.linksRemoved++;
  }

  const origin = appOrigin();
  const pending = ctx.db
    .select({ cost: costEntries, assetName: assets.name })
    .from(costEntries)
    .leftJoin(assets, eq(assets.id, costEntries.assetId))
    .where(
      and(
        eq(costEntries.providerConnectionId, row.id),
        isNotNull(costEntries.providerRef),
        isNull(costEntries.linkSyncedAt),
      ),
    )
    .orderBy(asc(costEntries.createdAt))
    .limit(LINKS_PER_RUN)
    .all();
  if (pending.length > 0 && origin === null) {
    console.warn(
      JSON.stringify({ event: "kept.link_skipped", code: "no_origin" }),
    );
    return;
  }
  for (const { cost, assetName } of pending) {
    const target = refTarget(cost.providerRef as string);
    try {
      const { link } = await client.upsertLink(target.type, target.id, {
        source: LINK_SOURCE,
        label: clip(
          assetName ? `${cost.title} (${assetName})` : cost.title,
          200,
        ),
        url: `${origin}/costs/${cost.id}`,
      });
      const stillThere = ctx.db
        .select({ id: costEntries.id })
        .from(costEntries)
        .where(eq(costEntries.id, cost.id))
        .get();
      if (!stillThere) {
        // Deleted while the link was being written: take it back at once, or queue the removal.
        await client.deleteLink(link.id).catch((err: unknown) => {
          log("kept.link_remove_failed", err);
          ctx.db
            .insert(costLinkRemovals)
            .values({ connectionId: row.id, linkId: link.id })
            .run();
        });
        continue;
      }
      // Only mark it current when nothing changed meanwhile; otherwise the next run refreshes the label.
      const marked = ctx.db
        .update(costEntries)
        .set({
          providerLinkId: link.id,
          linkSyncedAt: new Date(ctx.now),
          updatedAt: cost.updatedAt,
        })
        .where(
          and(
            eq(costEntries.id, cost.id),
            eq(costEntries.updatedAt, cost.updatedAt),
          ),
        )
        .returning({ id: costEntries.id })
        .all();
      if (marked.length === 0) {
        ctx.db
          .update(costEntries)
          .set({ providerLinkId: link.id, updatedAt: cost.updatedAt })
          .where(eq(costEntries.id, cost.id))
          .run();
      }
      stats.linksWritten++;
    } catch (err) {
      stats.linksFailed++;
      log("kept.link_failed", err);
      if (err instanceof KeptError && PERMANENT.has(err.code)) {
        // Nothing to retry: Kept does not know the item or will take no more links on it.
        ctx.db
          .update(costEntries)
          .set({ linkSyncedAt: new Date(ctx.now), updatedAt: cost.updatedAt })
          .where(eq(costEntries.id, cost.id))
          .run();
        continue;
      }
      throw err;
    }
  }
}

// ---- one run ----------------------------------------------------------------

const inFlight = new Map<string, Promise<FinanceSyncResult>>();

/**
 * Runs one sync of a person's connection: transactions, bills and back-links
 * (each part on its own, so one failing part does not stop the others), then
 * records the outcome as the connection's health. Never throws for a failure
 * of Kept: the result says what happened. A second call while one is running
 * shares its result.
 */
export function syncConnection(
  ctx: ServiceContext,
  row: ConnectionRow,
): Promise<FinanceSyncResult> {
  const running = inFlight.get(row.id);
  if (running) return running;
  const promise = runSync(ctx, row).finally(() => inFlight.delete(row.id));
  inFlight.set(row.id, promise);
  return promise;
}

async function runSync(
  ctx: ServiceContext,
  row: ConnectionRow,
): Promise<FinanceSyncResult> {
  const stats = emptyStats();
  const fail = (err: unknown): FinanceSyncResult => {
    recordConnectionFailure(ctx, row, errorCode(err));
    return {
      ok: false,
      error: { code: errorCode(err), message: describeError(err) },
      stats,
    };
  };
  if (row.userId === null) {
    return fail(new KeptError("invalid_input", { detail: "no owner" }));
  }
  let connection;
  try {
    connection = resolveConnection(row);
  } catch (err) {
    log("kept.sync_failed", err);
    return fail(err);
  }
  const run: Run = {
    ctx,
    row,
    ownerId: row.userId,
    client: clientFor(connection),
    config: storedConfig(row.configJson),
    stats,
  };

  const failures: unknown[] = [];
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      log(`kept.${name}_failed`, err);
      failures.push(err);
    }
  };
  await step("transactions", () => syncTransactions(run));
  if (run.config.billTasks) await step("bills", () => syncBillTasks(run));
  await step("paid_bills", () => syncPaidBills(run));
  await step("links", () => syncLinks(ctx, row, run.client, stats));

  if (failures.length === 0) {
    recordConnectionOk(ctx, row.id);
    return { ok: true, stats };
  }
  return fail(failures[0]);
}

/** Only the back-links of one connection (after an entry was booked, changed or deleted). */
export async function syncLinksOf(
  ctx: ServiceContext,
  row: ConnectionRow,
  connection: ReturnType<typeof resolveConnection>,
): Promise<SyncStats> {
  const stats = emptyStats();
  try {
    await syncLinks(ctx, row, clientFor(connection), stats);
  } catch (err) {
    log("kept.links_failed", err);
  }
  return stats;
}

/** Archives the tasks of long settled bills and of connections that are gone. */
export async function housekeeping(ctx: ServiceContext): Promise<number> {
  return archiveSettledBillTasks(ctx);
}
