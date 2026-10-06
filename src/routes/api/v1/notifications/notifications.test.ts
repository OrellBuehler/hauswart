import { describe, expect, it } from "vitest";
import { getDB } from "$lib/server/db";
import { createNotification } from "$lib/server/notifications/notifications";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";

type N = {
  id: string;
  readAt: string | null;
  titleKey: string;
  params: Record<string, unknown>;
};
let counter = 0;

describe("notifications API", () => {
  useTestDB();
  const notify = (userId: string | null, now = Date.now(), over = {}) =>
    createNotification(
      { db: getDB(), now },
      {
        userId,
        kind: "due_soon",
        taskId: null,
        dedupeKey: `n${(counter += 1)}`,
        titleKey: "notification_due_soon",
        params: { title: "Filter wechseln", date: "2026-06-20" },
        url: "/tasks/x",
        ...over,
      },
    )!;
  async function member() {
    const user = await createTestUser();
    return { user, call: createCaller({ session: loginTestUser(user).token }) };
  }

  it("lists the caller's notifications with message key and params", async () => {
    const { user, call } = await member();
    const stranger = await createTestUser();
    const mine = notify(user.id);
    notify(stranger.id);
    const shared = notify(null);
    const r = await call("GET", "/api/v1/notifications");
    expect(r.res.status).toBe(200);
    const body = r.body as { items: N[]; nextCursor: null };
    expect(body.items.map((n) => n.id).sort()).toEqual(
      [mine.id, shared.id].sort(),
    );
    expect(body.items[0]).toMatchObject({
      kind: "due_soon",
      titleKey: "notification_due_soon",
      params: { title: "Filter wechseln", date: "2026-06-20" },
      url: "/tasks/x",
      readAt: null,
    });
    expect(body.items[0].titleKey).toMatch(/^notification_/);
  });

  it("puts unread first, filters unread and pages", async () => {
    const { user, call } = await member();
    const [a, b, c] = [
      notify(user.id, 1000),
      notify(user.id, 2000),
      notify(user.id, 3000),
    ];
    await call("POST", `/api/v1/notifications/${c.id}/read`, { json: {} });
    const all = (await call("GET", "/api/v1/notifications")).body as {
      items: N[];
    };
    expect(all.items.map((n) => n.id)).toEqual([b.id, a.id, c.id]);
    const unread = (await call("GET", "/api/v1/notifications?unread=true"))
      .body as { items: N[] };
    expect(unread.items.map((n) => n.id)).toEqual([b.id, a.id]);
    const page = (await call("GET", "/api/v1/notifications?limit=2")).body as {
      items: N[];
      nextCursor: string;
    };
    expect(page.items.map((n) => n.id)).toEqual([b.id, a.id]);
    const rest = (
      await call(
        "GET",
        `/api/v1/notifications?limit=2&cursor=${page.nextCursor}`,
      )
    ).body as { items: N[]; nextCursor: null };
    expect(rest.items.map((n) => n.id)).toEqual([c.id]);
    expect(rest.nextCursor).toBeNull();
  });

  it("counts unread and marks one or all read", async () => {
    const { user, call } = await member();
    const first = notify(user.id);
    notify(user.id);
    notify(user.id);
    expect(
      (await call("GET", "/api/v1/notifications/unread-count")).body,
    ).toEqual({ count: 3 });
    const read = await call("POST", `/api/v1/notifications/${first.id}/read`, {
      json: {},
    });
    expect(read.res.status).toBe(200);
    expect((read.body as N).readAt).toMatch(/Z$/);
    expect(
      (await call("GET", "/api/v1/notifications/unread-count")).body,
    ).toEqual({ count: 2 });
    const all = await call("POST", "/api/v1/notifications/read-all", {
      json: {},
    });
    expect(all.body).toEqual({ updated: 2 });
    expect(
      (await call("GET", "/api/v1/notifications/unread-count")).body,
    ).toEqual({ count: 0 });
    expect(
      (await call("POST", "/api/v1/notifications/read-all", { json: {} })).body,
    ).toEqual({ updated: 0 });
  });

  it("keeps people's notifications apart: someone else's is a 404", async () => {
    const [anna, ben] = [await member(), await member()];
    const row = notify(anna.user.id);
    const denied = await ben.call(
      "POST",
      `/api/v1/notifications/${row.id}/read`,
      { json: {} },
    );
    expect([denied.res.status, errorCode(denied)]).toEqual([404, "not_found"]);
    expect(
      (await ben.call("GET", "/api/v1/notifications/unread-count")).body,
    ).toEqual({ count: 0 });
    await ben.call("POST", "/api/v1/notifications/read-all", { json: {} });
    expect(
      (await anna.call("GET", "/api/v1/notifications/unread-count")).body,
    ).toEqual({ count: 1 });
    const missing = await anna.call("POST", "/api/v1/notifications/nope/read", {
      json: {},
    });
    expect([missing.res.status, errorCode(missing)]).toEqual([
      404,
      "not_found",
    ]);
  });

  it("validates the query", async () => {
    const { call } = await member();
    expect(
      (await call("GET", "/api/v1/notifications?unread=perhaps")).res.status,
    ).toBe(400);
    expect(
      (await call("GET", "/api/v1/notifications?cursor=garbage")).res.status,
    ).toBe(400);
  });

  it("is readable by read tokens but marking read needs write", async () => {
    const user = await createTestUser();
    const row = notify(user.id);
    const reader = createCaller({
      bearer: createTestToken(user, { scopes: ["read"], kind: "mobile" }).token,
    });
    expect((await reader("GET", "/api/v1/notifications")).res.status).toBe(200);
    expect(
      (await reader("GET", "/api/v1/notifications/unread-count")).res.status,
    ).toBe(200);
    expect(
      (
        await reader("POST", `/api/v1/notifications/${row.id}/read`, {
          json: {},
        })
      ).res.status,
    ).toBe(403);
    expect(
      (await reader("POST", "/api/v1/notifications/read-all", { json: {} })).res
        .status,
    ).toBe(403);
  });
});
