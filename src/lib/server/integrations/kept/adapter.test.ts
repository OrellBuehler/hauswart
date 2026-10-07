import { setLenientHostPolicy } from "$lib/server/net/host-policy";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerIntegration } from "$lib/server/connections/registry";
import { IntegrationError } from "$lib/server/connections/errors";
import {
  resolveConnection,
  getConnectionRow,
} from "$lib/server/connections/connections";
import { createCaller, errorCode } from "$lib/testing/api";
import { createTestUser, loginTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { allowIntegrationHosts } from "$lib/testing/integrations";
import { keptIntegration, validateInput } from "./adapter";
import { fakeAccount, fakeCategory } from "./fake-server";
import { useFakeKept } from "./testing";

describe("Kept adapter settings", () => {
  const test = useTestDB();
  const { fake, connect } = useFakeKept();
  let unregister = () => {};
  beforeEach(() => {
    unregister = registerIntegration(keptIntegration);
  });
  afterEach(() => unregister());

  describe("validate", () => {
    it("normalises the address and fills the defaults", () => {
      expect(
        validateInput({ baseUrl: "https://finance.example.org/", config: {} }),
      ).toEqual({
        baseUrl: "https://finance.example.org",
        config: {
          categoryMap: {},
          purchaseCategoryIds: [],
          autoAcceptCategoryIds: [],
          billTasks: false,
          billCreditorFilter: [],
          assignBillTasksTo: "owner",
        },
      });
    });

    it("keeps the settings and drops what it does not know", () => {
      const out = validateInput({
        baseUrl: "https://finance.example.org",
        config: {
          categoryMap: { "cat-1": "repair", "cat-2": "utilities" },
          purchaseCategoryIds: ["cat-3", "cat-3"],
          autoAcceptCategoryIds: ["cat-2"],
          billTasks: true,
          billCreditorFilter: ["Muster Verwaltung AG"],
          billCostCategory: "other",
          syncFrom: "2026-01-01",
          somethingElse: "dropped",
        },
      });
      expect(out.config).toEqual({
        categoryMap: { "cat-1": "repair", "cat-2": "utilities" },
        purchaseCategoryIds: ["cat-3"],
        autoAcceptCategoryIds: ["cat-2"],
        billTasks: true,
        billCreditorFilter: ["Muster Verwaltung AG"],
        billCostCategory: "other",
        assignBillTasksTo: "owner",
        syncFrom: "2026-01-01",
      });
    });

    it.each([
      ["a bad address", { baseUrl: "ftp://x", config: {} }],
      [
        "an unknown cost category",
        {
          baseUrl: "https://f.example.org",
          config: { categoryMap: { c: "luxury" } },
        },
      ],
      [
        "auto-accept outside the map",
        {
          baseUrl: "https://f.example.org",
          config: {
            categoryMap: { c: "repair" },
            autoAcceptCategoryIds: ["d"],
          },
        },
      ],
      [
        "a bill task assignee other than the owner",
        {
          baseUrl: "https://f.example.org",
          config: { assignBillTasksTo: "everyone" },
        },
      ],
      [
        "a bad start date",
        { baseUrl: "https://f.example.org", config: { syncFrom: "yesterday" } },
      ],
      [
        "a non-boolean switch",
        { baseUrl: "https://f.example.org", config: { billTasks: "yes" } },
      ],
      [
        "an empty creditor",
        {
          baseUrl: "https://f.example.org",
          config: { billCreditorFilter: [" "] },
        },
      ],
    ])("rejects %s", (_name, input) => {
      expect(() => validateInput(input)).toThrow(IntegrationError);
    });
  });

  describe("test", () => {
    async function connection(over = {}) {
      const user = await createTestUser();
      return resolveConnection(connect(user.id, over));
    }

    it("reports a working connection and the scopes it holds", async () => {
      const result = await keptIntegration.test(await connection());
      expect(result).toMatchObject({
        ok: true,
        info: {
          defaultCurrency: "CHF",
          missingScopes: "",
          categoryRestricted: false,
        },
      });
      expect(result.info?.scopes).toContain("transactions:read");
    });

    it("says whether links back to hauswart can be written (the app address is known)", async () => {
      const previous = process.env.ORIGIN;
      try {
        process.env.ORIGIN = "https://hauswart.example.org";
        expect(
          (await keptIntegration.test(await connection())).info?.backLinks,
        ).toBe(true);
        delete process.env.ORIGIN;
        expect(
          (await keptIntegration.test(await connection())).info?.backLinks,
        ).toBe(false);
      } finally {
        if (previous === undefined) delete process.env.ORIGIN;
        else process.env.ORIGIN = previous;
      }
    });

    it("warns about missing scopes by name", async () => {
      fake.setToken({ scopes: ["accounts:read", "categories:read"] });
      const result = await keptIntegration.test(await connection());
      expect(result.ok).toBe(true);
      expect(result.info?.missingScopes).toBe(
        "transactions:read,bills:read,links:write",
      );
    });

    it("says when the token is limited to categories", async () => {
      fake.setToken({ categoryIds: ["cat-1"] });
      expect(
        (await keptIntegration.test(await connection())).info
          ?.categoryRestricted,
      ).toBe(true);
    });

    it("fails with a code and a safe message for a rejected token or an unreachable system", async () => {
      const rejected = await keptIntegration.test(
        await connection({ token: "kept_wrong-token" }),
      );
      expect(rejected).toMatchObject({
        ok: false,
        error: { code: "unauthorized" },
      });
      expect(JSON.stringify(rejected)).not.toContain("kept_wrong-token");
      const closed = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: () => new Response(),
      });
      const baseUrl = `http://127.0.0.1:${closed.port}`;
      await closed.stop(true);
      const unreachable = await keptIntegration.test(
        await connection({ baseUrl }),
      );
      expect(unreachable.ok).toBe(false);
      expect(unreachable.error?.code).toMatch(/network|timeout/);
    });
  });

  describe("pickers", () => {
    it("lists categories and accounts of the person's own connection", async () => {
      fake.categories = [
        fakeCategory({ id: "cat-b", name: "Wohnen" }),
        fakeCategory({ id: "cat-a", name: "Auto", kind: "expense" }),
      ];
      fake.accounts = [fakeAccount({ id: "acc-1", name: "Alltag" })];
      const user = await createTestUser();
      connect(user.id);
      const call = createCaller({ session: loginTestUser(user).token });
      const categories = await call(
        "GET",
        "/api/v1/integrations/kept/categories",
      );
      expect(categories.res.status).toBe(200);
      expect(categories.body).toEqual({
        items: [
          { id: "cat-a", name: "Auto", parentId: null, kind: "expense" },
          { id: "cat-b", name: "Wohnen", parentId: null, kind: "expense" },
        ],
      });
      const accounts = await call("GET", "/api/v1/integrations/kept/accounts");
      expect(accounts.body).toEqual({
        items: [
          {
            id: "acc-1",
            name: "Alltag",
            currency: "CHF",
            type: "current",
            archived: false,
          },
        ],
      });
    });

    it("are not available to somebody without their own connection", async () => {
      fake.categories = [fakeCategory({ name: "Geheim" })];
      const anna = await createTestUser();
      const ben = await createTestUser();
      connect(anna.id);
      const call = createCaller({ session: loginTestUser(ben).token });
      for (const path of ["categories", "accounts"]) {
        const r = await call("GET", `/api/v1/integrations/kept/${path}`);
        expect(r.res.status).toBe(404);
        expect(JSON.stringify(r.body)).not.toContain("Geheim");
      }
      expect(fake.requests).toEqual([]);
    });

    it("answer 502 with the provider's code when it refuses", async () => {
      const user = await createTestUser();
      connect(user.id, { token: "kept_wrong-token" });
      const call = createCaller({ session: loginTestUser(user).token });
      const r = await call("GET", "/api/v1/integrations/kept/categories");
      expect(r.res.status).toBe(502);
      expect(errorCode(r)).toBe("upstream_error");
      expect(r.body).toMatchObject({
        error: { details: { code: "unauthorized" } },
      });
    });

    it("are not offered for a kind that has no such operation", async () => {
      const user = await createTestUser();
      const call = createCaller({ session: loginTestUser(user).token });
      expect(
        (await call("GET", "/api/v1/integrations/homeassistant/categories")).res
          .status,
      ).toBe(404);
    });
  });

  describe("addresses", () => {
    it("a member's connection to loopback is not called, an administrator's is", async () => {
      setLenientHostPolicy(false);
      const admin = await createTestUser({ role: "admin" });
      const member = await createTestUser();
      connect(admin.id);
      connect(member.id);
      const url = "/api/v1/integrations/kept/test";
      const asMember = createCaller({ session: loginTestUser(member).token });
      const asAdmin = createCaller({ session: loginTestUser(admin).token });
      expect((await asMember("POST", url)).body).toMatchObject({
        ok: false,
        error: { code: "blocked_host" },
      });
      expect(fake.requests).toEqual([]);
      expect((await asAdmin("POST", url)).body).toMatchObject({ ok: true });
    });
  });

  describe("saving through the API", () => {
    it("validates the settings, keeps them per person and hides the token", async () => {
      const anna = await createTestUser();
      const ben = await createTestUser();
      const callA = createCaller({ session: loginTestUser(anna).token });
      const callB = createCaller({ session: loginTestUser(ben).token });
      allowIntegrationHosts(test.db, "127.0.0.1");
      const bad = await callA("PUT", "/api/v1/integrations/kept", {
        json: {
          baseUrl: fake.baseUrl,
          token: fake.token,
          config: { categoryMap: { c: "luxury" } },
        },
      });
      expect(bad.res.status).toBe(400);
      const ok = await callA("PUT", "/api/v1/integrations/kept", {
        json: {
          baseUrl: fake.baseUrl,
          token: fake.token,
          config: { categoryMap: { "cat-1": "repair" }, billTasks: true },
        },
      });
      expect(ok.res.status).toBe(200);
      expect(JSON.stringify(ok.body)).not.toContain(fake.token);
      expect(ok.body).toMatchObject({
        kind: "kept",
        level: "user",
        available: true,
        config: { categoryMap: { "cat-1": "repair" }, billTasks: true },
      });
      const others = (await callB("GET", "/api/v1/integrations")).body as {
        items: { kind: string; configured: boolean; config: object }[];
      };
      expect(others.items.find((i) => i.kind === "kept")).toMatchObject({
        configured: false,
        config: {},
      });
      expect(getConnectionRow({ db: test.db }, "kept", ben.id)).toBeUndefined();
    });
  });
});
