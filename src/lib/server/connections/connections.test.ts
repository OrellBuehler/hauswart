import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "$lib/api/errors";
import { decryptSecret } from "$lib/server/crypto";
import { connections } from "$lib/server/db";
import { onEvent } from "$lib/server/events";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt, NOW } from "$lib/testing/domain";
import {
  MAX_BACKOFF_MS,
  backoffMs,
  deleteConnection,
  dueForAttempt,
  getConnectionRow,
  listConnectionViews,
  recordConnectionFailure,
  recordConnectionOk,
  resolveConnection,
  runOperation,
  saveConnection,
  testConnection,
} from "./connections";
import { IntegrationError } from "./errors";
import { registerIntegration, type IntegrationAdapter } from "./registry";

const MIN = 60_000;

describe("connections", () => {
  const test = useTestDB();
  const ctx = (offsetMin = 0) => ctxAt(test.db, NOW + offsetMin * MIN);
  const stops: (() => void)[] = [];
  afterEach(() => stops.splice(0).forEach((s) => s()));

  const input = (over = {}) => ({
    baseUrl: "https://home.example.org/",
    token: "secret-token-value",
    allowInsecureTls: false,
    ...over,
  });
  const fieldErrors = (fn: () => unknown) => {
    try {
      fn();
    } catch (err) {
      return (err as ApiError).details as {
        body: { fieldErrors: Record<string, string[]> };
      };
    }
    return null;
  };

  describe("saving", () => {
    it("encrypts the token and normalises the address", () => {
      const row = saveConnection(ctx(), "homeassistant", null, input());
      expect(row.baseUrl).toBe("https://home.example.org");
      expect(row.tokenEnc).not.toContain("secret-token-value");
      expect(decryptSecret(row.tokenEnc)).toBe("secret-token-value");
      expect(row).toMatchObject({
        status: "unknown",
        enabled: true,
        userId: null,
      });
      expect(resolveConnection(row)).toMatchObject({
        token: "secret-token-value",
        baseUrl: "https://home.example.org",
      });
    });

    it("needs a token for a new connection", () => {
      expect(
        fieldErrors(() =>
          saveConnection(ctx(), "homeassistant", null, input({ token: "  " })),
        )?.body.fieldErrors.token,
      ).toBeDefined();
    });

    it("refuses addresses that are not http or https, or carry credentials", () => {
      for (const baseUrl of [
        "ftp://x.example.org",
        "not a url",
        "https://u:p@x.example.org",
      ]) {
        expect(
          fieldErrors(() =>
            saveConnection(ctx(), "homeassistant", null, input({ baseUrl })),
          )?.body.fieldErrors.baseUrl,
          baseUrl,
        ).toBeDefined();
      }
    });

    it("refuses a token with spaces or control characters", () => {
      expect(
        fieldErrors(() =>
          saveConnection(
            ctx(),
            "homeassistant",
            null,
            input({ token: "has space" }),
          ),
        )?.body.fieldErrors.token,
      ).toBeDefined();
    });

    it("keeps the stored token when it is left blank, and resets the status when it changes", () => {
      const first = saveConnection(ctx(), "homeassistant", null, input());
      recordConnectionOk(ctx(1), first.id);
      const kept = saveConnection(
        ctx(2),
        "homeassistant",
        null,
        input({ token: "", allowInsecureTls: true }),
      );
      expect(kept.id).toBe(first.id);
      expect(kept.tokenEnc).toBe(first.tokenEnc);
      expect(kept).toMatchObject({ allowInsecureTls: true, status: "ok" });
      const replaced = saveConnection(
        ctx(3),
        "homeassistant",
        null,
        input({ token: "other-token" }),
      );
      expect(decryptSecret(replaced.tokenEnc)).toBe("other-token");
      expect(replaced).toMatchObject({
        status: "unknown",
        consecutiveFailures: 0,
        lastOkAt: null,
      });
    });

    it("needs the token again when the address changes, so a stored token never goes to another host", () => {
      saveConnection(ctx(), "homeassistant", null, input());
      expect(
        fieldErrors(() =>
          saveConnection(
            ctx(),
            "homeassistant",
            null,
            input({ baseUrl: "https://elsewhere.example.org", token: "" }),
          ),
        )?.body.fieldErrors.token,
      ).toBeDefined();
      const moved = saveConnection(
        ctx(),
        "homeassistant",
        null,
        input({ baseUrl: "https://elsewhere.example.org", token: "new" }),
      );
      expect(moved.baseUrl).toBe("https://elsewhere.example.org");
    });

    it("has one household connection per kind, and one per person for the others", async () => {
      const [a, b] = [await createTestUser(), await createTestUser()];
      const first = saveConnection(ctx(), "homeassistant", null, input());
      const second = saveConnection(
        ctx(),
        "homeassistant",
        null,
        input({ token: "x" }),
      );
      expect(second.id).toBe(first.id);
      expect(test.db.select().from(connections).all()).toHaveLength(1);
      // the database itself refuses a second household row of a kind
      expect(() =>
        test.db
          .insert(connections)
          .values({
            kind: "homeassistant",
            userId: null,
            baseUrl: "https://x.example.org",
            tokenEnc: "v1.x.y",
          })
          .run(),
      ).toThrow(/UNIQUE/);

      const kept = [
        saveConnection(ctx(), "kept", a.id, input()),
        saveConnection(ctx(), "kept", b.id, input()),
      ];
      expect(kept[0].id).not.toBe(kept[1].id);
      expect(getConnectionRow(ctx(), "kept", a.id)?.userId).toBe(a.id);
    });

    it("announces the change", () => {
      const seen: string[] = [];
      const off = onEvent("connectionChanged", ({ kind }) => {
        seen.push(kind);
      });
      saveConnection(ctx(), "homeassistant", null, input());
      deleteConnection(ctx(), "homeassistant", null);
      off();
      expect(seen).toEqual(["homeassistant", "homeassistant"]);
    });

    it("deleting what does not exist is a 404", () => {
      expect(() => deleteConnection(ctx(), "paperless", null)).toThrow(
        ApiError,
      );
    });
  });

  describe("views", () => {
    it("never carry the token, and show addresses of household connections to administrators only", async () => {
      const user = await createTestUser();
      saveConnection(
        ctx(),
        "homeassistant",
        null,
        input({ config: { appUrl: "https://app.example.org" } }),
      );
      saveConnection(
        ctx(),
        "kept",
        user.id,
        input({ baseUrl: "https://kept.example.org" }),
      );
      const asAdmin = listConnectionViews(ctx(), user.id, { isAdmin: true });
      const asMember = listConnectionViews(ctx(), user.id, { isAdmin: false });
      expect(JSON.stringify([asAdmin, asMember])).not.toContain(
        "secret-token-value",
      );
      expect(JSON.stringify([asAdmin, asMember])).not.toContain("tokenEnc");
      const home = (views: typeof asAdmin) =>
        views.find((v) => v.kind === "homeassistant")!;
      expect(home(asAdmin)).toMatchObject({
        configured: true,
        level: "household",
        baseUrl: "https://home.example.org",
        config: { appUrl: "https://app.example.org" },
      });
      expect(home(asMember)).toMatchObject({
        configured: true,
        baseUrl: null,
        config: {},
      });
      expect(asMember.find((v) => v.kind === "kept")).toMatchObject({
        level: "user",
        baseUrl: "https://kept.example.org",
      });
      expect(asMember.find((v) => v.kind === "paperless")).toMatchObject({
        configured: false,
        status: "unknown",
      });
    });

    it("a person sees their own connection of a per-person kind, not another's", async () => {
      const [a, b] = [await createTestUser(), await createTestUser()];
      saveConnection(
        ctx(),
        "kept",
        a.id,
        input({ baseUrl: "https://a.example.org" }),
      );
      const views = listConnectionViews(ctx(), b.id, { isAdmin: false });
      expect(views.find((v) => v.kind === "kept")).toMatchObject({
        configured: false,
        baseUrl: null,
      });
    });
  });

  describe("health and backoff", () => {
    it("doubles from a minute up to fifteen", () => {
      expect([1, 2, 3, 4, 5, 6, 7, 20].map((n) => backoffMs(n))).toEqual([
        MIN,
        2 * MIN,
        4 * MIN,
        8 * MIN,
        15 * MIN,
        15 * MIN,
        15 * MIN,
        MAX_BACKOFF_MS,
      ]);
      expect(backoffMs(0)).toBe(0);
    });

    it("records failures and recovery on the connection", () => {
      const row = saveConnection(ctx(), "homeassistant", null, input());
      const failures = recordConnectionFailure(ctx(1), row, "timeout");
      expect(failures).toBe(1);
      let now = getConnectionRow(ctx(), "homeassistant", null)!;
      expect(now).toMatchObject({
        status: "error",
        lastError: "timeout",
        consecutiveFailures: 1,
      });
      recordConnectionFailure(ctx(2), now, "tls");
      now = getConnectionRow(ctx(), "homeassistant", null)!;
      expect(now).toMatchObject({ lastError: "tls", consecutiveFailures: 2 });
      recordConnectionOk(ctx(3), row.id);
      now = getConnectionRow(ctx(), "homeassistant", null)!;
      expect(now).toMatchObject({
        status: "ok",
        lastError: null,
        consecutiveFailures: 0,
      });
      expect(now.lastOkAt?.getTime()).toBe(NOW + 3 * MIN);
    });

    it("waits out the backoff before trying again", () => {
      const row = { consecutiveFailures: 3, lastCheckedAt: new Date(NOW) };
      expect(dueForAttempt(row, NOW + 3 * MIN)).toBe(false);
      expect(dueForAttempt(row, NOW + 4 * MIN)).toBe(true);
      expect(
        dueForAttempt(
          { consecutiveFailures: 0, lastCheckedAt: new Date(NOW) },
          NOW,
        ),
      ).toBe(true);
      expect(
        dueForAttempt({ consecutiveFailures: 5, lastCheckedAt: null }, NOW),
      ).toBe(true);
    });
  });

  describe("testing and operations", () => {
    const adapter = (
      over: Partial<IntegrationAdapter> = {},
    ): IntegrationAdapter => ({
      kind: "homeassistant",
      test: async () => ({ ok: true, info: { version: "1" } }),
      describe: () => ({ capabilities: ["things"] }),
      operations: { things: async () => ({ items: [1] }) },
      ...over,
    });

    it("records the result of a test as the connection's health", async () => {
      stops.push(registerIntegration(adapter()));
      saveConnection(ctx(), "homeassistant", null, input());
      const ok = await testConnection(ctx(1), "homeassistant", null, {
        showAddress: true,
      });
      expect(ok.result).toEqual({ ok: true, info: { version: "1" } });
      expect(ok.view).toMatchObject({
        status: "ok",
        lastError: null,
        capabilities: ["things"],
      });

      stops.push(
        registerIntegration(
          adapter({
            test: async () => ({
              ok: false,
              error: { code: "unauthorized", message: "no" },
            }),
          }),
        ),
      );
      const bad = await testConnection(ctx(2), "homeassistant", null, {
        showAddress: true,
      });
      expect(bad.view).toMatchObject({
        status: "error",
        lastError: "unauthorized",
        consecutiveFailures: 1,
      });
    });

    it("turns an adapter that throws an IntegrationError into a failed test", async () => {
      stops.push(
        registerIntegration(
          adapter({
            test: async () => {
              throw new IntegrationError("token_unreadable", "unreadable");
            },
          }),
        ),
      );
      saveConnection(ctx(), "homeassistant", null, input());
      const bad = await testConnection(ctx(), "homeassistant", null, {
        showAddress: true,
      });
      expect(bad.result.error).toEqual({
        code: "token_unreadable",
        message: "unreadable",
      });
    });

    it("404 without an adapter, a connection, or a switched-on connection", async () => {
      saveConnection(ctx(), "homeassistant", null, input());
      await expect(
        testConnection(ctx(), "homeassistant", null, { showAddress: true }),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        runOperation(ctx(), "homeassistant", null, "things", {}),
      ).rejects.toMatchObject({ code: "not_found" });
      stops.push(registerIntegration(adapter()));
      await expect(
        runOperation(ctx(), "homeassistant", null, "other", {}),
      ).rejects.toMatchObject({ code: "not_found" });
      saveConnection(
        ctx(),
        "homeassistant",
        null,
        input({ enabled: false, token: "" }),
      );
      await expect(
        runOperation(ctx(), "homeassistant", null, "things", {}),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        runOperation(ctx(), "paperless", null, "things", {}),
      ).rejects.toMatchObject({ code: "not_found" });
    });

    it("runs an operation and maps an adapter failure to upstream_error with the code", async () => {
      stops.push(
        registerIntegration(
          adapter({
            operations: {
              things: async (_c, query) => ({ echoed: query }),
              broken: async () => {
                throw new IntegrationError("timeout", "did not answer");
              },
              crash: async () => {
                throw new TypeError("bug");
              },
            },
          }),
        ),
      );
      saveConnection(ctx(), "homeassistant", null, input());
      expect(
        await runOperation(ctx(), "homeassistant", null, "things", { q: "x" }),
      ).toEqual({ echoed: { q: "x" } });
      await expect(
        runOperation(ctx(), "homeassistant", null, "broken", {}),
      ).rejects.toMatchObject({
        code: "upstream_error",
        status: 502,
        details: { code: "timeout" },
      });
      await expect(
        runOperation(ctx(), "homeassistant", null, "crash", {}),
      ).rejects.toBeInstanceOf(TypeError);
    });
  });
});
