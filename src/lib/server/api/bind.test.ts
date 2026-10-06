import { error, redirect } from "@sveltejs/kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError } from "$lib/api/errors";
import { defineEndpoint } from "$lib/api/registry";
import { emptySchema, paginationQuerySchema } from "$lib/api/schemas/common";
import {
  AuthError,
  type SessionUser,
  type TokenInfo,
} from "$lib/server/auth/types";
import {
  RateLimitedError,
  TOKEN_REQUESTS_PER_MINUTE,
  PUBLIC_POSTS_PER_MINUTE,
} from "$lib/server/auth/rate-limit";
import { useTestDB } from "$lib/testing/db";
import { createTestEvent, type TestEventOptions } from "$lib/testing/event";
import { FileError } from "$lib/server/files/errors";
import { MarkdownError } from "$lib/server/docs/markdown-core";
import { bind, reply } from "./bind";

const member: SessionUser = {
  id: "u-member",
  username: "member",
  displayName: null,
  role: "member",
  locale: "de",
};
const admin: SessionUser = {
  ...member,
  id: "u-admin",
  username: "admin",
  role: "admin",
};
const session = { id: "s1", expiresAt: new Date(2_000_000_000_000) };
const token = (scopes: TokenInfo["scopes"]): TokenInfo => ({
  id: "t1",
  kind: "mcp",
  scopes,
});

interface Who {
  user?: SessionUser;
  session?: boolean;
  token?: TokenInfo;
}

const okSchema = z.object({ ok: z.boolean() });
const base = {
  method: "GET",
  path: "/api/v1/things",
  summary: "s",
  tags: ["things"],
  scopes: [],
  response: okSchema,
} as const;

const ok = () => ({ ok: true });

async function call(
  bound: (event: never) => Promise<Response>,
  who: Who = {},
  opts: TestEventOptions = {},
) {
  const event = createTestEvent({
    url: "http://localhost/api/v1/things",
    ...opts,
    locals: {
      user: who.user ?? null,
      session: who.session ? session : null,
      token: who.token ?? null,
    },
  });
  const res = await bound(event as never);
  const text = await res.text();
  return { res, body: text ? JSON.parse(text) : null, event };
}

const json = (body: unknown, extra: Record<string, string> = {}) => ({
  body: JSON.stringify(body),
  headers: {
    "content-type": "application/json",
    origin: "http://localhost",
    ...extra,
  },
});

const codeOf = (r: { body: { error: { code: string } } }) => r.body.error.code;

describe("bind", () => {
  useTestDB();
  afterEach(() => vi.restoreAllMocks());

  it("exposes its endpoint for the registry guard", () => {
    const e = defineEndpoint({ ...base, id: "t", auth: "public" });
    expect(bind(e, ok).endpoint).toBe(e);
  });

  describe("authentication modes", () => {
    const session$ = bind(
      defineEndpoint({ ...base, id: "s", auth: "session" }),
      ok,
    );
    const bearer$ = bind(
      defineEndpoint({ ...base, id: "b", auth: "bearer" }),
      ok,
    );
    const both$ = bind(defineEndpoint({ ...base, id: "o", auth: "both" }), ok);

    it("session: cookie only", async () => {
      expect(
        (await call(session$, { user: member, session: true })).res.status,
      ).toBe(200);
      const anon = await call(session$);
      expect([anon.res.status, codeOf(anon)]).toEqual([401, "unauthenticated"]);
      const tok = await call(session$, {
        user: member,
        token: token(["read"]),
      });
      expect([tok.res.status, codeOf(tok)]).toEqual([403, "forbidden"]);
    });

    it("bearer: token only", async () => {
      expect(
        (await call(bearer$, { user: member, token: token(["read"]) })).res
          .status,
      ).toBe(200);
      const anon = await call(bearer$);
      expect([anon.res.status, codeOf(anon)]).toEqual([401, "unauthenticated"]);
      const cookie = await call(bearer$, { user: member, session: true });
      expect([cookie.res.status, codeOf(cookie)]).toEqual([403, "forbidden"]);
    });

    it("both: either, but not nobody", async () => {
      expect(
        (await call(both$, { user: member, session: true })).res.status,
      ).toBe(200);
      expect(
        (await call(both$, { user: member, token: token([]) })).res.status,
      ).toBe(200);
      expect((await call(both$)).res.status).toBe(401);
    });

    it("public: anyone, with the caller in ctx when there is one", async () => {
      const seen: unknown[] = [];
      const pub$ = bind(
        defineEndpoint({ ...base, id: "p", auth: "public" }),
        ({ ctx }) => {
          seen.push(ctx.user?.id ?? null, ctx.principal?.auth ?? null);
          return { ok: true };
        },
      );
      expect((await call(pub$)).res.status).toBe(200);
      expect(
        (await call(pub$, { user: member, session: true })).res.status,
      ).toBe(200);
      expect(seen).toEqual([null, null, "u-member", "session"]);
    });
  });

  describe("scopes", () => {
    const write$ = bind(
      defineEndpoint({
        ...base,
        id: "w",
        auth: "both",
        scopes: ["read", "write"],
      }),
      ok,
    );
    const admin$ = bind(
      defineEndpoint({ ...base, id: "a", auth: "both", scopes: ["admin"] }),
      ok,
    );

    it("rejects a token missing a required scope with 403 and the missing scopes", async () => {
      const r = await call(write$, { user: member, token: token(["read"]) });
      expect([r.res.status, codeOf(r)]).toEqual([403, "forbidden"]);
      expect(r.body.error.details).toEqual({ missingScopes: ["write"] });
    });

    it("accepts a token holding all required scopes", async () => {
      expect(
        (await call(write$, { user: member, token: token(["write", "read"]) }))
          .res.status,
      ).toBe(200);
    });

    it("gives sessions every scope their role allows", async () => {
      expect(
        (await call(write$, { user: member, session: true })).res.status,
      ).toBe(200);
      expect(
        (await call(admin$, { user: admin, session: true })).res.status,
      ).toBe(200);
      expect(
        (await call(admin$, { user: member, session: true })).res.status,
      ).toBe(403);
    });

    it("caps token scopes by the owner's role (a member's admin token is not admin)", async () => {
      expect(
        (await call(admin$, { user: member, token: token(["admin"]) })).res
          .status,
      ).toBe(403);
      expect(
        (await call(admin$, { user: admin, token: token(["admin"]) })).res
          .status,
      ).toBe(200);
      expect(
        (await call(admin$, { user: admin, token: token(["read"]) })).res
          .status,
      ).toBe(403);
    });
  });

  describe("CSRF", () => {
    const post = (extra = {}) =>
      defineEndpoint({
        ...base,
        id: "post",
        method: "POST",
        auth: "both",
        body: z.object({ n: z.number() }),
        ...extra,
      });
    const post$ = bind(post(), ok);
    const cookie: Who = { user: member, session: true };

    it("accepts same-origin JSON from a cookie session", async () => {
      expect((await call(post$, cookie, json({ n: 1 }))).res.status).toBe(200);
      expect(
        (
          await call(
            post$,
            cookie,
            json(
              { n: 1 },
              { "content-type": "application/json; charset=utf-8" },
            ),
          )
        ).res.status,
      ).toBe(200);
    });

    it("rejects a cross-origin cookie POST", async () => {
      const r = await call(
        post$,
        cookie,
        json({ n: 1 }, { origin: "https://evil.example" }),
      );
      expect([r.res.status, codeOf(r)]).toEqual([403, "csrf_failed"]);
    });

    it("rejects a cookie POST without Origin, with a null Origin or another port", async () => {
      const opts = json({ n: 1 });
      const without = {
        ...opts,
        headers: { "content-type": "application/json" },
      };
      expect(codeOf(await call(post$, cookie, without))).toBe("csrf_failed");
      expect(
        codeOf(await call(post$, cookie, json({ n: 1 }, { origin: "null" }))),
      ).toBe("csrf_failed");
      expect(
        codeOf(
          await call(
            post$,
            cookie,
            json({ n: 1 }, { origin: "http://localhost:8080" }),
          ),
        ),
      ).toBe("csrf_failed");
    });

    it("rejects form content types from a cookie session even same-origin", async () => {
      for (const type of [
        "application/x-www-form-urlencoded",
        "text/plain",
        "multipart/form-data; boundary=x",
        "",
      ]) {
        const headers: Record<string, string> = { origin: "http://localhost" };
        if (type) headers["content-type"] = type;
        const r = await call(post$, cookie, { body: "n=1", headers });
        expect([r.res.status, codeOf(r)], type).toEqual([403, "csrf_failed"]);
      }
    });

    it("never checks safe methods", async () => {
      const get$ = bind(
        defineEndpoint({ ...base, id: "get", auth: "both" }),
        ok,
      );
      expect(
        (
          await call(get$, cookie, {
            headers: { origin: "https://evil.example" },
          })
        ).res.status,
      ).toBe(200);
    });

    it("checks PATCH and DELETE too", async () => {
      for (const method of ["PATCH", "DELETE"] as const) {
        const e = defineEndpoint({
          ...base,
          id: method,
          method,
          auth: "session",
          ...(method === "PATCH" ? { body: z.object({ n: z.number() }) } : {}),
        });
        const bound = bind(e, ok);
        const headers = {
          origin: "https://evil.example",
          "content-type": "application/json",
        };
        const r = await call(bound, cookie, {
          method,
          headers,
          body: method === "PATCH" ? '{"n":1}' : undefined,
        });
        expect([r.res.status, codeOf(r)], method).toEqual([403, "csrf_failed"]);
      }
    });

    it("lets bearer requests skip the check", async () => {
      const bearer: Who = { user: member, token: token(["read"]) };
      expect(
        (
          await call(post$, bearer, {
            body: '{"n":1}',
            headers: { "content-type": "application/json" },
          })
        ).res.status,
      ).toBe(200);
      expect(
        (
          await call(
            post$,
            bearer,
            json({ n: 1 }, { origin: "https://evil.example" }),
          )
        ).res.status,
      ).toBe(200);
    });

    it("still requires a JSON body from bearer clients (415, not csrf)", async () => {
      const r = await call(
        post$,
        { user: member, token: token([]) },
        { body: "n=1", headers: { "content-type": "text/plain" } },
      );
      expect([r.res.status, codeOf(r)]).toEqual([415, "invalid_request"]);
    });

    it("bodyless cookie requests may omit the content type but not send a form one", async () => {
      const del$ = bind(
        defineEndpoint({
          ...base,
          id: "del",
          method: "DELETE",
          auth: "session",
          status: 204,
          response: emptySchema,
        }),
        () => null,
      );
      expect(
        (
          await call(del$, cookie, {
            method: "DELETE",
            headers: { origin: "http://localhost" },
          })
        ).res.status,
      ).toBe(204);
      const bad = await call(del$, cookie, {
        method: "DELETE",
        headers: { origin: "http://localhost", "content-type": "text/plain" },
      });
      expect(codeOf(bad)).toBe("csrf_failed");
    });

    it("checks cookie-setting public endpoints even for anonymous callers", async () => {
      const login$ = bind(
        post({ id: "login", auth: "public", setsSession: true }),
        ok,
      );
      const cross = await call(
        login$,
        {},
        json({ n: 1 }, { origin: "https://evil.example" }),
      );
      expect([cross.res.status, codeOf(cross)]).toEqual([403, "csrf_failed"]);
      const none = await call(
        login$,
        {},
        { body: '{"n":1}', headers: { "content-type": "application/json" } },
      );
      expect(codeOf(none)).toBe("csrf_failed");
      expect((await call(login$, {}, json({ n: 1 }))).res.status).toBe(200);
    });

    it("leaves public endpoints that set no cookie to non-browser clients", async () => {
      const token$ = bind(post({ id: "tok", auth: "public" }), ok);
      const native = {
        body: '{"n":1}',
        headers: { "content-type": "application/json" },
      };
      expect((await call(token$, {}, native)).res.status).toBe(200);
      // ...but a browser that is logged in is still a cookie caller
      expect(
        codeOf(
          await call(token$, cookie, {
            ...native,
            headers: { ...native.headers, origin: "https://evil.example" },
          }),
        ),
      ).toBe("csrf_failed");
    });

    it("requires multipart from cookie callers when the endpoint declares a multipart body", async () => {
      const up$ = bind(
        defineEndpoint({
          ...base,
          id: "up",
          method: "POST",
          auth: "both",
          bodyType: "multipart",
          body: z.object({ title: z.string(), file: z.file() }),
        }),
        ({ body }) => ({ ok: body.file.size === 3 && body.title === "t" }),
      );
      const form = { title: "t", file: new File(["abc"], "a.txt") };
      const ok$ = await call(up$, cookie, {
        form,
        headers: { origin: "http://localhost" },
      });
      expect([ok$.res.status, ok$.body]).toEqual([200, { ok: true }]);
      const asJson = await call(up$, cookie, json({ title: "t" }));
      expect(codeOf(asJson)).toBe("csrf_failed");
      const cross = await call(up$, cookie, {
        form,
        headers: { origin: "https://evil.example" },
      });
      expect(codeOf(cross)).toBe("csrf_failed");
      const bearer = await call(
        up$,
        { user: member, token: token([]) },
        { form },
      );
      expect(bearer.body).toEqual({ ok: true });
      const wrongType = await call(
        up$,
        { user: member, token: token([]) },
        json({ title: "t" }),
      );
      expect([wrongType.res.status, codeOf(wrongType)]).toEqual([
        415,
        "invalid_request",
      ]);
    });
  });

  describe("input parsing", () => {
    const e = defineEndpoint({
      ...base,
      id: "parse",
      method: "POST",
      path: "/api/v1/things/{id}",
      auth: "session",
      params: z.object({ id: z.string().min(2) }),
      query: paginationQuerySchema.extend({
        tag: z.array(z.string()).optional(),
      }),
      body: z.strictObject({
        name: z.string().min(1),
        n: z.number().int().optional(),
      }),
      response: z.object({
        params: z.unknown(),
        query: z.unknown(),
        body: z.unknown(),
      }),
    });
    const bound = bind(e, ({ params, query, body }) => ({
      params,
      query,
      body,
    }));
    const cookie: Who = { user: member, session: true };

    it("hands the handler parsed params, coerced query and body", async () => {
      const r = await call(bound, cookie, {
        url: "http://localhost/api/v1/things/abc?limit=7&tag=a&tag=b",
        params: { id: "abc" },
        ...json({ name: "x" }),
      });
      expect(r.body).toEqual({
        params: { id: "abc" },
        query: { limit: 7, tag: ["a", "b"] },
        body: { name: "x" },
      });
    });

    it("applies query defaults", async () => {
      const r = await call(bound, cookie, {
        params: { id: "abc" },
        ...json({ name: "x" }),
      });
      expect(r.body.query).toEqual({ limit: 50 });
    });

    it("answers 400 invalid_request with flattened issues per source", async () => {
      const r = await call(bound, cookie, {
        url: "http://localhost/api/v1/things/a?limit=0",
        params: { id: "a" },
        ...json({ name: "", extra: 1 }),
      });
      expect([r.res.status, codeOf(r)]).toEqual([400, "invalid_request"]);
      const details = r.body.error.details;
      expect(Object.keys(details).sort()).toEqual(["body", "params", "query"]);
      expect(details.params.fieldErrors.id).toHaveLength(1);
      expect(details.query.fieldErrors.limit).toHaveLength(1);
      expect(details.body.fieldErrors.name).toHaveLength(1);
      expect(details.body.formErrors.join()).toMatch(/extra/i);
    });

    it("does not echo submitted values back", async () => {
      const r = await call(bound, cookie, {
        params: { id: "abc" },
        ...json({ name: 5, n: "hunter2-secret" }),
      });
      expect(r.res.status).toBe(400);
      expect(JSON.stringify(r.body)).not.toContain("hunter2-secret");
    });

    it("rejects malformed JSON, empty bodies and non-JSON content types", async () => {
      const bearer: Who = { user: member, token: token([]) };
      const be = bind(
        defineEndpoint({ ...e, id: "p2", auth: "bearer" }),
        ({ body }) => ({ params: null, query: null, body }),
      );
      const h = { "content-type": "application/json" };
      const bad = await call(be, bearer, {
        params: { id: "abc" },
        body: "{nope",
        headers: h,
      });
      expect([bad.res.status, codeOf(bad), bad.body.error.message]).toEqual([
        400,
        "invalid_request",
        "Body is not valid JSON",
      ]);
      const empty = await call(be, bearer, {
        params: { id: "abc" },
        method: "POST",
        body: "",
        headers: h,
      });
      expect([empty.res.status, codeOf(empty)]).toEqual([
        400,
        "invalid_request",
      ]);
      const nonJson = await call(be, bearer, {
        params: { id: "abc" },
        body: "name=x",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      expect([nonJson.res.status, codeOf(nonJson)]).toEqual([
        415,
        "invalid_request",
      ]);
    });

    it("rejects oversized bodies with 413, declared or streamed", async () => {
      const small = bind(
        defineEndpoint({ ...e, id: "p3", auth: "bearer", maxBodyBytes: 64 }),
        ({ body }) => ({ params: null, query: null, body }),
      );
      const bearer: Who = { user: member, token: token([]) };
      const h = { "content-type": "application/json" };
      const big = JSON.stringify({ name: "x".repeat(100) });
      const streamed = await call(small, bearer, {
        params: { id: "abc" },
        body: big,
        headers: h,
      });
      expect([streamed.res.status, codeOf(streamed)]).toEqual([
        413,
        "invalid_request",
      ]);
      const declared = await call(small, bearer, {
        params: { id: "abc" },
        body: big,
        headers: { ...h, "content-length": "5000" },
      });
      expect(declared.res.status).toBe(413);
      const fits = await call(small, bearer, {
        params: { id: "abc" },
        body: '{"name":"x"}',
        headers: h,
      });
      expect(fits.res.status).toBe(200);
    });

    describe("multipart bodies", () => {
      const up$ = bind(
        defineEndpoint({
          ...base,
          id: "mp",
          method: "POST",
          auth: "bearer",
          bodyType: "multipart",
          maxBodyBytes: 1024,
          body: z.object({ title: z.string(), file: z.file() }),
        }),
        ({ body }) => ({ ok: body.file.size > 0 }),
      );
      const bearer: Who = { user: member, token: token([]) };

      it("answers 400 invalid_request, not 500, for a malformed multipart body", async () => {
        for (const contentType of [
          "multipart/form-data; boundary=abc",
          "multipart/form-data",
        ]) {
          const r = await call(up$, bearer, {
            body: "garbage",
            headers: { "content-type": contentType },
          });
          expect([r.res.status, codeOf(r)], contentType).toEqual([
            400,
            "invalid_request",
          ]);
        }
      });

      it("enforces the size limit on chunked bodies without Content-Length", async () => {
        const event = createTestEvent({
          url: "http://localhost/api/v1/things",
          method: "POST",
          locals: { user: bearer.user, session: null, token: bearer.token },
        });
        const boundary = "xxBOUNDARYxx";
        const chunk = new TextEncoder().encode(
          `--${boundary}\r\ncontent-disposition: form-data; name="title"\r\n\r\nt\r\n--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="a.bin"\r\n\r\n${"a".repeat(600)}`,
        );
        let sent = 0;
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            sent++;
            if (sent > 20) {
              controller.close();
              return;
            }
            controller.enqueue(chunk);
          },
        });
        event.request = new Request(event.url, {
          method: "POST",
          headers: {
            "content-type": `multipart/form-data; boundary=${boundary}`,
          },
          body: stream,
          // @ts-expect-error Bun and Node need duplex for stream bodies
          duplex: "half",
        });
        expect(event.request.headers.get("content-length")).toBeNull();
        const res = await up$(event as never);
        expect([res.status, (await res.json()).error.code]).toEqual([
          413,
          "invalid_request",
        ]);
        expect(sent).toBeLessThan(10);
      });

      it("still accepts a valid upload within the limit", async () => {
        const r = await call(up$, bearer, {
          form: { title: "t", file: new File(["abc"], "a.txt") },
        });
        expect([r.res.status, r.body]).toEqual([200, { ok: true }]);
      });
    });

    it("is not affected by a __proto__ query key", async () => {
      const q = bind(
        defineEndpoint({
          ...base,
          id: "q",
          auth: "session",
          query: z.object({ a: z.string().optional() }),
          response: z.object({ polluted: z.boolean() }),
        }),
        () => ({ polluted: ({} as { x?: unknown }).x !== undefined }),
      );
      const r = await call(q, cookie, {
        url: "http://localhost/api/v1/things?__proto__=x&a=1",
      });
      expect(r.body).toEqual({ polluted: false });
    });
  });

  describe("handler contract", () => {
    it("passes ctx with db, user, principal, now and today in the household zone", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-14T23:30:00Z"));
      process.env.HAUSWART_TZ = "Europe/Zurich";
      try {
        let seen: Record<string, unknown> = {};
        const e = defineEndpoint({ ...base, id: "ctx", auth: "session" });
        await call(
          bind(e, ({ ctx }) => {
            seen = { ...ctx };
            return { ok: true };
          }),
          { user: admin, session: true },
        );
        expect(seen.now).toBe(Date.parse("2026-03-14T23:30:00Z"));
        expect(seen.today).toBe("2026-03-15");
        expect((seen.user as SessionUser).id).toBe("u-admin");
        expect((seen.principal as { auth: string }).auth).toBe("session");
        expect(seen.db).toBeDefined();
      } finally {
        vi.useRealTimers();
        delete process.env.HAUSWART_TZ;
      }
    });

    it("uses the declared status, supports reply() and 204 without a body", async () => {
      const created = bind(
        defineEndpoint({ ...base, id: "c", auth: "public", status: 201 }),
        ok,
      );
      expect((await call(created)).res.status).toBe(201);
      const accepted = bind(
        defineEndpoint({ ...base, id: "r", auth: "public" }),
        () => reply(202, { ok: true }),
      );
      expect((await call(accepted)).res.status).toBe(202);
      const none = bind(
        defineEndpoint({
          ...base,
          id: "n",
          auth: "public",
          status: 204,
          response: emptySchema,
        }),
        () => null,
      );
      const r = await call(none);
      expect([r.res.status, r.body]).toEqual([204, null]);
    });

    it("marks every response no-store, success and error", async () => {
      const e = bind(
        defineEndpoint({ ...base, id: "ns", auth: "session" }),
        ok,
      );
      expect(
        (await call(e, { user: member, session: true })).res.headers.get(
          "cache-control",
        ),
      ).toBe("no-store");
      expect((await call(e)).res.headers.get("cache-control")).toBe("no-store");
    });

    it("lets handlers set cookies through the event", async () => {
      const e = bind(
        defineEndpoint({ ...base, id: "ck", auth: "public" }),
        ({ event }) => {
          event.cookies.set("x", "1", { path: "/" });
          return { ok: true };
        },
      );
      const r = await call(e);
      expect(
        (r.event.cookies as unknown as { get(n: string): string }).get("x"),
      ).toBe("1");
    });
  });

  describe("response validation", () => {
    const bad = bind(
      defineEndpoint({ ...base, id: "bad", auth: "public" }),
      (() => ({ ok: "yes" })) as never,
    );

    it("fails with 500 internal when the response breaks its schema (outside production)", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const r = await call(bad);
      expect([r.res.status, codeOf(r)]).toEqual([500, "internal"]);
      expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
        event: "api.error",
        endpoint: "bad",
        name: "ResponseContractError",
      });
    });

    it("skips validation in production", async () => {
      const previous = Bun.env.NODE_ENV;
      Bun.env.NODE_ENV = "production";
      try {
        const r = await call(bad);
        expect([r.res.status, r.body]).toEqual([200, { ok: "yes" }]);
      } finally {
        Bun.env.NODE_ENV = previous;
      }
    });
  });

  describe("binary responses", () => {
    const file = defineEndpoint({
      ...base,
      id: "file",
      auth: "both",
      scopes: ["read"],
      path: "/api/v1/things/{id}",
      params: z.object({ id: z.string() }),
      response: z.null(),
      responseType: "binary",
      contentTypes: ["image/png"],
    });

    it("passes the handler's Response through untouched, with auth and param parsing", async () => {
      const bound = bind(
        file,
        ({ params }) =>
          new Response(`bytes of ${params.id}`, {
            status: 200,
            headers: { "content-type": "image/png", etag: '"x"' },
          }),
      );
      const r = await bound(
        createTestEvent({
          url: "http://localhost/api/v1/things/42",
          params: { id: "42" },
          locals: { user: member, session, token: null },
        }) as never,
      );
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("image/png");
      expect(r.headers.get("etag")).toBe('"x"');
      expect(r.headers.get("cache-control")).toBeNull();
      expect(await r.text()).toBe("bytes of 42");
    });

    it("keeps the guards: anonymous callers and missing scopes never reach the handler", async () => {
      let reached = 0;
      const bound = bind(file, () => {
        reached += 1;
        return new Response("x");
      });
      const anon = await call(bound, {}, { params: { id: "1" } });
      expect(anon.res.status).toBe(401);
      const noScope = await call(
        bound,
        { user: member, token: token([]) },
        { params: { id: "1" } },
      );
      expect(noScope.res.status).toBe(403);
      expect(reached).toBe(0);
    });

    it("maps errors thrown by the handler to the JSON envelope", async () => {
      const bound = bind(file, () => {
        throw new ApiError("not_found", "File not found");
      });
      const r = await call(
        bound,
        { user: member, session: true },
        { params: { id: "1" } },
      );
      expect([r.res.status, codeOf(r)]).toEqual([404, "not_found"]);
      expect(r.res.headers.get("cache-control")).toBe("no-store");
    });

    it("fails with 500 when a binary handler returns something that is not a Response", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const bound = bind(file, (() => ({ ok: true })) as never);
      const r = await call(
        bound,
        { user: member, session: true },
        { params: { id: "1" } },
      );
      expect([r.res.status, codeOf(r)]).toEqual([500, "internal"]);
    });
  });

  describe("error mapping", () => {
    const run = (thrower: () => never) =>
      call(
        bind(defineEndpoint({ ...base, id: "err", auth: "public" }), thrower),
        {},
      );

    it("maps ApiError to the envelope with its status and details", async () => {
      const r = await run(() => {
        throw new ApiError("conflict", "Already there", {
          details: { field: "name" },
        });
      });
      expect(r.res.status).toBe(409);
      expect(r.body).toEqual({
        error: {
          code: "conflict",
          message: "Already there",
          details: { field: "name" },
        },
      });
    });

    it("maps service errors", async () => {
      const taken = await run(() => {
        throw new AuthError("username_taken", "Username is already taken.");
      });
      expect([taken.res.status, codeOf(taken)]).toEqual([409, "conflict"]);
      const closed = await run(() => {
        throw new AuthError("setup_closed", "done");
      });
      expect([closed.res.status, codeOf(closed)]).toEqual([
        409,
        "setup_complete",
      ]);
      const limited = await run(() => {
        throw new RateLimitedError(90_000);
      });
      expect([limited.res.status, codeOf(limited)]).toEqual([
        429,
        "rate_limited",
      ]);
      expect(limited.res.headers.get("retry-after")).toBe("90");
      expect(limited.body.error.details).toEqual({ retryAfterSeconds: 90 });
    });

    it("maps file and markdown errors to 4xx with a stable details.code", async () => {
      const cases: [Error, number, string, string][] = [
        [new FileError("empty"), 400, "invalid_request", "empty"],
        [new FileError("too_large"), 413, "invalid_request", "too_large"],
        [
          new FileError("unsupported_type"),
          415,
          "invalid_request",
          "unsupported_type",
        ],
        [
          new FileError("unsupported_heic"),
          415,
          "invalid_request",
          "unsupported_heic",
        ],
        [
          new FileError("corrupt_image"),
          400,
          "invalid_request",
          "corrupt_image",
        ],
        [
          new FileError("image_too_large"),
          413,
          "invalid_request",
          "image_too_large",
        ],
        [new MarkdownError("too_large"), 400, "invalid_request", "too_large"],
        [
          new MarkdownError("too_complex"),
          400,
          "invalid_request",
          "too_complex",
        ],
        [new MarkdownError("unavailable"), 503, "internal", "unavailable"],
      ];
      for (const [error, status, code, detail] of cases) {
        const r = await run(() => {
          throw error;
        });
        expect([r.res.status, codeOf(r), r.body.error.details]).toEqual([
          status,
          code,
          { code: detail },
        ]);
      }
      const missing = await run(() => {
        throw new FileError("invalid_path");
      });
      expect([missing.res.status, codeOf(missing)]).toEqual([404, "not_found"]);
    });

    it("maps SvelteKit http errors and rethrows redirects", async () => {
      const nf = await run(() => error(404, "gone"));
      expect([nf.res.status, codeOf(nf)]).toEqual([404, "not_found"]);
      await expect(
        run(() => redirect(303, "/elsewhere")),
      ).rejects.toMatchObject({ status: 303 });
    });

    it("answers unexpected errors with a generic 500 and logs name and code only", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const secret = "alice@example.org";
      const r = await run(() => {
        throw Object.assign(new TypeError(`bad value for ${secret}`), {
          code: "ERR_X",
        });
      });
      expect([r.res.status, r.body]).toEqual([
        500,
        { error: { code: "internal", message: "Internal server error" } },
      ]);
      expect(log).toHaveBeenCalledOnce();
      const line = String(log.mock.calls[0][0]);
      expect(JSON.parse(line)).toEqual({
        event: "api.error",
        endpoint: "err",
        name: "TypeError",
        code: "ERR_X",
      });
      expect(line).not.toContain(secret);
    });

    it("survives a thrown non-error", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const r = await run(() => {
        throw "boom";
      });
      expect([r.res.status, codeOf(r)]).toEqual([500, "internal"]);
    });
  });

  describe("rate limiting", () => {
    it("limits a bearer token per token id", async () => {
      const e = bind(defineEndpoint({ ...base, id: "rl", auth: "bearer" }), ok);
      const who: Who = { user: member, token: token(["read"]) };
      for (let i = 0; i < TOKEN_REQUESTS_PER_MINUTE; i++) {
        expect((await call(e, who)).res.status).toBe(200);
      }
      const blocked = await call(e, who);
      expect([blocked.res.status, codeOf(blocked)]).toEqual([
        429,
        "rate_limited",
      ]);
      expect(Number(blocked.res.headers.get("retry-after"))).toBeGreaterThan(0);
      const other = await call(e, {
        user: member,
        token: { ...token(["read"]), id: "t2" },
      });
      expect(other.res.status).toBe(200);
    });

    it("limits state-changing public requests per client address", async () => {
      const e = bind(
        defineEndpoint({
          ...base,
          id: "pl",
          method: "POST",
          auth: "public",
          body: z.object({}),
        }),
        ok,
      );
      const opts = (ip: string) => ({ ...json({}), ip });
      for (let i = 0; i < PUBLIC_POSTS_PER_MINUTE; i++) {
        expect((await call(e, {}, opts("198.51.100.1"))).res.status).toBe(200);
      }
      const blocked = await call(e, {}, opts("198.51.100.1"));
      expect([blocked.res.status, codeOf(blocked)]).toEqual([
        429,
        "rate_limited",
      ]);
      expect((await call(e, {}, opts("198.51.100.2"))).res.status).toBe(200);
    });

    it("limits public posts regardless of the principal, and per IPv6 /64", async () => {
      const e = bind(
        defineEndpoint({
          ...base,
          id: "pl2",
          method: "POST",
          auth: "public",
          body: z.object({}),
        }),
        ok,
      );
      const who: Who = { user: member, token: token(["read"]) };
      for (let i = 0; i < PUBLIC_POSTS_PER_MINUTE; i++) {
        const r = await call(e, who, { ...json({}), ip: "198.51.100.8" });
        expect(r.res.status).toBe(200);
      }
      const asToken = await call(e, who, { ...json({}), ip: "198.51.100.8" });
      expect([asToken.res.status, codeOf(asToken)]).toEqual([
        429,
        "rate_limited",
      ]);
      const anon = await call(e, {}, { ...json({}), ip: "198.51.100.8" });
      expect(anon.res.status).toBe(429);

      for (let i = 0; i < PUBLIC_POSTS_PER_MINUTE; i++) {
        const ip = `2001:db8:5:6:${i + 1}:${i + 2}::${i + 3}`;
        expect((await call(e, {}, { ...json({}), ip })).res.status).toBe(200);
      }
      const sameNet = await call(
        e,
        {},
        { ...json({}), ip: "2001:db8:5:6::ff" },
      );
      expect(sameNet.res.status).toBe(429);
    });

    it("does not limit public reads", async () => {
      const e = bind(defineEndpoint({ ...base, id: "pr", auth: "public" }), ok);
      for (let i = 0; i < PUBLIC_POSTS_PER_MINUTE + 5; i++) {
        expect((await call(e, {}, { ip: "198.51.100.3" })).res.status).toBe(
          200,
        );
      }
    });
  });
});
