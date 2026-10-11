import { asc, eq, isNull, or } from "drizzle-orm";
import {
  CALENDAR_ITEM_KINDS,
  INTEGRATION_LEVELS,
  type CalendarProviderKind,
  type IntegrationStatus,
  type UserLocale,
} from "$lib/api/enums";
import { ApiError } from "$lib/api/errors";
import {
  calendarTargetConfigSchema,
  type CalendarSyncCounts,
  type CalendarTargetCapabilities,
  type CalendarTargetConfig,
  type CreateCalendarTargetRequest,
  type UpdateCalendarTargetRequest,
} from "$lib/api/schemas/calendar-sync";
import {
  getConnectionRow,
  resolveConnection,
} from "$lib/server/connections/connections";
import { IntegrationError } from "$lib/server/connections/errors";
import { calendarTargets, connections } from "$lib/server/db";
import { emitEvent } from "$lib/server/events";
import {
  conflict,
  forbidden,
  invalidField,
  isUniqueViolation,
  notFound,
  type ServiceContext,
} from "$lib/server/service";
import { readRange } from "./items";
import { countLinks, listLinks } from "./links";
import {
  getCalendarProvider,
  type CalendarProvider,
  type CalendarSession,
} from "./provider";
import { reconcile } from "./reconcile";
import { nextAttemptAt } from "./schedule";
import {
  configOf,
  getTargetRow,
  MAX_REMOTE_NAME,
  statsOf,
  type TargetRow,
} from "./store";
import {
  applyOperations,
  lockTarget,
  syncTarget,
  type SyncResult,
} from "./sync";

type Db = Pick<ServiceContext, "db">;

/** Who is asking: administrators manage the household's targets, everybody their own. */
export interface Caller {
  id: string;
  admin: boolean;
  locale: UserLocale;
}

export interface TargetView {
  id: string;
  provider: CalendarProviderKind;
  level: "household" | "user";
  ownerId: string | null;
  remoteCalendarId: string;
  remoteName: string | null;
  name: string;
  enabled: boolean;
  config: CalendarTargetConfig;
  capabilities: CalendarTargetCapabilities | null;
  status: IntegrationStatus;
  lastError: string | null;
  lastOkAt: Date | null;
  lastCheckedAt: Date | null;
  /** Not before when it is tried again; null when it is switched off or was never tried. */
  nextAttemptAt: Date | null;
  consecutiveFailures: number;
  lastStats: CalendarSyncCounts | null;
  eventCount: number;
  canManage: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** The most calendar calls it takes to remove a target's events in one request. */
const REMOVE_LIMIT = 1000;
const DAY_MS = 86_400_000;

const mayManage = (row: TargetRow, caller: Caller) =>
  row.userId === null ? caller.admin : row.userId === caller.id;

export function toView(ctx: Db, row: TargetRow, caller: Caller): TargetView {
  return {
    id: row.id,
    provider: row.provider,
    level: row.level,
    ownerId: row.userId,
    remoteCalendarId: row.remoteCalendarId,
    remoteName: row.remoteName,
    name: row.name,
    enabled: row.enabled,
    config: configOf(row),
    capabilities: row.capabilitiesJson,
    status: row.status,
    lastError: row.lastError,
    lastOkAt: row.lastOkAt,
    lastCheckedAt: row.lastCheckedAt,
    nextAttemptAt: nextAttemptAt(row),
    consecutiveFailures: row.consecutiveFailures,
    lastStats: statsOf(row),
    eventCount: countLinks(ctx, row.id),
    canManage: mayManage(row, caller),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The household's targets and the caller's own, household ones first. */
export function listTargets(ctx: Db, caller: Caller): TargetView[] {
  return ctx.db
    .select()
    .from(calendarTargets)
    .where(
      or(isNull(calendarTargets.userId), eq(calendarTargets.userId, caller.id)),
    )
    .orderBy(
      asc(calendarTargets.level),
      asc(calendarTargets.createdAt),
      asc(calendarTargets.id),
    )
    .all()
    .map((row) => toView(ctx, row, caller));
}

/** A target the caller may see; another person's is a 404 exactly like a missing one. */
function visibleRow(ctx: Db, caller: Caller, id: string): TargetRow {
  const row = getTargetRow(ctx, id);
  if (!row || (row.userId !== null && row.userId !== caller.id)) {
    throw notFound("Calendar target");
  }
  return row;
}

/** A target the caller may change: household ones are administrators' business. */
function manageableRow(ctx: Db, caller: Caller, id: string): TargetRow {
  const row = visibleRow(ctx, caller, id);
  if (!mayManage(row, caller)) {
    throw forbidden("Only administrators change the household's calendars.");
  }
  return row;
}

/**
 * The 400 on `remoteCalendarId` for a calendar the target cannot use. `details.code` tells which
 * (`calendar_not_found`, `calendar_unsupported`), so a client words them apart without the English.
 */
function calendarRefused(
  code: "calendar_not_found" | "calendar_unsupported",
  message: string,
): ApiError {
  const base = invalidField("remoteCalendarId", message);
  return new ApiError("invalid_request", "Invalid request", {
    details: { ...(base.details as object), code },
  });
}

/** An adapter failure as the API shows it; a calendar that is not there is the caller's mistake. */
function upstream(err: unknown): never {
  if (err instanceof IntegrationError) {
    if (err.code === "not_found") {
      throw calendarRefused(
        "calendar_not_found",
        "This calendar was not found.",
      );
    }
    throw new ApiError("upstream_error", err.message, {
      details: { code: err.code },
    });
  }
  throw err;
}

function providerOf(kind: CalendarProviderKind): CalendarProvider {
  const provider = getCalendarProvider(kind);
  if (!provider) {
    throw new ApiError("not_found", "This integration is not available");
  }
  return provider;
}

/** The settings with the kinds in their canonical order, as they are stored. */
function ordered(config: CalendarTargetConfig): CalendarTargetConfig {
  return {
    ...config,
    kinds: CALENDAR_ITEM_KINDS.filter((kind) => config.kinds.includes(kind)),
  };
}

/** `mine` means the person's own tasks; a household target has no person. */
function assertScope(
  level: "household" | "user",
  config: CalendarTargetConfig,
) {
  if (level === "household" && config.scope === "mine") {
    throw invalidField(
      "config",
      "A calendar of the household has no owner, so its scope can only be all.",
    );
  }
}

/**
 * Adds a calendar to push into. The level follows the kind of connection (the household's, or the
 * caller's own), the calendar is opened once to see that it exists and allows adding events, and
 * the first sync follows at once.
 */
export async function createTarget(
  ctx: ServiceContext,
  caller: Caller,
  input: CreateCalendarTargetRequest,
): Promise<TargetView> {
  const level = INTEGRATION_LEVELS[input.provider];
  if (level === "household" && !caller.admin) {
    throw forbidden("Only administrators add calendars of the household.");
  }
  assertScope(level, input.config);
  const owner = level === "household" ? null : caller.id;
  const connection = getConnectionRow(ctx, input.provider, owner);
  if (!connection || !connection.enabled) throw notFound("Connection");
  const provider = providerOf(input.provider);

  let session: CalendarSession;
  try {
    session = await provider.open(
      resolveConnection(connection, ctx.db),
      input.remoteCalendarId,
    );
  } catch (err) {
    return upstream(err);
  }
  if (!session.capabilities.create) {
    throw calendarRefused(
      "calendar_unsupported",
      "This calendar does not allow adding events.",
    );
  }

  let row: TargetRow;
  try {
    row = ctx.db
      .insert(calendarTargets)
      .values({
        connectionId: connection.id,
        provider: input.provider,
        remoteCalendarId: input.remoteCalendarId,
        remoteName: session.name.slice(0, MAX_REMOTE_NAME),
        name: (input.name ?? session.name).slice(0, 100),
        level,
        userId: owner,
        enabled: input.enabled,
        configJson: ordered(input.config),
        capabilitiesJson: session.capabilities,
      })
      .returning()
      .get();
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict("This calendar already has a target.");
    }
    throw err;
  }
  emitEvent("calendarTargetChanged", { ctx, targetId: row.id });
  return toView(ctx, row, caller);
}

/** Changes the name, whether it is on, or settings (merged over the stored ones); the next sync applies them. */
export function updateTarget(
  ctx: ServiceContext,
  caller: Caller,
  id: string,
  input: UpdateCalendarTargetRequest,
): TargetView {
  const row = manageableRow(ctx, caller, id);
  const changes = Object.fromEntries(
    Object.entries(input.config ?? {}).filter(
      ([, value]) => value !== undefined,
    ),
  );
  const config = ordered(
    calendarTargetConfigSchema.parse({
      ...configOf(row),
      ...changes,
    }),
  );
  assertScope(row.level, config);
  const updated = ctx.db
    .update(calendarTargets)
    .set({
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.config === undefined ? {} : { configJson: config }),
    })
    .where(eq(calendarTargets.id, row.id))
    .returning()
    .get();
  emitEvent("calendarTargetChanged", { ctx, targetId: row.id });
  return toView(ctx, updated, caller);
}

/**
 * Removes a target and what hauswart remembers about its events. With `removeRemote` the events
 * hauswart wrote are deleted from the calendar first (it needs a calendar that allows deleting, and
 * a connection that is on); without it they stay where they are.
 *
 * Removing the events holds the target's run lock, so no sync can write them again meanwhile; a
 * sync that is going on makes the request a 409 `conflict` (`details.code` `busy`) at once rather
 * than wait for a run that may take minutes. If the removal stops half way, the target is left
 * switched off (the answer says so), because the items still exist and the next sync would write
 * the removed events again; deleting it once more goes on from there.
 */
export async function deleteTarget(
  ctx: ServiceContext,
  caller: Caller,
  id: string,
  options: { removeRemote?: boolean } = {},
): Promise<void> {
  const row = manageableRow(ctx, caller, id);
  if (!options.removeRemote) {
    removeRow(ctx, row.id);
    return;
  }
  const release = lockTarget(row.id);
  if (!release) {
    throw conflict(
      "A sync of this calendar is running right now. Try again in a moment.",
      { code: "busy" },
    );
  }
  try {
    await removeRemoteEvents(ctx, row);
    removeRow(ctx, row.id);
  } finally {
    release();
  }
}

const removeRow = (ctx: Db, id: string) =>
  ctx.db.delete(calendarTargets).where(eq(calendarTargets.id, id)).run();

async function removeRemoteEvents(
  ctx: ServiceContext,
  row: TargetRow,
): Promise<void> {
  const connection = ctx.db
    .select()
    .from(connections)
    .where(eq(connections.id, row.connectionId))
    .get();
  if (!connection) throw notFound("Connection");
  if (!connection.enabled) {
    throw conflict(
      "The connection is switched off. Switch it on to remove the events, or delete the calendar without removing them.",
    );
  }
  const provider = providerOf(row.provider);
  let session: CalendarSession;
  try {
    session = await provider.open(
      resolveConnection(connection, ctx.db),
      row.remoteCalendarId,
    );
  } catch (err) {
    // A calendar that is gone has no events left to remove.
    if (err instanceof IntegrationError && err.code === "not_found") return;
    return upstream(err);
  }
  if (!session.capabilities.delete) {
    throw invalidField(
      "removeRemote",
      "This calendar does not allow deleting events.",
      "query",
    );
  }
  let remote;
  // Wider than a sync reads: events written long ago are ours to remove as well.
  const range = {
    from: ctx.now - 5 * 365 * DAY_MS,
    to: readRange(ctx.now).to + 365 * DAY_MS,
  };
  try {
    remote = await session.listEvents(range);
  } catch (err) {
    return upstream(err);
  }
  const plan = reconcile({
    desired: [],
    links: listLinks(ctx, row.id),
    remote,
    capabilities: session.capabilities,
    onRemoteDelete: "recreate",
    kinds: new Set(CALENDAR_ITEM_KINDS),
    now: ctx.now,
  });
  // From here events are removed: if that stops, the target stays off so a sync does not write them again.
  if (row.enabled) {
    ctx.db
      .update(calendarTargets)
      .set({ enabled: false })
      .where(eq(calendarTargets.id, row.id))
      .run();
  }
  const applied = await applyOperations(ctx, row.id, session, plan.operations, {
    maxOperations: REMOVE_LIMIT,
    range,
  });
  if (applied.error || applied.counts.remaining > 0) {
    throw new ApiError(
      "upstream_error",
      `${
        applied.error?.message ?? "There are too many events to remove at once."
      } The calendar was switched off so that the events are not written again; delete it once more to remove the rest.`,
      {
        details: {
          code: applied.error?.code ?? "too_many",
          deleted: applied.counts.deleted,
          remaining: applied.counts.remaining + applied.counts.failed,
          disabled: true,
        },
      },
    );
  }
}

export interface SyncNow {
  result: SyncResult;
  target: TargetView;
}

/** Runs a sync now, whatever the back-off says. A failed run is a result, not an error. */
export async function syncNow(
  ctx: ServiceContext,
  caller: Caller,
  id: string,
): Promise<SyncNow> {
  const row = manageableRow(ctx, caller, id);
  const result = await syncTarget(ctx, row.id);
  const fresh = getTargetRow(ctx, row.id);
  if (!fresh) throw notFound("Calendar target");
  return { result, target: toView(ctx, fresh, caller) };
}
