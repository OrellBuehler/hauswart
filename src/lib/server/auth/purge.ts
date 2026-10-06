import { and, isNotNull, lt, or } from "drizzle-orm";
import { apiTokens, getDB, sessions } from "$lib/server/db";
import { SESSION_MAX_LIFETIME_MS } from "./sessions";

const DAY_MS = 24 * 60 * 60 * 1000;
export const EXPIRED_SESSION_RETENTION_MS = 7 * DAY_MS;
export const INACTIVE_TOKEN_RETENTION_MS = 30 * DAY_MS;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 60 * 1000;

export interface PurgeResult {
  sessions: number;
  tokens: number;
}

/**
 * Deletes sessions that expired more than 7 days ago or outlived the absolute session lifetime,
 * and API tokens that were revoked or expired more than 30 days ago. Live credentials are never
 * touched; validation already treats expired ones as invalid, this only keeps the tables small.
 */
export function purgeStaleCredentials(now: number = Date.now()): PurgeResult {
  const db = getDB();
  const removedSessions = db
    .delete(sessions)
    .where(
      or(
        lt(sessions.expiresAt, new Date(now - EXPIRED_SESSION_RETENTION_MS)),
        lt(sessions.createdAt, new Date(now - SESSION_MAX_LIFETIME_MS)),
      ),
    )
    .returning({ id: sessions.id })
    .all().length;
  const tokenCutoff = new Date(now - INACTIVE_TOKEN_RETENTION_MS);
  const removedTokens = db
    .delete(apiTokens)
    .where(
      or(
        and(
          isNotNull(apiTokens.revokedAt),
          lt(apiTokens.revokedAt, tokenCutoff),
        ),
        and(
          isNotNull(apiTokens.expiresAt),
          lt(apiTokens.expiresAt, tokenCutoff),
        ),
      ),
    )
    .returning({ id: apiTokens.id })
    .all().length;
  return { sessions: removedSessions, tokens: removedTokens };
}

/** Runs the purge shortly after startup and then every few hours; returns a stop function. */
export function startCredentialPurge(
  options: { intervalMs?: number; firstRunDelayMs?: number } = {},
): () => void {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    try {
      const result = purgeStaleCredentials();
      console.info(JSON.stringify({ event: "auth.purge", ...result }));
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "auth.purge_failed",
          name: error instanceof Error ? error.name : "NonError",
        }),
      );
    } finally {
      running = false;
    }
  };
  const first = setTimeout(tick, options.firstRunDelayMs ?? FIRST_RUN_DELAY_MS);
  const timer = setInterval(tick, options.intervalMs ?? CHECK_INTERVAL_MS);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
