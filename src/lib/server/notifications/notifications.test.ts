import { describe, expect, it } from "vitest";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt, NOW } from "$lib/testing/domain";
import {
  createNotification,
  listNotifications,
  markAllRead,
  markRead,
  unreadCount,
  type NewNotification,
} from "./notifications";

describe("notifications", () => {
  const test = useTestDB();
  const ctx = (now = NOW) => ctxAt(test.db, now);
  let n = 0;
  const make = (
    userId: string | null,
    over: Partial<NewNotification> = {},
    now = NOW,
  ) =>
    createNotification(ctx(now), {
      userId,
      kind: "info",
      taskId: null,
      dedupeKey: `k${(n += 1)}`,
      titleKey: "notification_info",
      params: { message: "Hallo" },
      url: null,
      ...over,
    })!;
  const ids = (
    userId: string,
    filter = {},
    page = { limit: 50 } as { limit: number; cursor?: string },
  ) => listNotifications(ctx(), userId, filter, page);

  it("ignores a second notification with the same dedupe key", async () => {
    const user = await createTestUser();
    expect(make(user.id, { dedupeKey: "same" })).toBeTruthy();
    expect(
      createNotification(ctx(), {
        userId: user.id,
        kind: "info",
        taskId: null,
        dedupeKey: "same",
        titleKey: "notification_info",
        params: {},
        url: null,
      }),
    ).toBeNull();
    expect(ids(user.id).items).toHaveLength(1);
  });

  it("shows a person their own and the household's notifications, never another person's", async () => {
    const [anna, ben] = [await createTestUser(), await createTestUser()];
    const mine = make(anna.id);
    const theirs = make(ben.id);
    const shared = make(null);
    const seen = (userId: string) =>
      ids(userId)
        .items.map((r) => r.id)
        .sort();
    expect(seen(anna.id)).toEqual([mine.id, shared.id].sort());
    expect(seen(ben.id)).toEqual([theirs.id, shared.id].sort());
    expect(unreadCount(ctx(), anna.id)).toBe(2);
  });

  it("lists unread first, then newest first", async () => {
    const user = await createTestUser();
    const old = make(user.id, {}, NOW - 3000);
    const mid = make(user.id, {}, NOW - 2000);
    const fresh = make(user.id, {}, NOW - 1000);
    markRead(ctx(), user.id, fresh.id);
    expect(ids(user.id).items.map((r) => r.id)).toEqual([
      mid.id,
      old.id,
      fresh.id,
    ]);
  });

  it("filters to unread", async () => {
    const user = await createTestUser();
    const a = make(user.id);
    make(user.id);
    markRead(ctx(), user.id, a.id);
    expect(ids(user.id, { unread: true }).items).toHaveLength(1);
    expect(ids(user.id, { unread: false }).items).toHaveLength(2);
  });

  it("pages without losing anything when items are marked read in between", async () => {
    const user = await createTestUser();
    const all = Array.from({ length: 7 }, (_, i) =>
      make(user.id, {}, NOW - i * 1000),
    );
    const first = ids(user.id, {}, { limit: 3 });
    expect(first.items.map((r) => r.id)).toEqual(
      all.slice(0, 3).map((r) => r.id),
    );
    // Reading the first page moves those items behind the unread ones, so they
    // may turn up again later, but nothing unread is skipped.
    for (const row of first.items) markRead(ctx(), user.id, row.id);
    const seen = first.items.map((r) => r.id);
    let cursor = first.nextCursor ?? undefined;
    while (cursor) {
      const page = ids(user.id, {}, { limit: 3, cursor });
      seen.push(...page.items.map((r) => r.id));
      cursor = page.nextCursor ?? undefined;
    }
    expect(new Set(seen)).toEqual(new Set(all.map((r) => r.id)));
    expect(seen.slice(3, 7).sort()).toEqual(
      all
        .slice(3)
        .map((r) => r.id)
        .sort(),
    );
  });

  it("pages across the unread/read boundary and through equal timestamps", async () => {
    const user = await createTestUser();
    const rows = Array.from({ length: 6 }, () => make(user.id));
    for (const row of rows.slice(0, 3)) markRead(ctx(), user.id, row.id);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = ids(user.id, {}, { limit: 2, cursor });
      seen.push(...page.items.map((r) => r.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(new Set(seen).size).toBe(6);
    const unreadSeen = seen.slice(0, 3);
    expect(unreadSeen.sort()).toEqual(
      rows
        .slice(3)
        .map((r) => r.id)
        .sort(),
    );
  });

  it("marks one read, keeping the first read time", async () => {
    const user = await createTestUser();
    const row = make(user.id);
    expect(markRead(ctx(NOW + 1000), user.id, row.id).readAt?.getTime()).toBe(
      NOW + 1000,
    );
    expect(markRead(ctx(NOW + 9000), user.id, row.id).readAt?.getTime()).toBe(
      NOW + 1000,
    );
    expect(unreadCount(ctx(), user.id)).toBe(0);
  });

  it("someone else's notification does not exist for you", async () => {
    const [anna, ben] = [await createTestUser(), await createTestUser()];
    const row = make(anna.id);
    expect(() => markRead(ctx(), ben.id, row.id)).toThrow(
      "Notification not found",
    );
    expect(() => markRead(ctx(), ben.id, "nope")).toThrow(
      "Notification not found",
    );
    expect(unreadCount(ctx(), anna.id)).toBe(1);
  });

  it("marks all read for the caller only; household notifications are shared", async () => {
    const [anna, ben] = [await createTestUser(), await createTestUser()];
    make(anna.id);
    make(anna.id);
    make(ben.id);
    make(null);
    expect(markAllRead(ctx(), anna.id)).toBe(3);
    expect(unreadCount(ctx(), anna.id)).toBe(0);
    expect(unreadCount(ctx(), ben.id)).toBe(1);
    expect(markAllRead(ctx(), anna.id)).toBe(0);
  });

  it("rejects a forged cursor", async () => {
    const user = await createTestUser();
    expect(() => ids(user.id, {}, { limit: 5, cursor: "garbage" })).toThrow(
      "Invalid request",
    );
  });
});
