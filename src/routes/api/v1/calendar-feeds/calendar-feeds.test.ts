import { describe, expect, it } from "vitest";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { SHARE_TOKEN_PATTERN } from "$lib/server/share/tokens";

type Feed = {
  id: string;
  name: string;
  scope: string;
  url: string | null;
  locale: string;
  alarmTime: string | null;
  alarmDaysBefore: number;
  includeEstimated: boolean;
  lastFetchedAt: string | null;
};

const URL_PATTERN =
  /^http:\/\/localhost\/api\/public\/cal\/([A-Za-z0-9_-]{43})\.ics$/;

describe("calendar feeds API", () => {
  useTestDB();
  async function member(locale: "de" | "en" = "de") {
    const user = await createTestUser({ locale });
    return { user, call: createCaller({ session: loginTestUser(user).token }) };
  }

  it("creates a feed with defaults and returns its address", async () => {
    const { call } = await member("en");
    const r = await call("POST", "/api/v1/calendar-feeds", {
      json: { name: "Phone" },
    });
    expect(r.res.status).toBe(201);
    const feed = r.body as Feed;
    expect(feed).toMatchObject({
      name: "Phone",
      scope: "mine",
      locale: "en",
      includeEstimated: false,
      alarmTime: null,
      alarmDaysBefore: 0,
      lastFetchedAt: null,
    });
    expect(feed.url).toMatch(URL_PATTERN);
    expect(feed.url!.match(URL_PATTERN)![1]).toMatch(SHARE_TOKEN_PATTERN);
    expect(r.res.headers.get("cache-control")).toBe("no-store");
  });

  it("shows the same address again in the list", async () => {
    const { call } = await member();
    const created = (
      await call("POST", "/api/v1/calendar-feeds", { json: { name: "A" } })
    ).body as Feed;
    const list = (await call("GET", "/api/v1/calendar-feeds")).body as {
      items: Feed[];
      nextCursor: null;
    };
    expect(list.items.map((f) => f.url)).toEqual([created.url]);
    expect(list.nextCursor).toBeNull();
  });

  it("validates the body", async () => {
    const { call } = await member();
    const bad = (json: unknown) =>
      call("POST", "/api/v1/calendar-feeds", { json });
    expect(errorCode(await bad({}))).toBe("invalid_request");
    expect(errorCode(await bad({ name: " " }))).toBe("invalid_request");
    expect(errorCode(await bad({ name: "A", scope: "everyone" }))).toBe(
      "invalid_request",
    );
    expect(errorCode(await bad({ name: "A", alarmTime: "25:00" }))).toBe(
      "invalid_request",
    );
    expect(errorCode(await bad({ name: "A", alarmDaysBefore: 31 }))).toBe(
      "invalid_request",
    );
    expect(errorCode(await bad({ name: "A", extra: true }))).toBe(
      "invalid_request",
    );
  });

  it("updates settings and keeps the address", async () => {
    const { call } = await member();
    const created = (
      await call("POST", "/api/v1/calendar-feeds", { json: { name: "A" } })
    ).body as Feed;
    const r = await call("PATCH", `/api/v1/calendar-feeds/${created.id}`, {
      json: { scope: "all", alarmTime: "18:00", alarmDaysBefore: 1 },
    });
    expect(r.body).toMatchObject({
      scope: "all",
      alarmTime: "18:00",
      alarmDaysBefore: 1,
      url: created.url,
    });
    const cleared = await call(
      "PATCH",
      `/api/v1/calendar-feeds/${created.id}`,
      {
        json: { alarmTime: null },
      },
    );
    expect((cleared.body as Feed).alarmTime).toBeNull();
    expect(
      errorCode(
        await call("PATCH", `/api/v1/calendar-feeds/${created.id}`, {
          json: {},
        }),
      ),
    ).toBe("invalid_request");
  });

  it("rotates the address", async () => {
    const { call } = await member();
    const created = (
      await call("POST", "/api/v1/calendar-feeds", { json: { name: "A" } })
    ).body as Feed;
    const r = await call("POST", `/api/v1/calendar-feeds/${created.id}/rotate`);
    expect(r.res.status).toBe(200);
    const rotated = r.body as Feed;
    expect(rotated.id).toBe(created.id);
    expect(rotated.url).toMatch(URL_PATTERN);
    expect(rotated.url).not.toBe(created.url);
  });

  it("deletes a feed", async () => {
    const { call } = await member();
    const created = (
      await call("POST", "/api/v1/calendar-feeds", { json: { name: "A" } })
    ).body as Feed;
    expect(
      (await call("DELETE", `/api/v1/calendar-feeds/${created.id}`)).res.status,
    ).toBe(204);
    expect(
      ((await call("GET", "/api/v1/calendar-feeds")).body as { items: Feed[] })
        .items,
    ).toEqual([]);
    expect(
      errorCode(await call("DELETE", `/api/v1/calendar-feeds/${created.id}`)),
    ).toBe("not_found");
  });

  it("keeps every user's feeds to themselves", async () => {
    const [a, b] = [await member(), await member()];
    const feed = (
      await a.call("POST", "/api/v1/calendar-feeds", { json: { name: "A" } })
    ).body as Feed;
    expect(
      (
        (await b.call("GET", "/api/v1/calendar-feeds")).body as {
          items: Feed[];
        }
      ).items,
    ).toEqual([]);
    for (const [method, path, json] of [
      ["PATCH", `/api/v1/calendar-feeds/${feed.id}`, { name: "x" }],
      ["DELETE", `/api/v1/calendar-feeds/${feed.id}`, undefined],
      ["POST", `/api/v1/calendar-feeds/${feed.id}/rotate`, undefined],
    ] as const) {
      const r = await b.call(method, path, json ? { json } : {});
      expect([r.res.status, errorCode(r)]).toEqual([404, "not_found"]);
    }
    expect(
      (
        (await a.call("GET", "/api/v1/calendar-feeds")).body as {
          items: Feed[];
        }
      ).items[0].url,
    ).toBe(feed.url);
  });

  it("is for browser sessions only: a token with every scope is refused", async () => {
    const user = await createTestUser({ role: "admin" });
    const call = createCaller({
      bearer: createTestToken(user, {
        kind: "mcp",
        scopes: ["read", "write", "admin"],
      }).token,
    });
    const r = await call("GET", "/api/v1/calendar-feeds");
    expect([r.res.status, errorCode(r)]).toEqual([403, "forbidden"]);
  });

  it("limits a user to ten feeds", async () => {
    const { call } = await member();
    for (let i = 0; i < 10; i += 1) {
      expect(
        (await call("POST", "/api/v1/calendar-feeds", { json: { name: "A" } }))
          .res.status,
      ).toBe(201);
    }
    expect(
      errorCode(
        await call("POST", "/api/v1/calendar-feeds", { json: { name: "A" } }),
      ),
    ).toBe("conflict");
  });
});
