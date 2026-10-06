import { and, eq, isNull } from "drizzle-orm";
import {
  INTEGRATION_LEVELS,
  INTEGRATION_KINDS,
  type IntegrationKind,
  type IntegrationStatus,
} from "$lib/api/enums";
import { ApiError } from "$lib/api/errors";
import { decryptSecret, encryptSecret } from "$lib/server/crypto";
import { connections, getDB, users, type DB } from "$lib/server/db";
import { emitEvent } from "$lib/server/events";
import { getHousehold } from "$lib/server/household/household";
import { isHostAllowed } from "$lib/hosts";
import {
  HostPolicyError,
  assertHostAllowed,
} from "$lib/server/net/host-policy";
import {
  invalidField,
  notFound,
  type ServiceContext,
} from "$lib/server/service";
import { IntegrationError } from "./errors";
import {
  getIntegration,
  type ConnectionTestResult,
  type ResolvedConnection,
} from "./registry";

type Db = Pick<ServiceContext, "db">;
export type ConnectionRow = typeof connections.$inferSelect;

/** Who owns the connection of a kind for this caller: nobody (the household's) or the person. */
export function ownerFor(kind: IntegrationKind, userId: string): string | null {
  return INTEGRATION_LEVELS[kind] === "household" ? null : userId;
}

export function getConnectionRow(
  ctx: Db,
  kind: IntegrationKind,
  userId: string | null,
): ConnectionRow | undefined {
  return ctx.db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.kind, kind),
        userId === null
          ? isNull(connections.userId)
          : eq(connections.userId, userId),
      ),
    )
    .get();
}

/** Every enabled connection of a kind (adapters iterate these). */
export function listEnabledConnections(
  ctx: Db,
  kind: IntegrationKind,
): ConnectionRow[] {
  return ctx.db
    .select()
    .from(connections)
    .where(and(eq(connections.kind, kind), eq(connections.enabled, true)))
    .all();
}

/** The row with its token decrypted. A token that cannot be decrypted is an `IntegrationError`. */
export function resolveConnection(
  row: ConnectionRow,
  db: DB = getDB(),
): ResolvedConnection {
  let token: string;
  try {
    token = decryptSecret(row.tokenEnc);
  } catch (cause) {
    throw new IntegrationError(
      "token_unreadable",
      "The stored access token cannot be read. Enter it again.",
      { cause },
    );
  }
  return {
    id: row.id,
    kind: row.kind,
    userId: row.userId,
    baseUrl: row.baseUrl,
    token,
    allowInsecureTls: row.allowInsecureTls,
    allowLoopback: mayReachLoopback(row, db),
    config: row.configJson,
  };
}

/** Household-wide connections and those owned by an administrator (looked up now, so a demotion applies at once). */
function mayReachLoopback(row: ConnectionRow, db: DB): boolean {
  if (row.userId === null) return true;
  const owner = db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, row.userId))
    .get();
  return owner?.role === "admin";
}

/** What the API shows of a connection: never the token. */
export interface ConnectionView {
  kind: IntegrationKind;
  level: "household" | "user";
  /** Whether an adapter for this kind is running in this server. */
  available: boolean;
  capabilities: string[];
  configured: boolean;
  enabled: boolean;
  baseUrl: string | null;
  allowInsecureTls: boolean;
  config: Record<string, unknown>;
  status: IntegrationStatus;
  lastError: string | null;
  lastOkAt: Date | null;
  lastCheckedAt: Date | null;
  consecutiveFailures: number;
}

export function toView(
  kind: IntegrationKind,
  row: ConnectionRow | undefined,
  options: { showAddress: boolean },
): ConnectionView {
  const adapter = getIntegration(kind);
  return {
    kind,
    level: INTEGRATION_LEVELS[kind],
    available: adapter !== undefined,
    capabilities: adapter?.describe().capabilities ?? [],
    configured: row !== undefined,
    enabled: row?.enabled ?? false,
    baseUrl: row && options.showAddress ? row.baseUrl : null,
    allowInsecureTls: row?.allowInsecureTls ?? false,
    config: row && options.showAddress ? row.configJson : {},
    status: row?.status ?? "unknown",
    lastError: row?.lastError ?? null,
    lastOkAt: row?.lastOkAt ?? null,
    lastCheckedAt: row?.lastCheckedAt ?? null,
    consecutiveFailures: row?.consecutiveFailures ?? 0,
  };
}

/** One entry per kind: the household's connection, or the caller's own for kinds each person connects. */
export function listConnectionViews(
  ctx: Db,
  userId: string,
  options: { isAdmin: boolean },
): ConnectionView[] {
  return INTEGRATION_KINDS.map((kind) =>
    toView(kind, getConnectionRow(ctx, kind, ownerFor(kind, userId)), {
      showAddress: INTEGRATION_LEVELS[kind] === "user" || options.isAdmin,
    }),
  );
}

const TOKEN_PATTERN = /^[\x21-\x7e]{1,4096}$/;

export interface SaveConnectionInput {
  baseUrl: string;
  /** Required for a new connection and whenever the address changes; otherwise blank keeps the stored one. */
  token?: string | null;
  allowInsecureTls: boolean;
  config?: Record<string, unknown>;
  enabled?: boolean;
}

function normalise(
  kind: IntegrationKind,
  input: { baseUrl: string; config: Record<string, unknown> },
): { baseUrl: string; config: Record<string, unknown> } {
  const adapter = getIntegration(kind);
  try {
    if (adapter?.validate) return adapter.validate(input);
  } catch (err) {
    if (err instanceof IntegrationError) {
      throw invalidField("baseUrl", err.message);
    }
    throw err;
  }
  let url: URL;
  try {
    url = new URL(input.baseUrl.trim());
  } catch {
    throw invalidField("baseUrl", "Enter a valid http:// or https:// address.");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password
  ) {
    throw invalidField("baseUrl", "Enter a valid http:// or https:// address.");
  }
  return {
    baseUrl: `${url.origin}${url.pathname.replace(/\/+$/, "")}`,
    config: input.config,
  };
}

/**
 * Where a person may point a connection, checked when it is saved (the request-time check in
 * `integrations/http.ts` repeats the address rules). Members of the household may only use hosts
 * on the household's allow-list for the kinds each person connects themselves, because the
 * server fetches that address on their behalf; administrators may use any host (and saving never
 * adds one to the list). For everybody the host, after name resolution, must not be link-local
 * or a cloud metadata endpoint, and loopback is for administrators and household connections.
 */
export async function vetConnectionTarget(
  ctx: Db,
  kind: IntegrationKind,
  input: { baseUrl: string; isAdmin: boolean },
): Promise<void> {
  let url: URL;
  try {
    url = new URL(input.baseUrl.trim());
  } catch {
    throw invalidField("baseUrl", "Enter a valid http:// or https:// address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw invalidField("baseUrl", "Enter a valid http:// or https:// address.");
  }
  const memberOfUserKind =
    !input.isAdmin && INTEGRATION_LEVELS[kind] === "user";
  if (
    memberOfUserKind &&
    !isHostAllowed(
      url.href,
      getHousehold(ctx).settings.integrationHostAllowlist,
    )
  ) {
    throw new ApiError(
      "forbidden",
      `The host ${url.host} is not on the household's list of allowed hosts. Ask an administrator to add it (Settings, Household) or to connect it for you.`,
    );
  }
  try {
    await assertHostAllowed(url, { allowLoopback: input.isAdmin });
  } catch (err) {
    if (!(err instanceof HostPolicyError)) throw err;
    if (err.reason === "loopback") {
      throw new ApiError("forbidden", err.message);
    }
    throw invalidField("baseUrl", err.message);
  }
}

/**
 * Creates or updates the connection of `kind` for `userId` (null = the
 * household's). A changed address needs the token again, so a stored token
 * can never be redirected to another host by an address edit.
 */
export function saveConnection(
  ctx: ServiceContext,
  kind: IntegrationKind,
  userId: string | null,
  input: SaveConnectionInput,
): ConnectionRow {
  const existing = getConnectionRow(ctx, kind, userId);
  const { baseUrl, config } = normalise(kind, {
    baseUrl: input.baseUrl,
    config: input.config ?? existing?.configJson ?? {},
  });
  const token = input.token?.trim() ? input.token.trim() : null;
  if (token !== null && !TOKEN_PATTERN.test(token)) {
    throw invalidField(
      "token",
      "The access token contains invalid characters.",
    );
  }
  if (token === null && (!existing || existing.baseUrl !== baseUrl)) {
    throw invalidField(
      "token",
      existing
        ? "Enter the access token again when the address changes."
        : "Enter the access token.",
    );
  }
  const reset = token !== null || existing?.baseUrl !== baseUrl;
  const values = {
    baseUrl,
    allowInsecureTls: input.allowInsecureTls,
    configJson: config,
    enabled: input.enabled ?? existing?.enabled ?? true,
    ...(token === null ? {} : { tokenEnc: encryptSecret(token) }),
    ...(reset
      ? {
          status: "unknown" as const,
          lastError: null,
          lastOkAt: null,
          lastCheckedAt: null,
          consecutiveFailures: 0,
        }
      : {}),
  };
  const row = existing
    ? ctx.db
        .update(connections)
        .set(values)
        .where(eq(connections.id, existing.id))
        .returning()
        .get()
    : ctx.db
        .insert(connections)
        .values({
          kind,
          userId,
          tokenEnc: encryptSecret(token as string),
          ...values,
        })
        .returning()
        .get();
  emitEvent("connectionChanged", { ctx, kind });
  return row;
}

export function deleteConnection(
  ctx: ServiceContext,
  kind: IntegrationKind,
  userId: string | null,
): void {
  const existing = getConnectionRow(ctx, kind, userId);
  if (!existing) throw notFound("Connection");
  ctx.db.delete(connections).where(eq(connections.id, existing.id)).run();
  emitEvent("connectionChanged", { ctx, kind });
}

/** The longest an adapter waits between attempts after repeated failures. */
export const MAX_BACKOFF_MS = 15 * 60 * 1000;

/** `base` after one failure, doubling per further failure, capped at 15 minutes. */
export function backoffMs(failures: number, baseMs = 60_000): number {
  if (failures <= 0) return 0;
  return Math.min(MAX_BACKOFF_MS, baseMs * 2 ** (failures - 1));
}

export function recordConnectionOk(
  ctx: Pick<ServiceContext, "db" | "now">,
  id: string,
): void {
  ctx.db
    .update(connections)
    .set({
      status: "ok",
      lastError: null,
      lastOkAt: new Date(ctx.now),
      lastCheckedAt: new Date(ctx.now),
      consecutiveFailures: 0,
    })
    .where(eq(connections.id, id))
    .run();
}

export function recordConnectionFailure(
  ctx: Pick<ServiceContext, "db" | "now">,
  row: Pick<ConnectionRow, "id" | "consecutiveFailures">,
  code: string,
): number {
  const failures = row.consecutiveFailures + 1;
  ctx.db
    .update(connections)
    .set({
      status: "error",
      lastError: code,
      lastCheckedAt: new Date(ctx.now),
      consecutiveFailures: failures,
    })
    .where(eq(connections.id, row.id))
    .run();
  return failures;
}

/** Whether an adapter should try again now, given the failures so far (exponential backoff, 15 minutes at most). */
export function dueForAttempt(
  row: Pick<ConnectionRow, "consecutiveFailures" | "lastCheckedAt">,
  now: number,
  baseMs?: number,
): boolean {
  if (row.consecutiveFailures === 0 || !row.lastCheckedAt) return true;
  return (
    now - row.lastCheckedAt.getTime() >=
    backoffMs(row.consecutiveFailures, baseMs)
  );
}

export interface TestOutcome {
  result: ConnectionTestResult;
  view: ConnectionView;
}

/** Runs the adapter's connection test and records the outcome as the connection's health. */
export async function testConnection(
  ctx: ServiceContext,
  kind: IntegrationKind,
  userId: string | null,
  options: { showAddress: boolean },
): Promise<TestOutcome> {
  const adapter = getIntegration(kind);
  if (!adapter) {
    throw new ApiError("not_found", "This integration is not available");
  }
  const row = getConnectionRow(ctx, kind, userId);
  if (!row) throw notFound("Connection");
  let result: ConnectionTestResult;
  try {
    result = await adapter.test(resolveConnection(row, ctx.db));
  } catch (err) {
    if (!(err instanceof IntegrationError)) throw err;
    result = { ok: false, error: { code: err.code, message: err.message } };
  }
  if (result.ok) recordConnectionOk(ctx, row.id);
  else recordConnectionFailure(ctx, row, result.error?.code ?? "unknown");
  const fresh = getConnectionRow(ctx, kind, userId) ?? row;
  return { result, view: toView(kind, fresh, options) };
}

/** Runs a read-only operation of the adapter (entity picker, device list) against the connection. */
export async function runOperation(
  ctx: ServiceContext,
  kind: IntegrationKind,
  userId: string | null,
  operation: string,
  query: Record<string, string>,
): Promise<unknown> {
  const adapter = getIntegration(kind);
  const run = adapter?.operations?.[operation];
  if (!adapter || !run) throw notFound("Integration");
  const row = getConnectionRow(ctx, kind, userId);
  if (!row || !row.enabled) throw notFound("Connection");
  try {
    return await run(resolveConnection(row, ctx.db), query, ctx);
  } catch (err) {
    if (err instanceof IntegrationError) {
      throw new ApiError("upstream_error", err.message, {
        details: { code: err.code },
      });
    }
    throw err;
  }
}
