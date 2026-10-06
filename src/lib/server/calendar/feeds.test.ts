import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ApiError } from "$lib/api/errors";
import { createCalendarFeedRequestSchema } from "$lib/api/schemas/share";
import { decryptSecret } from "$lib/server/crypto";
import { icalFeeds } from "$lib/server/db";
import { SHARE_TOKEN_PATTERN } from "$lib/server/share/tokens";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt, NOW } from "$lib/testing/domain";
import {
  createFeed,
  feedUrl,
  findFeedByToken,
  FEED_FETCH_TOUCH_MS,
  getFeed,
  listFeeds,
  revokeFeed,
  rotateFeed,
  touchFeedFetched,
  updateFeed,
} from "./feeds";

const input = (over: Record<string, unknown> = {}) =>
  createCalendarFeedRequestSchema.parse({ name: "Mein Kalender", ...over });

describe("calendar feeds", () => {
  const test = useTestDB();
  const ctx = (now = NOW) => ctxAt(test.db, now);

  it("creates a feed with a random token that is stored hashed and encrypted", async () => {
    const user = await createTestUser({ locale: "en" });
    const feed = createFeed(ctx(), user.id, input());
    expect(feed.token).toMatch(SHARE_TOKEN_PATTERN);
    expect(feed).toMatchObject({
      scope: "mine",
      includeEstimated: false,
      includePreparations: true,
      includeDefects: true,
      includeWarranties: true,
      alarmTime: null,
      alarmDaysBefore: 0,
      locale: "en",
      lastFetchedAt: null,
    });
    const [row] = test.db.select().from(icalFeeds).all();
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.tokenHash).not.toContain(feed.token!);
    expect(JSON.stringify(row)).not.toContain(feed.token!);
    expect(decryptSecret(row.tokenEnc)).toBe(feed.token);
    expect(getFeed(ctx(), user.id, feed.id).token).toBe(feed.token);
  });

  it("builds the subscription address from the origin", () => {
    expect(feedUrl("https://hauswart.example.org", "abc")).toBe(
      "https://hauswart.example.org/api/public/cal/abc.ics",
    );
  });

  it("finds a feed by its token and nothing else", async () => {
    const user = await createTestUser();
    const feed = createFeed(ctx(), user.id, input());
    expect(findFeedByToken(ctx(), feed.token!)?.id).toBe(feed.id);
    expect(findFeedByToken(ctx(), "x".repeat(43))).toBeNull();
    expect(findFeedByToken(ctx(), "short")).toBeNull();
    expect(findFeedByToken(ctx(), `${feed.token!}A`)).toBeNull();
    expect(findFeedByToken(ctx(), "")).toBeNull();
  });

  it("lists only the owner's live feeds", async () => {
    const [a, b] = [await createTestUser(), await createTestUser()];
    const mine = createFeed(ctx(), a.id, input({ name: "A1" }));
    const gone = createFeed(ctx(), a.id, input({ name: "A2" }));
    createFeed(ctx(), b.id, input({ name: "B1" }));
    revokeFeed(ctx(), a.id, gone.id);
    expect(listFeeds(ctx(), a.id).map((f) => f.id)).toEqual([mine.id]);
    expect(listFeeds(ctx(), b.id).map((f) => f.name)).toEqual(["B1"]);
  });

  it("hides one user's feeds from another with not_found", async () => {
    const [a, b] = [await createTestUser(), await createTestUser()];
    const feed = createFeed(ctx(), a.id, input());
    const notFound = (fn: () => unknown) => {
      try {
        fn();
      } catch (err) {
        return err instanceof ApiError ? err.code : "other";
      }
      return "none";
    };
    expect(notFound(() => getFeed(ctx(), b.id, feed.id))).toBe("not_found");
    expect(
      notFound(() => updateFeed(ctx(), b.id, feed.id, { name: "x" })),
    ).toBe("not_found");
    expect(notFound(() => rotateFeed(ctx(), b.id, feed.id))).toBe("not_found");
    expect(notFound(() => revokeFeed(ctx(), b.id, feed.id))).toBe("not_found");
    expect(getFeed(ctx(), a.id, feed.id).name).toBe("Mein Kalender");
  });

  it("updates settings without touching the token", async () => {
    const user = await createTestUser();
    const feed = createFeed(ctx(), user.id, input());
    const updated = updateFeed(ctx(), user.id, feed.id, {
      scope: "all",
      includeEstimated: true,
      alarmTime: "18:00",
      alarmDaysBefore: 1,
    });
    expect(updated).toMatchObject({
      scope: "all",
      includeEstimated: true,
      alarmTime: "18:00",
      alarmDaysBefore: 1,
      token: feed.token,
    });
  });

  it("rotates the token: the old address stops working at once", async () => {
    const user = await createTestUser();
    const feed = createFeed(ctx(), user.id, input());
    const rotated = rotateFeed(ctx(), user.id, feed.id);
    expect(rotated.token).not.toBe(feed.token);
    expect(rotated.id).toBe(feed.id);
    expect(findFeedByToken(ctx(), feed.token!)).toBeNull();
    expect(findFeedByToken(ctx(), rotated.token!)?.id).toBe(feed.id);
    expect(getFeed(ctx(), user.id, feed.id).token).toBe(rotated.token);
  });

  it("revokes a feed: gone from the owner, dead for subscribers, plaintext wiped", async () => {
    const user = await createTestUser();
    const feed = createFeed(ctx(), user.id, input());
    revokeFeed(ctx(), user.id, feed.id);
    expect(findFeedByToken(ctx(), feed.token!)).toBeNull();
    expect(() => getFeed(ctx(), user.id, feed.id)).toThrow(ApiError);
    const row = test.db
      .select()
      .from(icalFeeds)
      .where(eq(icalFeeds.id, feed.id))
      .get()!;
    expect(row.revokedAt).not.toBeNull();
    expect(row.tokenEnc).toBe("");
    // The hash stays: the address cannot come back by accident.
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("limits the number of live feeds per user", async () => {
    const user = await createTestUser();
    for (let i = 0; i < 10; i += 1) createFeed(ctx(), user.id, input());
    expect(() => createFeed(ctx(), user.id, input())).toThrow(ApiError);
    const other = await createTestUser();
    expect(() => createFeed(ctx(), other.id, input())).not.toThrow();
    const [first] = listFeeds(ctx(), user.id);
    revokeFeed(ctx(), user.id, first.id);
    expect(() => createFeed(ctx(), user.id, input())).not.toThrow();
  });

  it("is removed with its user", async () => {
    const user = await createTestUser();
    createFeed(ctx(), user.id, input());
    test.db.$client.exec(`delete from users where id = '${user.id}'`);
    expect(test.db.select().from(icalFeeds).all()).toEqual([]);
  });

  it("records fetches at most every few minutes and keeps updatedAt", async () => {
    const user = await createTestUser();
    const feed = createFeed(ctx(), user.id, input());
    const row = () => findFeedByToken(ctx(), feed.token!)!;
    touchFeedFetched(ctx(NOW), row());
    expect(row().lastFetchedAt?.getTime()).toBe(NOW);
    expect(row().updatedAt.getTime()).toBe(feed.updatedAt.getTime());
    touchFeedFetched(ctx(NOW + FEED_FETCH_TOUCH_MS - 1), row());
    expect(row().lastFetchedAt?.getTime()).toBe(NOW);
    touchFeedFetched(ctx(NOW + FEED_FETCH_TOUCH_MS), row());
    expect(row().lastFetchedAt?.getTime()).toBe(NOW + FEED_FETCH_TOUCH_MS);
  });
});
