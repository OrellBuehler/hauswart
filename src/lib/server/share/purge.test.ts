import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  createCalendarFeedRequestSchema,
  createGuestLinkRequestSchema,
} from "$lib/api/schemas/share";
import { createFeed, revokeFeed } from "$lib/server/calendar/feeds";
import { guestLinks, icalFeeds } from "$lib/server/db";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt } from "$lib/testing/domain";
import { createGuestLink } from "./guest-links";
import { DEAD_LINK_RETENTION_MS, purgeDeadShareLinks } from "./purge";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

describe("purgeDeadShareLinks", () => {
  const test = useTestDB();
  const ctx = (now = NOW) => ctxAt(test.db, now);

  async function link(label: string, days = 7) {
    const user = await createTestUser();
    const { record } = await createGuestLink(
      ctx(),
      user.id,
      "de",
      createGuestLinkRequestSchema.parse({
        label,
        expiresAt: new Date(NOW + days * DAY).toISOString(),
      }),
    );
    return { user, record };
  }

  it("keeps the retention at 30 days", () => {
    expect(DEAD_LINK_RETENTION_MS).toBe(30 * DAY);
  });

  it("deletes guest links revoked or expired more than 30 days ago, keeps the rest", async () => {
    const rows = {
      live: await link("live"),
      expiredRecently: await link("expired recently"),
      expiredLongAgo: await link("expired long ago"),
      revokedRecently: await link("revoked recently"),
      revokedLongAgo: await link("revoked long ago"),
    };
    const set = (
      key: keyof typeof rows,
      values: Partial<typeof guestLinks.$inferInsert>,
    ) =>
      test.db
        .update(guestLinks)
        .set(values)
        .where(eq(guestLinks.id, rows[key].record.id))
        .run();
    set("live", { expiresAt: new Date(NOW + 5 * DAY) });
    set("expiredRecently", { expiresAt: new Date(NOW - 5 * DAY) });
    set("expiredLongAgo", { expiresAt: new Date(NOW - 31 * DAY) });
    set("revokedRecently", { revokedAt: new Date(NOW - 5 * DAY) });
    set("revokedLongAgo", { revokedAt: new Date(NOW - 31 * DAY) });
    expect(purgeDeadShareLinks(NOW)).toEqual({ guestLinks: 2, feeds: 0 });
    expect(
      test.db
        .select()
        .from(guestLinks)
        .all()
        .map((l) => l.label)
        .sort(),
    ).toEqual(["expired recently", "live", "revoked recently"]);
  });

  it("deletes calendar feeds revoked more than 30 days ago", async () => {
    const user = await createTestUser();
    const input = createCalendarFeedRequestSchema.parse({ name: "x" });
    const keep = createFeed(ctx(), user.id, input);
    const recent = createFeed(ctx(), user.id, input);
    const old = createFeed(ctx(), user.id, input);
    revokeFeed(ctx(NOW - 5 * DAY), user.id, recent.id);
    revokeFeed(ctx(NOW - 40 * DAY), user.id, old.id);
    expect(purgeDeadShareLinks(NOW)).toEqual({ guestLinks: 0, feeds: 1 });
    expect(
      test.db
        .select()
        .from(icalFeeds)
        .all()
        .map((f) => f.id)
        .sort(),
    ).toEqual([keep.id, recent.id].sort());
  });
});
