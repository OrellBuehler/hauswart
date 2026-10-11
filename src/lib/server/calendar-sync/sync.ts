import { eq } from "drizzle-orm";
import type {
  CalendarSyncCounts,
  CalendarTargetConfig,
} from "$lib/api/schemas/calendar-sync";
import { resolveConnection } from "$lib/server/connections/connections";
import { IntegrationError } from "$lib/server/connections/errors";
import { connections } from "$lib/server/db";
import { notFound, type ServiceContext } from "$lib/server/service";
import { buildDesiredItems, readRange, type DesiredItem } from "./items";
import { deleteLink, listLinks, saveLink, setLinkUid } from "./links";
import { getCalendarProvider, NO_UID, type CalendarSession } from "./provider";
import { isRemote, reconcile, type Operation } from "./reconcile";
import {
  configOf,
  getTargetRow,
  recordTargetFailure,
  recordTargetOk,
  saveCapabilities,
  type TargetRow,
} from "./store";

/** The most calendar calls one run makes; what is left is done by the next run, which follows at once. */
export const DEFAULT_MAX_OPERATIONS = 100;
/** A run stops after this many failed calls. */
const MAX_FAILURES = 5;
/**
 * Failures that say the calendar system itself is out of reach or refuses us, so the other calls
 * of the run would fail alike. The rest are about one event and the run goes on with the others.
 */
const SYSTEM_FAILURES = new Set([
  "unauthorized",
  "forbidden",
  "network",
  "timeout",
  "tls",
  "server",
  "redirect",
  "blocked_host",
  "invalid_url",
  "token_unreadable",
]);

export interface SyncFailure {
  code: string;
  message: string;
}

export interface SyncResult {
  ok: boolean;
  error: SyncFailure | null;
  counts: CalendarSyncCounts;
}

export interface SyncOptions {
  maxOperations?: number;
}

export const emptyCounts = (): CalendarSyncCounts => ({
  created: 0,
  updated: 0,
  replaced: 0,
  deleted: 0,
  adopted: 0,
  forgotten: 0,
  skipped: 0,
  failed: 0,
  unconfirmed: 0,
  remaining: 0,
});

const MESSAGES: Record<string, string> = {
  busy: "This calendar is being synced right now.",
  disabled: "This calendar target is switched off.",
  no_connection:
    "The connection to the calendar system is missing or switched off.",
  provider_unavailable: "No adapter for this calendar system is running.",
  unsupported: "The calendar does not allow adding events.",
  calendar_missing: "The calendar does not exist any more.",
  unconfirmed:
    "The calendar did not show events that were just written. It may not keep their description.",
  config_invalid: "The settings of this calendar target are not valid.",
  internal: "An unexpected error occurred.",
};

export function failure(code: string, message?: string): SyncFailure {
  return { code, message: message ?? MESSAGES[code] ?? MESSAGES.internal! };
}

/** What a thrown value means for a run: the adapter's code and message, or `internal` (logged by name only). */
function failureOf(err: unknown): SyncFailure {
  if (err instanceof IntegrationError) {
    return { code: err.code, message: err.message };
  }
  console.error(
    JSON.stringify({
      event: "calendar_sync.unexpected",
      name: err instanceof Error ? err.name : "NonError",
    }),
  );
  return failure("internal");
}

const logFailure = (event: string, code: string, extra: object = {}) =>
  console.error(JSON.stringify({ event, code, ...extra }));

const running = new Set<string>();

/** Whether a run for the target is going on in this process. */
export const isSyncing = (targetId: string) => running.has(targetId);

function unrecorded(error: SyncFailure): SyncResult {
  return { ok: false, error, counts: emptyCounts() };
}

/**
 * Brings the calendar of a target in line with hauswart: reads what the target wants
 * (`buildDesiredItems`), what hauswart remembers (the links) and what the calendar holds, lets
 * `reconcile` decide and applies the steps through the provider. Links are saved after every step,
 * so a run that dies in the middle leaves a state the next run continues from. A failed run is a
 * result (`ok: false` with a code), recorded on the target as its health with the back-off
 * (1, 2, 4 ... 15 minutes); a target that is switched off, whose connection is missing or whose
 * adapter does not run is reported without touching its health. Runs for one target never overlap.
 */
export async function syncTarget(
  ctx: ServiceContext,
  targetId: string,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const row = getTargetRow(ctx, targetId);
  if (!row) throw notFound("Calendar target");
  if (running.has(row.id)) return unrecorded(failure("busy"));
  running.add(row.id);
  try {
    return await run(ctx, row, options);
  } finally {
    running.delete(row.id);
  }
}

async function run(
  ctx: ServiceContext,
  row: TargetRow,
  options: SyncOptions,
): Promise<SyncResult> {
  if (!row.enabled) return unrecorded(failure("disabled"));
  const connection = ctx.db
    .select()
    .from(connections)
    .where(eq(connections.id, row.connectionId))
    .get();
  if (!connection || !connection.enabled) {
    return unrecorded(failure("no_connection"));
  }
  const provider = getCalendarProvider(row.provider);
  if (!provider) return unrecorded(failure("provider_unavailable"));

  const fail = (
    error: SyncFailure,
    counts: CalendarSyncCounts | null = null,
  ) => {
    recordTargetFailure(ctx, row, error.code, counts);
    logFailure("calendar_sync.failed", error.code, { provider: row.provider });
    return { ok: false, error, counts: counts ?? emptyCounts() };
  };

  let config: CalendarTargetConfig;
  try {
    config = configOf(row);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "calendar_sync.config_invalid",
        name: err instanceof Error ? err.name : "NonError",
      }),
    );
    return fail(failure("config_invalid"));
  }

  let session: CalendarSession;
  try {
    session = await provider.open(
      resolveConnection(connection, ctx.db),
      row.remoteCalendarId,
    );
  } catch (err) {
    const error = failureOf(err);
    return fail(
      error.code === "not_found" ? failure("calendar_missing") : error,
    );
  }
  saveCapabilities(ctx, row, session.capabilities);
  if (!session.capabilities.create) return fail(failure("unsupported"));

  let desired: DesiredItem[];
  let plan: ReturnType<typeof reconcile>;
  const range = readRange(ctx.now);
  try {
    desired = await buildDesiredItems(ctx, { config, userId: row.userId });
    const remote = await session.listEvents(range);
    plan = reconcile({
      desired,
      links: listLinks(ctx, row.id),
      remote,
      capabilities: session.capabilities,
      onRemoteDelete: config.onRemoteDelete,
      kinds: new Set(config.kinds),
    });
  } catch (err) {
    return fail(failureOf(err));
  }

  const applied = await applyOperations(ctx, row.id, session, plan.operations, {
    maxOperations: options.maxOperations ?? DEFAULT_MAX_OPERATIONS,
  });
  const counts = applied.counts;
  counts.unconfirmed = plan.unconfirmed.length;

  let error = applied.error;
  if (applied.awaitingUid.size > 0 && !applied.aborted) {
    try {
      const unfound = await confirmUids(
        ctx,
        row.id,
        session,
        range,
        applied.awaitingUid,
      );
      counts.unconfirmed += unfound;
    } catch (err) {
      error ??= failureOf(err);
    }
  }
  if (!error && counts.unconfirmed > 0) error = failure("unconfirmed");
  if (error) return fail(error, counts);
  recordTargetOk(ctx, row.id, counts);
  return { ok: true, error: null, counts };
}

export interface Applied {
  counts: CalendarSyncCounts;
  error: SyncFailure | null;
  /** The run stopped calling the calendar because it is out of reach. */
  aborted: boolean;
  /** Events written without learning the calendar's id for them: ref -> item. */
  awaitingUid: Map<string, DesiredItem>;
}

/**
 * Applies the steps of a plan. Steps that call the calendar are limited to `maxOperations`
 * (`counts.remaining` says how many are left) and stop altogether once the calendar system is out
 * of reach; the steps that only change what hauswart remembers always run. A failed step is counted
 * and the first failure kept; the others go on.
 */
export async function applyOperations(
  ctx: ServiceContext,
  targetId: string,
  session: CalendarSession,
  operations: readonly Operation[],
  options: { maxOperations: number },
): Promise<Applied> {
  const counts = emptyCounts();
  const awaitingUid = new Map<string, DesiredItem>();
  let error: SyncFailure | null = null;
  let aborted = false;
  let calls = 0;

  const written = (item: DesiredItem, uid: string | null, hash = item.hash) => {
    saveLink(ctx, targetId, item, {
      remoteUid: uid,
      status: "synced",
      contentHash: hash,
      pushedAt: ctx.now,
    });
    if (uid === null) awaitingUid.set(item.ref, item);
  };

  for (const op of operations) {
    if (isRemote(op)) {
      if (aborted || calls >= options.maxOperations) {
        counts.remaining++;
        continue;
      }
      calls++;
    }
    try {
      switch (op.type) {
        case "create": {
          const { uid } = await session.create(op.item);
          written(op.item, uid);
          counts.created++;
          break;
        }
        case "update":
          await session.update(op.uid, op.item);
          written(op.item, op.uid);
          counts.updated++;
          break;
        case "replace": {
          await session.delete(op.uid);
          if (op.link) deleteLink(ctx, op.link.id);
          const { uid } = await session.create(op.item);
          written(op.item, uid);
          counts.replaced++;
          break;
        }
        case "delete":
          await deleteEvent(session, op.uid);
          if (op.link) deleteLink(ctx, op.link.id);
          counts.deleted++;
          break;
        case "adopt":
          setLinkUid(ctx, targetId, op.item.ref, op.uid);
          counts.adopted++;
          break;
        case "acknowledge":
          saveLink(ctx, targetId, op.item, {
            remoteUid: op.uid ?? op.link?.remoteUid ?? NO_UID,
            status: "synced",
            contentHash: op.item.hash,
            pushedAt: ctx.now,
          });
          counts.skipped++;
          break;
        case "forget":
          deleteLink(ctx, op.link.id);
          counts.forgotten++;
          break;
        case "tombstone":
          saveLink(ctx, targetId, op.item, {
            remoteUid: null,
            status: "forgotten",
            contentHash: op.item.hash,
            pushedAt: null,
          });
          counts.forgotten++;
          break;
        case "skip":
          counts.skipped++;
          break;
      }
    } catch (err) {
      const problem = failureOf(err);
      counts.failed++;
      error ??= problem;
      logFailure("calendar_sync.operation_failed", problem.code, {
        operation: op.type,
      });
      if (SYSTEM_FAILURES.has(problem.code) || counts.failed >= MAX_FAILURES) {
        aborted = true;
      }
    }
  }
  return { counts, error, aborted, awaitingUid };
}

/** An event that is gone already is what a delete wants. */
async function deleteEvent(session: CalendarSession, uid: string) {
  try {
    await session.delete(uid);
  } catch (err) {
    if (err instanceof IntegrationError && err.code === "not_found") return;
    throw err;
  }
}

/**
 * Looks the events written without a known id up by their ref and stores the ids. Returns how many
 * were not found; those stay without an id and are looked for again by the next run.
 */
async function confirmUids(
  ctx: ServiceContext,
  targetId: string,
  session: CalendarSession,
  range: ReturnType<typeof readRange>,
  awaiting: Map<string, DesiredItem>,
): Promise<number> {
  const events = await session.listEvents(range);
  let missing = 0;
  for (const ref of awaiting.keys()) {
    const found = events.filter((e) => e.ref === ref);
    if (found.length === 0) {
      missing++;
      continue;
    }
    const uid = found
      .map((e) => e.uid)
      .filter((id): id is string => id !== null)
      .sort()[0];
    setLinkUid(ctx, targetId, ref, uid ?? NO_UID);
  }
  return missing;
}
