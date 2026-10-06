import { and, isNotNull, lt, or } from "drizzle-orm";
import { getDB, guestLinks, icalFeeds } from "$lib/server/db";

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEAD_LINK_RETENTION_MS = 30 * DAY_MS;

export interface SharePurgeResult {
  guestLinks: number;
  feeds: number;
}

/**
 * Deletes guest links that were revoked or expired more than 30 days ago and calendar feeds that
 * were revoked that long ago. Until then the rows keep their hashes, so the old addresses stay
 * dead; afterwards an address no longer matches anything, which looks the same.
 */
export function purgeDeadShareLinks(
  now: number = Date.now(),
): SharePurgeResult {
  const db = getDB();
  const cutoff = new Date(now - DEAD_LINK_RETENTION_MS);
  const links = db
    .delete(guestLinks)
    .where(
      or(
        and(isNotNull(guestLinks.revokedAt), lt(guestLinks.revokedAt, cutoff)),
        lt(guestLinks.expiresAt, cutoff),
      ),
    )
    .returning({ id: guestLinks.id })
    .all().length;
  const feeds = db
    .delete(icalFeeds)
    .where(and(isNotNull(icalFeeds.revokedAt), lt(icalFeeds.revokedAt, cutoff)))
    .returning({ id: icalFeeds.id })
    .all().length;
  return { guestLinks: links, feeds };
}
