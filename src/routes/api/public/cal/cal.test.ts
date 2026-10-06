import { describe, expect, it } from "vitest";
import {
  SHARE_MISSES_PER_WINDOW,
  SHARE_REQUESTS_PER_MINUTE,
  SHARE_TOKEN_REQUESTS_PER_MINUTE,
} from "$lib/server/auth/rate-limit";
import { createCalendarFeedRequestSchema } from "$lib/api/schemas/share";
import {
  createFeed,
  findFeedByToken,
  revokeFeed,
  rotateFeed,
} from "$lib/server/calendar/feeds";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt, everyDays, makeTask } from "$lib/testing/domain";
import { parseIcs } from "$lib/testing/ics";
import { callRoute } from "$lib/testing/route";
import { GET } from "./[token].ics/+server";

describe("public calendar feed", () => {
  const test = useTestDB();
  const ctx = () => ctxAt(test.db);

  async function setup(over: Record<string, unknown> = {}) {
    const user = await createTestUser();
    const feed = createFeed(
      ctx(),
      user.id,
      createCalendarFeedRequestSchema.parse({ name: "Wohnung", ...over }),
    );
    return { user, feed, token: feed.token! };
  }
  const fetchFeed = (
    token: string,
    opts: { headers?: Record<string, string>; ip?: string } = {},
  ) =>
    callRoute(GET as never, {
      url: `http://localhost/api/public/cal/${token}.ics`,
      params: { token },
      ...opts,
    });

  it("serves the calendar without any login, with the calendar headers", async () => {
    const { token } = await setup();
    await makeTask(ctx(), {
      title: "Filter",
      trigger: everyDays(30, "2026-06-20"),
    });
    const r = await fetchFeed(token);
    expect(r.res.status).toBe(200);
    expect(r.res.headers.get("content-type")).toBe(
      "text/calendar; charset=utf-8",
    );
    expect(r.res.headers.get("cache-control")).toBe("private, max-age=900");
    expect(r.res.headers.get("x-robots-tag")).toContain("noindex");
    expect(r.res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(r.res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.res.headers.get("etag")).toMatch(/^"[0-9a-f]{64}"$/);
    expect(r.res.headers.get("set-cookie")).toBeNull();
    const events = parseIcs(r.body as string).events;
    expect(events.map((e) => e.summary)).toEqual(["Filter"]);
  });

  it("answers a repeat request with 304 when the ETag matches", async () => {
    const { token } = await setup();
    await makeTask(ctx(), { trigger: everyDays(30, "2026-06-20") });
    const first = await fetchFeed(token);
    const etag = first.res.headers.get("etag")!;
    for (const header of [etag, `W/${etag}`, `"other", ${etag}`, "*"]) {
      const r = await fetchFeed(token, {
        headers: { "if-none-match": header },
      });
      expect(r.res.status, header).toBe(304);
      expect(r.body).toBeNull();
      expect(r.res.headers.get("etag")).toBe(etag);
      expect(r.res.headers.get("cache-control")).toBe("private, max-age=900");
    }
    const stale = await fetchFeed(token, {
      headers: { "if-none-match": '"0000"' },
    });
    expect(stale.res.status).toBe(200);
  });

  it("changes the ETag when the calendar changes", async () => {
    const { token } = await setup();
    const empty = await fetchFeed(token);
    await makeTask(ctx(), { trigger: everyDays(30, "2026-06-20") });
    const filled = await fetchFeed(token);
    expect(filled.res.headers.get("etag")).not.toBe(
      empty.res.headers.get("etag"),
    );
  });

  it("records the fetch", async () => {
    const { token } = await setup();
    expect(findFeedByToken(ctx(), token)!.lastFetchedAt).toBeNull();
    await fetchFeed(token);
    expect(findFeedByToken(ctx(), token)!.lastFetchedAt).not.toBeNull();
  });

  it("answers 404 for a malformed, unknown, revoked or replaced token, all alike", async () => {
    const { user, feed, token } = await setup();
    const rotated = rotateFeed(ctx(), user.id, feed.id);
    const other = await setup();
    revokeFeed(ctx(), other.user.id, other.feed.id);
    const bodies = new Set<string>();
    for (const t of [
      "x".repeat(43),
      "short",
      "../etc/passwd",
      token,
      other.token,
    ]) {
      const r = await fetchFeed(t);
      expect(r.res.status, t).toBe(404);
      expect(r.res.headers.get("content-type")).toContain("text/plain");
      expect(r.res.headers.get("cache-control")).toBe("no-store");
      bodies.add(String(r.body));
    }
    expect(bodies.size).toBe(1);
    expect((await fetchFeed(rotated.token!)).res.status).toBe(200);
  });

  it("never reveals anything when the account behind it is gone", async () => {
    const { user, token } = await setup();
    test.db.$client.exec(`delete from users where id = '${user.id}'`);
    expect((await fetchFeed(token)).res.status).toBe(404);
  });

  describe("rate limits", () => {
    it("blocks an address that keeps presenting unknown tokens, even for a good one", async () => {
      const { token } = await setup();
      for (let i = 0; i < SHARE_MISSES_PER_WINDOW; i += 1) {
        expect((await fetchFeed("x".repeat(43))).res.status).toBe(404);
      }
      const blocked = await fetchFeed(token);
      expect(blocked.res.status).toBe(429);
      expect(Number(blocked.res.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(blocked.res.headers.get("cache-control")).toBe("no-store");
      const elsewhere = await fetchFeed(token, { ip: "198.51.100.9" });
      expect(elsewhere.res.status).toBe(200);
    });

    it("limits the requests of one address", async () => {
      const { token } = await setup();
      let last = 200;
      for (let i = 0; i < SHARE_REQUESTS_PER_MINUTE + 1; i += 1) {
        last = (await fetchFeed(token, { headers: { "if-none-match": "*" } }))
          .res.status;
      }
      expect(last).toBe(429);
    });

    it("limits the requests for one token across addresses", async () => {
      const { token } = await setup();
      let status = 200;
      for (let i = 0; i <= SHARE_TOKEN_REQUESTS_PER_MINUTE; i += 1) {
        status = (
          await fetchFeed(token, {
            ip: `198.51.100.${i % 200}`,
            headers: { "if-none-match": "*" },
          })
        ).res.status;
      }
      expect(status).toBe(429);
      expect(
        (await fetchFeed("x".repeat(43), { ip: "192.0.2.1" })).res.status,
      ).toBe(404);
    });
  });

  it("ignores credentials: a session cookie neither helps nor hurts", async () => {
    const { token } = await setup();
    const r = await callRoute(GET as never, {
      url: `http://localhost/api/public/cal/${token}.ics`,
      params: { token },
      session: "garbage",
    });
    expect(r.res.status).toBe(200);
  });
});
