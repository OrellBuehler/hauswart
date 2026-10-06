import { afterEach, describe, expect, it } from "vitest";
import { connections, getDB } from "$lib/server/db";
import { IntegrationError } from "$lib/server/connections/errors";
import {
  registerIntegration,
  type IntegrationAdapter,
} from "$lib/server/connections/registry";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";

interface View {
  kind: string;
  level: string;
  available: boolean;
  capabilities: string[];
  configured: boolean;
  enabled: boolean;
  baseUrl: string | null;
  allowInsecureTls: boolean;
  config: Record<string, unknown>;
  status: string;
  lastError: string | null;
}

const SECRET = "very-secret-token-value";

describe("integrations API", () => {
  useTestDB();
  const stops: (() => void)[] = [];
  afterEach(() => stops.splice(0).forEach((s) => s()));

  async function people() {
    const admin = await createTestUser({ role: "admin" });
    const member = await createTestUser();
    const other = await createTestUser();
    const as = (u: typeof admin) =>
      createCaller({ session: loginTestUser(u).token });
    return {
      admin,
      member,
      other,
      asAdmin: as(admin),
      asMember: as(member),
      asOther: as(other),
    };
  }

  const adapter = (over: Partial<IntegrationAdapter> = {}) =>
    registerIntegration({
      kind: "homeassistant",
      test: async () => ({ ok: true, info: { version: "9" } }),
      describe: () => ({
        capabilities: ["entities", "notify-services", "calendars", "devices"],
      }),
      operations: {
        entities: async (_c, q) => ({ items: [], total: 0, echoed: q }),
        "notify-services": async () => ({
          items: ["mobile_app_example_phone"],
        }),
        calendars: async () => ({
          items: [{ id: "calendar.example", name: "Example" }],
        }),
        devices: async () => {
          throw new IntegrationError("timeout", "Home did not answer in time.");
        },
      },
      ...over,
    });

  const body = (over = {}) => ({
    baseUrl: "https://home.example.org",
    token: SECRET,
    allowInsecureTls: false,
    ...over,
  });

  it("lists every kind, with the address shown to administrators only", async () => {
    stops.push(adapter());
    const { asAdmin, asMember } = await people();
    expect(
      (
        await asAdmin("PUT", "/api/v1/integrations/homeassistant", {
          json: body(),
        })
      ).res.status,
    ).toBe(200);

    const admin = await asAdmin("GET", "/api/v1/integrations");
    const items = (admin.body as { items: View[] }).items;
    expect(items.map((i) => i.kind)).toEqual([
      "homeassistant",
      "paperless",
      "kept",
    ]);
    expect(items[0]).toMatchObject({
      configured: true,
      baseUrl: "https://home.example.org",
      available: true,
      level: "household",
      status: "unknown",
    });
    expect(items[1]).toMatchObject({ configured: false, available: false });

    const member = await asMember("GET", "/api/v1/integrations");
    expect((member.body as { items: View[] }).items[0]).toMatchObject({
      configured: true,
      baseUrl: null,
      config: {},
    });
    expect(JSON.stringify([admin.body, member.body])).not.toContain(SECRET);
  });

  describe("household-level connections", () => {
    it("are changed by administrators only", async () => {
      const { asAdmin, asMember } = await people();
      const denied = await asMember(
        "PUT",
        "/api/v1/integrations/homeassistant",
        { json: body() },
      );
      expect([denied.res.status, errorCode(denied)]).toEqual([
        403,
        "forbidden",
      ]);
      expect(
        (await asMember("DELETE", "/api/v1/integrations/homeassistant")).res
          .status,
      ).toBe(403);
      expect(
        (await asMember("POST", "/api/v1/integrations/homeassistant/test")).res
          .status,
      ).toBe(403);
      const ok = await asAdmin("PUT", "/api/v1/integrations/homeassistant", {
        json: body(),
      });
      expect(ok.res.status).toBe(200);
      expect(ok.body).toMatchObject({
        kind: "homeassistant",
        configured: true,
        enabled: true,
      });
      expect(JSON.stringify(ok.body)).not.toContain(SECRET);
    });

    it("an administrator's token with the admin scope works, a member's cannot carry it", async () => {
      const admin = await createTestUser({ role: "admin" });
      const member = await createTestUser();
      const withToken = (
        u: typeof admin,
        scopes: ("read" | "write" | "admin")[],
      ) =>
        createCaller({
          bearer: createTestToken(u, { scopes, kind: "integration" }).token,
        });
      expect(
        (
          await withToken(admin, ["write", "admin"])(
            "PUT",
            "/api/v1/integrations/homeassistant",
            { json: body() },
          )
        ).res.status,
      ).toBe(200);
      expect(
        (
          await withToken(member, ["write", "admin"])(
            "PUT",
            "/api/v1/integrations/homeassistant",
            { json: body() },
          )
        ).res.status,
      ).toBe(403);
      expect(
        (
          await withToken(admin, ["write"])(
            "DELETE",
            "/api/v1/integrations/homeassistant",
          )
        ).res.status,
      ).toBe(403);
    });

    it("stores the token encrypted and never returns it", async () => {
      const { asAdmin } = await people();
      await asAdmin("PUT", "/api/v1/integrations/homeassistant", {
        json: body(),
      });
      const stored = getDB().select().from(connections).all();
      expect(stored).toHaveLength(1);
      expect(stored[0].tokenEnc).not.toContain(SECRET);
      const again = await asAdmin("PUT", "/api/v1/integrations/homeassistant", {
        json: body({ token: undefined, allowInsecureTls: true }),
      });
      expect(again.res.status).toBe(200);
      expect(again.body).toMatchObject({ allowInsecureTls: true });
      expect(getDB().select().from(connections).get()?.tokenEnc).toBe(
        stored[0].tokenEnc,
      );
    });

    it("validates the body: strict, a token for a new connection and for a changed address", async () => {
      const { asAdmin } = await people();
      const missing = await asAdmin(
        "PUT",
        "/api/v1/integrations/homeassistant",
        { json: body({ token: undefined }) },
      );
      expect([missing.res.status, errorCode(missing)]).toEqual([
        400,
        "invalid_request",
      ]);
      expect(
        (
          await asAdmin("PUT", "/api/v1/integrations/homeassistant", {
            json: body({ extra: 1 }),
          })
        ).res.status,
      ).toBe(400);
      expect(
        (
          await asAdmin("PUT", "/api/v1/integrations/homeassistant", {
            json: body({ baseUrl: "ftp://x" }),
          })
        ).res.status,
      ).toBe(400);
      expect(
        (
          await asAdmin("PUT", "/api/v1/integrations/homeassistant", {
            json: body({ token: "bad token" }),
          })
        ).res.status,
      ).toBe(400);
      await asAdmin("PUT", "/api/v1/integrations/homeassistant", {
        json: body(),
      });
      const moved = await asAdmin("PUT", "/api/v1/integrations/homeassistant", {
        json: body({ baseUrl: "https://other.example.org", token: undefined }),
      });
      expect(moved.res.status).toBe(400);
    });

    it("an unknown kind is a 400", async () => {
      const { asAdmin } = await people();
      expect(
        (
          await asAdmin("PUT", "/api/v1/integrations/nonsense", {
            json: body(),
          })
        ).res.status,
      ).toBe(400);
      expect(
        (await asAdmin("GET", "/api/v1/integrations/nonsense/entities")).res
          .status,
      ).toBe(400);
    });

    it("can be removed, and then there is nothing to remove", async () => {
      const { asAdmin } = await people();
      await asAdmin("PUT", "/api/v1/integrations/homeassistant", {
        json: body(),
      });
      expect(
        (await asAdmin("DELETE", "/api/v1/integrations/homeassistant")).res
          .status,
      ).toBe(204);
      const again = await asAdmin(
        "DELETE",
        "/api/v1/integrations/homeassistant",
      );
      expect([again.res.status, errorCode(again)]).toEqual([404, "not_found"]);
    });
  });

  describe("per-person connections", () => {
    it("every member manages their own and never sees another's", async () => {
      const { asMember, asOther } = await people();
      const saved = await asMember("PUT", "/api/v1/integrations/kept", {
        json: body({ baseUrl: "https://kept.example.org" }),
      });
      expect(saved.res.status).toBe(200);
      const mine = (await asMember("GET", "/api/v1/integrations")).body as {
        items: View[];
      };
      expect(mine.items.find((i) => i.kind === "kept")).toMatchObject({
        configured: true,
        baseUrl: "https://kept.example.org",
      });
      const theirs = (await asOther("GET", "/api/v1/integrations")).body as {
        items: View[];
      };
      expect(theirs.items.find((i) => i.kind === "kept")).toMatchObject({
        configured: false,
        baseUrl: null,
      });
      const denied = await asOther("DELETE", "/api/v1/integrations/kept");
      expect([denied.res.status, errorCode(denied)]).toEqual([
        404,
        "not_found",
      ]);
      expect(
        (await asMember("DELETE", "/api/v1/integrations/kept")).res.status,
      ).toBe(204);
    });
  });

  describe("test", () => {
    it("reports a working connection and records it", async () => {
      stops.push(adapter());
      const { asAdmin } = await people();
      await asAdmin("PUT", "/api/v1/integrations/homeassistant", {
        json: body(),
      });
      const r = await asAdmin(
        "POST",
        "/api/v1/integrations/homeassistant/test",
      );
      expect(r.res.status).toBe(200);
      expect(r.body).toMatchObject({
        ok: true,
        error: null,
        info: { version: "9" },
        integration: { status: "ok", lastError: null },
      });
    });

    it("reports a failure as a normal answer with the error code", async () => {
      stops.push(
        adapter({
          test: async () => ({
            ok: false,
            error: { code: "unauthorized", message: "Rejected the token." },
          }),
        }),
      );
      const { asAdmin } = await people();
      await asAdmin("PUT", "/api/v1/integrations/homeassistant", {
        json: body(),
      });
      const r = await asAdmin(
        "POST",
        "/api/v1/integrations/homeassistant/test",
      );
      expect(r.res.status).toBe(200);
      expect(r.body).toMatchObject({
        ok: false,
        error: { code: "unauthorized" },
        integration: {
          status: "error",
          lastError: "unauthorized",
          consecutiveFailures: 1,
        },
      });
    });

    it("is 404 without a connection or an adapter", async () => {
      const { asAdmin } = await people();
      expect(
        (await asAdmin("POST", "/api/v1/integrations/homeassistant/test")).res
          .status,
      ).toBe(404);
      await asAdmin("PUT", "/api/v1/integrations/homeassistant", {
        json: body(),
      });
      expect(
        (await asAdmin("POST", "/api/v1/integrations/homeassistant/test")).res
          .status,
      ).toBe(404);
    });
  });

  describe("pickers", () => {
    it("are open to every member and pass the query on", async () => {
      stops.push(adapter());
      const { asAdmin, asMember } = await people();
      await asAdmin("PUT", "/api/v1/integrations/homeassistant", {
        json: body(),
      });
      const entities = await asMember(
        "GET",
        "/api/v1/integrations/homeassistant/entities?q=wash&domain=sensor&limit=5",
      );
      expect(entities.res.status).toBe(200);
      expect(entities.body).toMatchObject({
        echoed: { q: "wash", domain: "sensor", limit: "5" },
      });
      expect(
        (
          await asMember(
            "GET",
            "/api/v1/integrations/homeassistant/notify-services",
          )
        ).body,
      ).toEqual({
        items: ["mobile_app_example_phone"],
      });
      expect(
        (await asMember("GET", "/api/v1/integrations/homeassistant/calendars"))
          .body,
      ).toEqual({
        items: [{ id: "calendar.example", name: "Example" }],
      });
    });

    it("validate the query", async () => {
      stops.push(adapter());
      const { asAdmin } = await people();
      await asAdmin("PUT", "/api/v1/integrations/homeassistant", {
        json: body(),
      });
      for (const q of ["limit=0", "limit=500", "domain=Bad Domain", "q="]) {
        expect(
          (
            await asAdmin(
              "GET",
              `/api/v1/integrations/homeassistant/entities?${q}`,
            )
          ).res.status,
          q,
        ).toBe(400);
      }
    });

    it("answer 404 when nothing is connected, and 502 with the code when the system fails", async () => {
      stops.push(adapter());
      const { asAdmin, asMember } = await people();
      const none = await asMember(
        "GET",
        "/api/v1/integrations/homeassistant/entities",
      );
      expect([none.res.status, errorCode(none)]).toEqual([404, "not_found"]);
      await asAdmin("PUT", "/api/v1/integrations/homeassistant", {
        json: body(),
      });
      const failed = await asMember(
        "GET",
        "/api/v1/integrations/homeassistant/devices",
      );
      expect([failed.res.status, errorCode(failed)]).toEqual([
        502,
        "upstream_error",
      ]);
      expect(failed.body).toMatchObject({
        error: {
          details: { code: "timeout" },
          message: "Home did not answer in time.",
        },
      });
    });

    it("are not available for kinds without an adapter", async () => {
      const { asAdmin } = await people();
      expect(
        (await asAdmin("GET", "/api/v1/integrations/paperless/calendars")).res
          .status,
      ).toBe(404);
    });
  });
});
