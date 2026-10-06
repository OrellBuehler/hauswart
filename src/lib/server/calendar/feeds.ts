import { and, asc, eq, isNull } from "drizzle-orm";
import {
  MAX_FEEDS_PER_USER,
  type CreateCalendarFeedRequest,
  type UpdateCalendarFeedRequest,
} from "$lib/api/schemas/share";
import { decryptSecret, encryptSecret } from "$lib/server/crypto";
import { icalFeeds, users } from "$lib/server/db";
import { conflict, notFound, type ServiceContext } from "$lib/server/service";
import {
  generateShareToken,
  hashShareToken,
  SHARE_TOKEN_PATTERN,
  sameHash,
} from "$lib/server/share/tokens";

type Db = Pick<ServiceContext, "db">;
type Now = Pick<ServiceContext, "db" | "now">;

export type FeedRow = typeof icalFeeds.$inferSelect;

export const FEED_FETCH_TOUCH_MS = 5 * 60 * 1000;

export interface FeedRecord extends Omit<FeedRow, "tokenHash" | "tokenEnc"> {
  /** The plaintext token, for building the address; null when it cannot be decrypted any more. */
  token: string | null;
}

function tokenOf(row: FeedRow): string | null {
  try {
    return decryptSecret(row.tokenEnc);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "calendar.feed_token_unreadable",
        feedId: row.id,
        name: err instanceof Error ? err.name : "NonError",
      }),
    );
    return null;
  }
}

function toRecord(row: FeedRow): FeedRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    scope: row.scope,
    includeEstimated: row.includeEstimated,
    includePreparations: row.includePreparations,
    includeDefects: row.includeDefects,
    includeWarranties: row.includeWarranties,
    alarmTime: row.alarmTime,
    alarmDaysBefore: row.alarmDaysBefore,
    locale: row.locale,
    lastFetchedAt: row.lastFetchedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    token: tokenOf(row),
  };
}

export function feedUrl(origin: string, token: string): string {
  return `${origin}/api/public/cal/${token}.ics`;
}

export function listFeeds(ctx: Db, userId: string): FeedRecord[] {
  return ctx.db
    .select()
    .from(icalFeeds)
    .where(and(eq(icalFeeds.userId, userId), isNull(icalFeeds.revokedAt)))
    .orderBy(asc(icalFeeds.createdAt), asc(icalFeeds.id))
    .all()
    .map(toRecord);
}

function ownRow(ctx: Db, userId: string, id: string): FeedRow {
  const row = ctx.db
    .select()
    .from(icalFeeds)
    .where(
      and(
        eq(icalFeeds.id, id),
        eq(icalFeeds.userId, userId),
        isNull(icalFeeds.revokedAt),
      ),
    )
    .get();
  if (!row) throw notFound("Calendar feed");
  return row;
}

export function getFeed(ctx: Db, userId: string, id: string): FeedRecord {
  return toRecord(ownRow(ctx, userId, id));
}

function userLocale(ctx: Db, userId: string): "de" | "en" {
  return (
    ctx.db
      .select({ locale: users.locale })
      .from(users)
      .where(eq(users.id, userId))
      .get()?.locale ?? "de"
  );
}

export function createFeed(
  ctx: Db,
  userId: string,
  input: CreateCalendarFeedRequest,
): FeedRecord {
  const existing = listFeeds(ctx, userId).length;
  if (existing >= MAX_FEEDS_PER_USER) {
    throw conflict(`At most ${MAX_FEEDS_PER_USER} calendar feeds per user`);
  }
  const token = generateShareToken();
  const row = ctx.db
    .insert(icalFeeds)
    .values({
      userId,
      name: input.name,
      tokenHash: hashShareToken(token),
      tokenEnc: encryptSecret(token),
      scope: input.scope,
      includeEstimated: input.includeEstimated,
      includePreparations: input.includePreparations,
      includeDefects: input.includeDefects,
      includeWarranties: input.includeWarranties,
      alarmTime: input.alarmTime,
      alarmDaysBefore: input.alarmDaysBefore,
      locale: input.locale ?? userLocale(ctx, userId),
    })
    .returning()
    .get();
  return { ...toRecord(row), token };
}

export function updateFeed(
  ctx: Db,
  userId: string,
  id: string,
  patch: UpdateCalendarFeedRequest,
): FeedRecord {
  ownRow(ctx, userId, id);
  const row = ctx.db
    .update(icalFeeds)
    .set(patch)
    .where(eq(icalFeeds.id, id))
    .returning()
    .get();
  return toRecord(row);
}

/** Replaces the token: the old address stops working at once. */
export function rotateFeed(ctx: Db, userId: string, id: string): FeedRecord {
  ownRow(ctx, userId, id);
  const token = generateShareToken();
  const row = ctx.db
    .update(icalFeeds)
    .set({ tokenHash: hashShareToken(token), tokenEnc: encryptSecret(token) })
    .where(eq(icalFeeds.id, id))
    .returning()
    .get();
  return { ...toRecord(row), token };
}

/** Ends the feed for good; the stored plaintext is wiped, the hash stays so the address stays dead. */
export function revokeFeed(ctx: Now, userId: string, id: string): void {
  ownRow(ctx, userId, id);
  ctx.db
    .update(icalFeeds)
    .set({ revokedAt: new Date(ctx.now), tokenEnc: "" })
    .where(eq(icalFeeds.id, id))
    .run();
}

/** The live feed behind a token, or null (malformed, unknown, revoked). */
export function findFeedByToken(ctx: Db, token: string): FeedRow | null {
  if (!SHARE_TOKEN_PATTERN.test(token)) return null;
  const hash = hashShareToken(token);
  const row = ctx.db
    .select()
    .from(icalFeeds)
    .where(eq(icalFeeds.tokenHash, hash))
    .get();
  if (!row || row.revokedAt || !sameHash(row.tokenHash, hash)) return null;
  return row;
}

/** Records a fetch, at most every few minutes so a polling client does not turn into a write per request. */
export function touchFeedFetched(ctx: Now, row: FeedRow): void {
  if (
    row.lastFetchedAt &&
    ctx.now - row.lastFetchedAt.getTime() < FEED_FETCH_TOUCH_MS
  ) {
    return;
  }
  ctx.db
    .update(icalFeeds)
    .set({ lastFetchedAt: new Date(ctx.now), updatedAt: row.updatedAt })
    .where(eq(icalFeeds.id, row.id))
    .run();
}
