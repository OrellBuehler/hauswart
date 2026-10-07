import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import type { TokenKind } from "$lib/api/enums";
import type { Scope } from "$lib/api/scopes";
import { APP_VERSION } from "$lib/server/version";
import { createInProcessFetch, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { callRoute, type CallOptions } from "$lib/testing/route";
import { everyDays, parseReply } from "../../../../../mcp/src/test-harness";
import { tools } from "../../../../../mcp/src/tools";
import * as route from "./+server";

const URL_ = "http://localhost/api/v1/mcp";
const ACCEPT = "application/json, text/event-stream";

const rpc = (id: number, method: string, params?: unknown) => ({
  jsonrpc: "2.0",
  id,
  method,
  params,
});
const callTool = (id: number, name: string, args: Record<string, unknown>) =>
  rpc(id, "tools/call", { name, arguments: args });

/** What an MCP client sends: no Origin, both Accept types. */
const post = (opts: CallOptions) =>
  callRoute(route.POST, {
    url: URL_,
    method: "POST",
    origin: null,
    fetch: createInProcessFetch() as typeof fetch,
    ...opts,
    headers: { accept: ACCEPT, ...opts.headers },
  });

interface RpcBody {
  id: number;
  result?: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  error?: { code: number; message: string };
}
const rpcBody = (r: { body: unknown }) => r.body as RpcBody;

describe("POST /api/v1/mcp", () => {
  useTestDB();

  async function setup(
    opts: {
      kind?: TokenKind;
      scopes?: Scope[];
      role?: "admin" | "member";
    } = {},
  ) {
    const user = await createTestUser({
      displayName: "Anna",
      role: opts.role ?? "admin",
    });
    const { token } = createTestToken(user, {
      kind: opts.kind ?? "mcp",
      scopes: opts.scopes ?? ["read", "write"],
    });
    const call = (json: unknown, more: CallOptions = {}) =>
      post({ bearer: token, json, ...more });
    return { user, token, call };
  }

  const initialize = rpc(1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0.0.0" },
  });

  describe("who may call", () => {
    it("answers anonymous callers with 401 and a Bearer challenge", async () => {
      await createTestUser();
      const r = await post({ json: initialize });
      expect([r.res.status, errorCode(r)]).toEqual([401, "unauthenticated"]);
      expect(r.res.headers.get("www-authenticate")).toBe("Bearer");
    });

    it("rejects a token that does not exist the same way", async () => {
      await createTestUser();
      const r = await post({ bearer: "hw_nonsense", json: initialize });
      expect([r.res.status, errorCode(r)]).toEqual([401, "unauthenticated"]);
      expect(r.res.headers.get("www-authenticate")).toBe("Bearer");
    });

    it("never honours the session cookie", async () => {
      const { user } = await setup();
      const session = loginTestUser(user).token;
      const same = await post({
        session,
        json: initialize,
        origin: new URL(URL_).origin,
      });
      expect([same.res.status, errorCode(same)]).toEqual([403, "forbidden"]);
      const bare = await post({ session, json: initialize });
      expect([bare.res.status, errorCode(bare)]).toEqual([403, "forbidden"]);
    });

    it("needs the read scope", async () => {
      const { call } = await setup({ scopes: ["write"] });
      const r = await call(initialize);
      expect([r.res.status, errorCode(r)]).toEqual([403, "forbidden"]);
    });

    it("takes a token of any kind", async () => {
      const { call } = await setup({ kind: "integration", scopes: ["read"] });
      expect((await call(initialize)).res.status).toBe(200);
    });

    it("exposes POST only, so SvelteKit answers GET and DELETE with 405", () => {
      expect(Object.keys(route)).toEqual(["POST"]);
    });
  });

  describe("origin", () => {
    it("refuses a request from another origin, even with a valid token", async () => {
      const { call } = await setup();
      for (const origin of ["https://evil.example", "http://localhost:8080"]) {
        const r = await call(initialize, { origin });
        expect([origin, r.res.status, errorCode(r)]).toEqual([
          origin,
          403,
          "csrf_failed",
        ]);
      }
    });

    it("refuses the opaque origin of a sandboxed page", async () => {
      const { call } = await setup();
      const r = await call(initialize, { origin: "null" });
      expect([r.res.status, errorCode(r)]).toEqual([403, "csrf_failed"]);
    });

    it("accepts the app's own origin and requests without one", async () => {
      const { call } = await setup();
      expect(
        (await call(initialize, { origin: new URL(URL_).origin })).res.status,
      ).toBe(200);
      expect((await call(initialize, { origin: null })).res.status).toBe(200);
    });
  });

  describe("protocol", () => {
    it("initializes without a session and reports the app's version", async () => {
      const { call } = await setup();
      const r = await call(initialize);
      expect(r.res.status).toBe(200);
      expect(r.res.headers.get("content-type")).toMatch(/^application\/json/);
      expect(r.res.headers.get("cache-control")).toBe("no-store");
      expect(r.res.headers.get("mcp-session-id")).toBeNull();
      expect(rpcBody(r).result).toMatchObject({
        protocolVersion: "2025-06-18",
        serverInfo: { name: "hauswart", version: APP_VERSION },
        capabilities: { tools: {} },
      });
      expect(rpcBody(r).result?.instructions).toContain("hauswart manages");
    });

    it("answers a notification with 202 and no body", async () => {
      const { call } = await setup();
      const r = await call({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });
      expect(r.res.status).toBe(202);
      expect(r.body).toBeNull();
    });

    it("serves every request on its own, without an initialize first", async () => {
      const { call } = await setup();
      const first = await call(rpc(1, "tools/list"));
      const second = await call(rpc(2, "tools/list"));
      expect(rpcBody(first).result?.tools.length).toBeGreaterThan(10);
      expect(rpcBody(second).result?.tools).toEqual(
        rpcBody(first).result?.tools,
      );
    });

    it("lists the tools a token's scopes allow", async () => {
      const expected = (scopes: Scope[]) =>
        tools
          .filter((t) => t.scopes.every((s) => scopes.includes(s)))
          .map((t) => t.name)
          .sort();
      for (const scopes of [
        ["read"],
        ["read", "write"],
        ["read", "write", "docs:write", "costs:write"],
      ] as Scope[][]) {
        const { call } = await setup({ scopes });
        const names = rpcBody(await call(rpc(1, "tools/list")))
          .result?.tools.map((t: { name: string }) => t.name)
          .sort();
        expect(names, scopes.join()).toEqual(expected(scopes));
      }
      expect(expected(["read"])).not.toContain("create_task");
      expect(expected(["read", "write"])).toContain("create_task");
    });

    it("runs a tool as the token's user with the token's scopes", async () => {
      const { call } = await setup({ scopes: ["read"] });
      const who = parseReply(
        rpcBody(await call(callTool(1, "whoami", {}))).result as never,
      );
      expect(who.isError).toBe(false);
      expect(who.json).toMatchObject({
        user: { displayName: "Anna", role: "admin" },
        scopes: ["read"],
      });

      const blocked = await call(
        callTool(2, "create_task", {
          title: "Not allowed",
          trigger: everyDays(7, "2026-01-01"),
        }),
      );
      const refused = parseReply(rpcBody(blocked).result as never);
      expect(refused.isError).toBe(true);
      expect(refused.text).toMatch(/create_task.*not found/i);
    });

    it("attributes completions to the token's kind", async () => {
      for (const [kind, source] of [
        ["mcp", "mcp"],
        ["integration", "api"],
      ] as const) {
        const { call } = await setup({ kind });
        const created = parseReply(
          rpcBody(
            await call(
              callTool(1, "create_task", {
                title: `Water the ${kind} plant`,
                trigger: everyDays(7, "2026-01-01"),
              }),
            ),
          ).result as never,
        );
        expect(created.isError, created.text).toBe(false);
        const done = parseReply(
          rpcBody(
            await call(callTool(2, "complete_task", { id: created.json.id })),
          ).result as never,
        );
        expect(done.isError, done.text).toBe(false);
        expect(done.json.completion).toMatchObject({ source, by: "Anna" });
      }
    });

    it("reports a tool failure as a tool error, not as an HTTP error", async () => {
      const { call } = await setup();
      const r = await call(callTool(1, "get_task", { id: "missing" }));
      expect(r.res.status).toBe(200);
      const reply = parseReply(rpcBody(r).result as never);
      expect(reply.isError).toBe(true);
      expect(reply.text).toMatch(/\[not_found\]/);
    });

    it("tells a client that is not ready for this protocol to fall back to initialize", async () => {
      const { call } = await setup();
      const r = await call(rpc(1, "tools/list"), {
        headers: { "mcp-protocol-version": "2999-01-01" },
      });
      expect([r.res.status, errorCode(r)]).toEqual([400, "invalid_request"]);
      expect((r.body as { error: { message: string } }).error.message).toMatch(
        /unsupported protocol version/i,
      );
    });
  });

  describe("bad requests", () => {
    it("wants both Accept types", async () => {
      const { call } = await setup();
      const r = await call(initialize, {
        headers: { accept: "application/json" },
      });
      expect([r.res.status, errorCode(r)]).toEqual([406, "invalid_request"]);
      expect((r.body as { error: { message: string } }).error.message).toMatch(
        /text\/event-stream/,
      );
    });

    it("wants a JSON-RPC message in a JSON body", async () => {
      const { call, token } = await setup();
      const notRpc = await call({ hello: "world" });
      expect([notRpc.res.status, errorCode(notRpc)]).toEqual([
        400,
        "invalid_request",
      ]);
      const notJson = await post({
        bearer: token,
        rawBody: "hello",
        headers: { "content-type": "text/plain" },
      });
      expect(notJson.res.status).toBe(415);
      const broken = await post({ bearer: token, rawBody: "{" });
      expect(broken.res.status).toBe(400);
    });
  });

  describe("as an MCP client sees it", () => {
    it("works with the SDK's Streamable HTTP client", async () => {
      const { token } = await setup({ scopes: ["read"] });
      const client = new Client({ name: "test", version: "0.0.0" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(URL_), {
          fetch: createInProcessFetch() as typeof fetch,
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        }),
      );
      try {
        expect(client.getServerVersion()).toMatchObject({ name: "hauswart" });
        const { tools: listed } = await client.listTools();
        expect(listed.map((t) => t.name)).toContain("list_upcoming");
        expect(listed.map((t) => t.name)).not.toContain("create_task");
        const reply = parseReply(
          (await client.callTool({ name: "whoami", arguments: {} })) as never,
        );
        expect(reply.json).toMatchObject({ scopes: ["read"] });
      } finally {
        await client.close();
      }
    });
  });
});
