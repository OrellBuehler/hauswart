import { afterEach, describe, expect, it } from "vitest";
import { createApiClient } from "$lib/api/client";
import { endpoints } from "$lib/api/registry";
import { shutdownMarkdownWorkers } from "$lib/server/docs/markdown-runner";
import {
  createCaller,
  createInProcessFetch,
  errorCode,
} from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";

afterEach(() => shutdownMarkdownWorkers());

describe("search API", () => {
  useTestDB();

  async function member() {
    const user = await createTestUser();
    return { user, call: createCaller({ session: loginTestUser(user).token }) };
  }

  it("finds across pages, assets, rooms and tasks", async () => {
    const { call } = await member();
    await call("POST", "/api/v1/pages", {
      json: { title: "Heizung", bodyMd: "Ventil im Keller" },
    });
    await call("POST", "/api/v1/assets", {
      json: { name: "Heizkessel", manufacturer: "Acme" },
    });
    await call("POST", "/api/v1/rooms", { json: { name: "Heizraum" } });
    await call("POST", "/api/v1/tasks", {
      json: {
        title: "Heizung warten",
        trigger: {
          v: 1,
          type: "interval",
          every: 12,
          unit: "month",
          anchor: "completion",
          startDate: "2026-06-20",
        },
      },
    });
    const r = await call("GET", "/api/v1/search?q=heiz");
    expect(r.res.status).toBe(200);
    const { items } = r.body as {
      items: {
        type: string;
        title: string;
        url: string;
        snippet: string;
        id: string;
      }[];
    };
    expect(items.map((i) => i.type).sort()).toEqual([
      "asset",
      "page",
      "room",
      "task",
    ]);
    for (const hit of items) {
      expect(hit.id).toBeTruthy();
      expect(hit.url).toMatch(/^\/(docs|inventory|rooms|tasks)\//);
      expect(typeof hit.snippet).toBe("string");
    }
    expect(items.find((i) => i.type === "page")!.url).toBe("/docs/heizung");
    expect(r.res.headers.get("cache-control")).toBe("no-store");

    const onlyRooms = await call("GET", "/api/v1/search?q=heiz&type=room");
    expect(
      (onlyRooms.body as { items: { type: string }[] }).items.map(
        (i) => i.type,
      ),
    ).toEqual(["room"]);
    expect(
      (await call("GET", "/api/v1/search?q=heiz&limit=2")).body,
    ).toMatchObject({ items: [{}, {}] });
    expect(
      (
        (await call("GET", "/api/v1/search?q=acme")).body as {
          items: unknown[];
        }
      ).items,
    ).toHaveLength(1);
    expect((await call("GET", "/api/v1/search?q=nichts")).body).toEqual({
      items: [],
    });
  });

  it("validates the query", async () => {
    const { call } = await member();
    for (const query of [
      "",
      "?q=",
      "?q=%20",
      "?q=x&type=user",
      "?q=x&limit=0",
      "?q=x&limit=51",
      `?q=${"x".repeat(101)}`,
    ]) {
      const r = await call("GET", `/api/v1/search${query}`);
      expect([query, r.res.status, errorCode(r)]).toEqual([
        query,
        400,
        "invalid_request",
      ]);
    }
  });

  it("odd characters are answered, not crashed on", async () => {
    const { call } = await member();
    for (const q of [
      '"',
      "*",
      "AND",
      "'; DROP TABLE users; --",
      "(",
      "%",
      "ü",
      "名前",
    ]) {
      const r = await call("GET", `/api/v1/search?q=${encodeURIComponent(q)}`);
      expect([q, r.res.status]).toEqual([q, 200]);
    }
  });

  it("never returns secret text, in titles or snippets", async () => {
    const { call } = await member();
    const SECRET = "geheimcode-4711";
    await call("POST", "/api/v1/pages", {
      json: {
        title: "Tresor",
        bodyMd: `Öffentlich\n\n:::secret\n${SECRET}\n:::`,
      },
    });
    await call("POST", "/api/v1/assets", {
      json: { name: "Safe", notes: `Bekannt\n:::secret\n${SECRET}\n:::` },
    });
    await call("POST", "/api/v1/rooms", {
      json: { name: "Keller", notes: `Hinweis\n\n:::secret\n${SECRET}\n:::` },
    });
    for (const q of [
      SECRET,
      "geheimcode",
      "tresor",
      "safe",
      "keller",
      "öffentlich",
      "bekannt",
      "hinweis",
    ]) {
      const r = await call("GET", `/api/v1/search?q=${encodeURIComponent(q)}`);
      expect(JSON.stringify(r.body), q).not.toContain(SECRET);
    }
    expect(
      (
        (await call("GET", `/api/v1/search?q=${SECRET}`)).body as {
          items: unknown[];
        }
      ).items,
    ).toEqual([]);
  });

  it("works with a read token through the typed client", async () => {
    const { user, call } = await member();
    await call("POST", "/api/v1/rooms", { json: { name: "Waschküche" } });
    const { token } = createTestToken(user, { scopes: ["read"] });
    const api = createApiClient(createInProcessFetch({ bearer: token }));
    const result = await api.call(endpoints.search, { query: { q: "wasch" } });
    expect(result.items).toMatchObject([{ type: "room", title: "Waschküche" }]);
    const none = createApiClient(
      createInProcessFetch({
        bearer: createTestToken(user, { scopes: ["write"] }).token,
      }),
    );
    await expect(
      none.call(endpoints.search, { query: { q: "wasch" } }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
