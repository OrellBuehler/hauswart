import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAsset } from "$lib/server/assets/assets";
import { registerIntegration } from "$lib/server/connections/registry";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import { createCaller, errorCode } from "$lib/testing/api";
import { createTestUser, loginTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt, NOW } from "$lib/testing/domain";
import {
  appUrlOf,
  clearEntityCache,
  deviceIsKnown,
  homeAssistantIntegration,
  validateInput,
} from "./adapter";
import { useFakeHomeAssistant } from "./testing";

describe("Home Assistant integration (settings API against the fake server)", () => {
  const test = useTestDB();
  const { fake } = useFakeHomeAssistant();
  const stops: (() => void)[] = [];
  beforeEach(() => {
    clearEntityCache();
    stops.push(registerIntegration(homeAssistantIntegration));
  });
  afterEach(() => {
    stops.splice(0).forEach((s) => s());
    vi.restoreAllMocks();
  });

  async function session(role: "admin" | "member" = "admin") {
    const user = await createTestUser({ role });
    return createCaller({ session: loginTestUser(user).token });
  }
  const save = (call: Awaited<ReturnType<typeof session>>, over = {}) =>
    call("PUT", "/api/v1/integrations/homeassistant", {
      json: {
        baseUrl: fake.baseUrl,
        token: fake.token,
        allowInsecureTls: false,
        ...over,
      },
    });

  describe("saving and testing", () => {
    it("normalises the address, keeps only known settings and checks the app address", async () => {
      const admin = await session();
      const ok = await save(admin, {
        baseUrl: `${fake.baseUrl}/`,
        config: { appUrl: "https://app.example.org/", junk: 1 },
      });
      expect(ok.res.status).toBe(200);
      expect(ok.body).toMatchObject({
        baseUrl: fake.baseUrl,
        config: { appUrl: "https://app.example.org" },
        available: true,
        capabilities: ["entities", "notify-services", "calendars", "devices"],
      });
      const bad = await save(admin, {
        config: { appUrl: "ftp://app.example.org" },
      });
      expect([bad.res.status, errorCode(bad)]).toEqual([
        400,
        "invalid_request",
      ]);
      expect(
        (await save(admin, { baseUrl: "https://user:pw@home.example.org" })).res
          .status,
      ).toBe(400);
      expect((await save(admin, { baseUrl: "nope" })).res.status).toBe(400);
    });

    it("a successful test shows version and records the connection as ok", async () => {
      const admin = await session();
      await save(admin);
      const r = await admin("POST", "/api/v1/integrations/homeassistant/test");
      expect(r.body).toMatchObject({
        ok: true,
        error: null,
        info: {
          version: "2026.1.0",
          timeZone: "Europe/Zurich",
          locationName: "Example Home",
        },
        integration: { status: "ok", lastError: null, consecutiveFailures: 0 },
      });
      expect(JSON.stringify(r.body)).not.toContain("12.3456");
    });

    it.each([
      ["a rejected token", () => undefined, { token: "wrong" }, "unauthorized"],
      ["a redirect", () => (fake.redirectAll = true), {}, "redirect"],
      ["a server error", () => fake.failNext("/api/config", 500), {}, "server"],
      [
        "missing permission",
        () => fake.failNext("/api/config", 403),
        {},
        "forbidden",
      ],
    ])("maps %s to the code %s", async (_name, arrange, over, code) => {
      const admin = await session();
      await save(admin, over);
      arrange();
      const r = await admin("POST", "/api/v1/integrations/homeassistant/test");
      expect(r.res.status).toBe(200);
      expect(r.body).toMatchObject({
        ok: false,
        error: { code },
        integration: { status: "error", lastError: code },
      });
      expect(
        (r.body as { error: { message: string } }).error.message.length,
      ).toBeGreaterThan(5);
    });

    it("an unreachable server is a network error, and the message never contains the address or token", async () => {
      const admin = await session();
      const closed = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: () => new Response(),
      });
      const url = `http://127.0.0.1:${closed.port}`;
      await closed.stop(true);
      await save(admin, { baseUrl: url, token: "super-secret" });
      const r = await admin("POST", "/api/v1/integrations/homeassistant/test");
      expect(r.body).toMatchObject({ ok: false, error: { code: "network" } });
      expect(JSON.stringify(r.body)).not.toContain("super-secret");
      expect(
        (r.body as { error: { message: string } }).error.message,
      ).not.toContain("127.0.0.1");
    });

    it("a malformed answer is invalid_response", async () => {
      const admin = await session();
      await save(admin);
      fake.version = "";
      const r = await admin("POST", "/api/v1/integrations/homeassistant/test");
      expect(r.body).toMatchObject({
        ok: false,
        error: { code: "invalid_response" },
      });
    });
  });

  describe("entity picker", () => {
    async function connected() {
      const admin = await session();
      await save(admin);
      return admin;
    }
    const seed = () => {
      fake.setState("sensor.example_washer_cycles", "42", {
        friendly_name: "Washer cycles",
        unit_of_measurement: "cycles",
      });
      fake.setState("sensor.example_boiler_temp", "55.5", {
        friendly_name: "Boiler",
        unit_of_measurement: "°C",
      });
      fake.setState("binary_sensor.example_door", "off", {
        friendly_name: "Front door",
      });
      fake.setState("light.example_lamp", "on");
    };

    it("lists id, name, state, unit and area, sorted, and filters by text and domain", async () => {
      const call = await connected();
      seed();
      fake.areas = [{ area_id: "kitchen", name: "Kitchen", floor_id: null }];
      fake.devices = [
        {
          id: "dev1",
          name: "Washer",
          name_by_user: null,
          manufacturer: "Examplewerk",
          model: "W-1",
          area_id: "kitchen",
          disabled_by: null,
        },
      ];
      fake.entityRegistry = [
        {
          entity_id: "sensor.example_washer_cycles",
          name: null,
          original_name: "Cycles",
          platform: "x",
          device_id: "dev1",
          area_id: null,
          disabled_by: null,
          hidden_by: null,
        },
        {
          entity_id: "light.example_lamp",
          name: null,
          original_name: null,
          platform: "x",
          device_id: null,
          area_id: "kitchen",
          disabled_by: null,
          hidden_by: null,
        },
      ];
      const all = await call(
        "GET",
        "/api/v1/integrations/homeassistant/entities",
      );
      expect(all.res.status).toBe(200);
      expect(
        (all.body as { items: { id: string }[] }).items.map((e) => e.id),
      ).toEqual([
        "binary_sensor.example_door",
        "light.example_lamp",
        "sensor.example_boiler_temp",
        "sensor.example_washer_cycles",
      ]);
      expect((all.body as { total: number }).total).toBe(4);
      const washer = (
        all.body as { items: Record<string, unknown>[] }
      ).items.find((e) => e.id === "sensor.example_washer_cycles");
      expect(washer).toEqual({
        id: "sensor.example_washer_cycles",
        domain: "sensor",
        name: "Washer cycles",
        state: "42",
        unit: "cycles",
        area: "Kitchen", // through the device
      });
      const lamp = (
        all.body as { items: Record<string, unknown>[] }
      ).items.find((e) => e.id === "light.example_lamp");
      expect(lamp).toMatchObject({
        name: "light.example_lamp",
        unit: null,
        area: "Kitchen",
      });

      const q = await call(
        "GET",
        "/api/v1/integrations/homeassistant/entities?q=BOILER",
      );
      expect(
        (q.body as { items: { id: string }[] }).items.map((e) => e.id),
      ).toEqual(["sensor.example_boiler_temp"]);
      const byName = await call(
        "GET",
        "/api/v1/integrations/homeassistant/entities?q=front",
      );
      expect(
        (byName.body as { items: { id: string }[] }).items.map((e) => e.id),
      ).toEqual(["binary_sensor.example_door"]);
      const domain = await call(
        "GET",
        "/api/v1/integrations/homeassistant/entities?domain=sensor",
      );
      expect((domain.body as { total: number }).total).toBe(2);
      const limited = await call(
        "GET",
        "/api/v1/integrations/homeassistant/entities?limit=1",
      );
      expect(limited.body).toMatchObject({ total: 4 });
      expect((limited.body as { items: unknown[] }).items).toHaveLength(1);
    });

    it("still lists entities when the registries cannot be read, and uses a short cache", async () => {
      const call = await connected();
      seed();
      vi.spyOn(console, "warn").mockImplementation(() => {});
      fake.wsMode = "command-error";
      const r = await call(
        "GET",
        "/api/v1/integrations/homeassistant/entities",
      );
      expect(r.res.status).toBe(200);
      expect(
        (r.body as { items: { area: unknown }[] }).items.every(
          (e) => e.area === null,
        ),
      ).toBe(true);
      const before = fake.requestsTo("/api/states").length;
      await call("GET", "/api/v1/integrations/homeassistant/entities?q=door");
      expect(fake.requestsTo("/api/states")).toHaveLength(before);
    });

    it("is open to members, and a failing Home Assistant is a 502 with its code", async () => {
      await connected();
      const member = await session("member");
      seed();
      expect(
        (await member("GET", "/api/v1/integrations/homeassistant/entities")).res
          .status,
      ).toBe(200);
      clearEntityCache();
      fake.failNext("/api/states", 500, 5);
      const bad = await member(
        "GET",
        "/api/v1/integrations/homeassistant/entities",
      );
      expect([bad.res.status, errorCode(bad)]).toEqual([502, "upstream_error"]);
      expect(bad.body).toMatchObject({
        error: { details: { code: "server" } },
      });
    });
  });

  describe("other pickers", () => {
    it("lists notify services and calendars", async () => {
      const admin = await session();
      await save(admin);
      fake.addCalendar("calendar.example_waste", [], "Waste");
      expect(
        (
          await admin(
            "GET",
            "/api/v1/integrations/homeassistant/notify-services",
          )
        ).body,
      ).toEqual({
        items: [
          "mobile_app_example_phone",
          "notify",
          "persistent_notification",
        ],
      });
      expect(
        (await admin("GET", "/api/v1/integrations/homeassistant/calendars"))
          .body,
      ).toEqual({
        items: [{ id: "calendar.example_waste", name: "Waste" }],
      });
    });
  });

  describe("device suggestions", () => {
    const device = (over: Record<string, unknown>) => ({
      id: "d",
      name: null,
      name_by_user: null,
      manufacturer: null,
      model: null,
      area_id: null,
      disabled_by: null,
      ...over,
    });

    it("suggests devices no asset stands for, with manufacturer, model and area", async () => {
      const admin = await session();
      await save(admin);
      fake.areas = [{ area_id: "bath", name: "Bathroom", floor_id: null }];
      fake.devices = [
        device({
          id: "d1",
          name: "Dryer",
          manufacturer: "Examplewerk",
          model: "T-9",
          area_id: "bath",
        }),
        device({
          id: "d2",
          name: "Boiler",
          name_by_user: "Hot water",
          manufacturer: "Heatco",
          model: "B-1",
        }),
        device({
          id: "d3",
          name: "Washer",
          manufacturer: "Examplewerk",
          model: "W-1",
        }),
        device({ id: "d4", name: "Old plug", disabled_by: "user" }),
        device({ id: "d5", name: "Lamp" }),
      ];
      const ctx = ctxAt(test.db, NOW);
      createAsset(ctx, createAssetRequestSchema.parse({ name: "washer" })); // same name, other case
      createAsset(
        ctx,
        createAssetRequestSchema.parse({ name: "Hot water", model: "B-1" }),
      );
      createAsset(
        ctx,
        createAssetRequestSchema.parse({
          name: "Lamp (living room)",
          externalSource: "homeassistant",
          externalRef: "d5",
        }),
      );
      const r = await admin(
        "GET",
        "/api/v1/integrations/homeassistant/devices",
      );
      expect(r.res.status).toBe(200);
      expect(r.body).toEqual({
        items: [
          {
            id: "d1",
            name: "Dryer",
            manufacturer: "Examplewerk",
            model: "T-9",
            area: "Bathroom",
          },
        ],
      });
    });

    it("archived assets do not count, and a failing registry is a 502", async () => {
      const admin = await session();
      await save(admin);
      fake.devices = [device({ id: "d1", name: "Dryer" })];
      const asset = createAsset(
        ctxAt(test.db, NOW),
        createAssetRequestSchema.parse({ name: "Dryer" }),
      );
      expect(
        (
          (await admin("GET", "/api/v1/integrations/homeassistant/devices"))
            .body as { items: unknown[] }
        ).items,
      ).toEqual([]);
      await admin("PATCH", `/api/v1/assets/${asset.id}`, {
        json: { archived: true },
      });
      expect(
        (
          (await admin("GET", "/api/v1/integrations/homeassistant/devices"))
            .body as { items: unknown[] }
        ).items,
      ).toHaveLength(1);
      fake.wsMode = "drop";
      const bad = await admin(
        "GET",
        "/api/v1/integrations/homeassistant/devices",
      );
      expect([bad.res.status, errorCode(bad)]).toEqual([502, "upstream_error"]);
    });
  });
});

describe("deviceIsKnown", () => {
  const asset = (over = {}) => ({
    name: "Dryer",
    model: null as string | null,
    externalSource: null as string | null,
    externalRef: null as string | null,
    ...over,
  });
  const device = { id: "d1", name: "Dryer", model: "T-9" as string | null };

  it("matches by external reference, by name, and by model with overlapping names", () => {
    expect(
      deviceIsKnown(
        device,
        asset({
          name: "other",
          externalSource: "homeassistant",
          externalRef: "d1",
        }),
      ),
    ).toBe(true);
    expect(
      deviceIsKnown(
        device,
        asset({
          name: "other",
          externalSource: "paperless",
          externalRef: "d1",
        }),
      ),
    ).toBe(false);
    expect(deviceIsKnown(device, asset({ name: " DRYER " }))).toBe(true);
    expect(
      deviceIsKnown(device, asset({ name: "Dryer bathroom", model: "t-9" })),
    ).toBe(true);
    expect(
      deviceIsKnown(
        { ...device, name: "Dryer bathroom" },
        asset({ name: "Dryer", model: "T-9" }),
      ),
    ).toBe(true);
  });

  it("does not hide a second identical device behind one with another name", () => {
    expect(
      deviceIsKnown(device, asset({ name: "Guest laundry", model: "T-9" })),
    ).toBe(false);
    expect(
      deviceIsKnown(device, asset({ name: "Something", model: null })),
    ).toBe(false);
    expect(
      deviceIsKnown(
        { ...device, model: null },
        asset({ name: "Dryer bathroom", model: null }),
      ),
    ).toBe(false);
  });
});

describe("settings helpers", () => {
  it("validateInput normalises the address and drops unknown settings", () => {
    expect(
      validateInput({
        baseUrl: " http://192.168.1.5:8123/ ",
        config: { appUrl: "https://a.example.org/x/", other: 1 },
      }),
    ).toEqual({
      baseUrl: "http://192.168.1.5:8123",
      config: { appUrl: "https://a.example.org/x" },
    });
    expect(
      validateInput({ baseUrl: "http://h.example.org", config: {} }).config,
    ).toEqual({});
    expect(() =>
      validateInput({ baseUrl: "http://h.example.org", config: { appUrl: 5 } }),
    ).toThrow();
  });

  it("appUrlOf prefers the setting, falls back to ORIGIN, and ignores nonsense", () => {
    vi.stubEnv("ORIGIN", "https://origin.example.org");
    try {
      expect(appUrlOf({ appUrl: "https://app.example.org" })).toBe(
        "https://app.example.org",
      );
      expect(appUrlOf({})).toBe("https://origin.example.org");
      vi.stubEnv("ORIGIN", "not a url");
      expect(appUrlOf({})).toBeNull();
      vi.stubEnv("ORIGIN", "");
      expect(appUrlOf({})).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
