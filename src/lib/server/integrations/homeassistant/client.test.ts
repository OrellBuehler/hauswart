import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HomeAssistantClient,
  HomeAssistantError,
  buildActionableNotification,
  calendarEventsToDates,
  describeError,
  errorCode,
  messageForCode,
  normalizeBaseUrl,
  toSignal,
} from "./index";
import { startFakeHomeAssistant } from "./fake-server";

const fake = startFakeHomeAssistant();
afterAll(() => fake.stop());
beforeEach(() => fake.reset());

const client = (
  over: Partial<ConstructorParameters<typeof HomeAssistantClient>[0]> = {},
) =>
  new HomeAssistantClient({
    baseUrl: fake.baseUrl,
    token: "test-token",
    ...over,
  });

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof HomeAssistantError) return err.code;
    throw err;
  }
  return "none";
}

describe("normalizeBaseUrl", () => {
  it("keeps origin and path prefix and drops trailing slash, query and fragment", () => {
    expect(normalizeBaseUrl(" https://ha.example.org/ ")).toBe(
      "https://ha.example.org",
    );
    expect(normalizeBaseUrl("http://ha.example.org:8123//")).toBe(
      "http://ha.example.org:8123",
    );
    expect(normalizeBaseUrl("https://example.org/ha?x=1#y")).toBe(
      "https://example.org/ha",
    );
  });

  it("allows LAN, loopback and link-local hosts (admin-configured)", () => {
    for (const url of [
      "http://192.168.1.20:8123",
      "http://10.0.0.5:8123",
      "http://homeassistant.local:8123",
      "http://localhost:8123",
      "http://[::1]:8123",
      "http://169.254.1.1",
    ]) {
      expect(() => normalizeBaseUrl(url), url).not.toThrow();
    }
  });

  it("rejects other schemes, credentials and garbage", () => {
    for (const bad of [
      "ftp://ha.example.org",
      "ws://ha.example.org",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "https://user:pw@ha.example.org",
      "https://user@ha.example.org",
      "ha.example.org:8123",
      "not a url",
      "",
    ]) {
      expect(() => normalizeBaseUrl(bad), bad).toThrow(HomeAssistantError);
    }
  });
});

describe("requests", () => {
  it("sends the bearer token", async () => {
    await client().getConfig();
    expect(fake.requests[0]!.headers.get("authorization")).toBe(
      "Bearer test-token",
    );
  });

  it("maps a rejected token to unauthorized without leaking it", async () => {
    fake.token = "other";
    const err = await client()
      .getConfig()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HomeAssistantError);
    expect((err as HomeAssistantError).code).toBe("unauthorized");
    expect((err as Error).message).not.toContain("test-token");
  });

  it("rejects tokens that could break the header without quoting them", () => {
    for (const token of ["", "a b", "x\r\nHost: evil", "tok\u0000"]) {
      let err: unknown;
      try {
        client({ token });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(HomeAssistantError);
      expect((err as Error).message).not.toContain("evil");
    }
  });

  it("refuses redirects instead of following them", async () => {
    fake.redirectAll = true;
    expect(await codeOf(client().getConfig())).toBe("redirect");
    expect(fake.requests).toHaveLength(1);
  });

  it("times out slow servers", async () => {
    fake.delayMs = 400;
    expect(await codeOf(client({ timeoutMs: 50 }).getConfig())).toBe("timeout");
  });

  it("maps server errors and bad requests", async () => {
    fake.failNext("/api/config", 500);
    expect(await codeOf(client().getConfig())).toBe("server");
    fake.failNext("/api/config", 503);
    expect(await codeOf(client().getConfig())).toBe("server");
    fake.failNext("/api/config", 400);
    expect(await codeOf(client().getConfig())).toBe("bad_request");
    fake.failNext("/api/config", 403);
    expect(await codeOf(client().getConfig())).toBe("forbidden");
  });

  it("maps an unreachable server to network", async () => {
    const probe = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response("x"),
    });
    const closedPort = probe.port;
    await probe.stop(true);
    expect(
      await codeOf(
        new HomeAssistantClient({
          baseUrl: `http://127.0.0.1:${closedPort}`,
          token: "x",
          timeoutMs: 2000,
        }).getConfig(),
      ),
    ).toBe("network");
  });

  it("rejects malformed payloads without echoing them", async () => {
    fake.version = "";
    const err = await client()
      .getConfig()
      .catch((e: unknown) => e);
    expect((err as HomeAssistantError).code).toBe("invalid_response");
  });

  it("caps response bodies", async () => {
    fake.setState("sensor.example_a", "1");
    expect(await codeOf(client({ maxJsonBytes: 20 }).getStates())).toBe(
      "too_large",
    );
  });

  it("never disables certificate verification unless the connection allows it", async () => {
    const seen: Array<unknown> = [];
    const real = globalThis.fetch;
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        seen.push((init as { tls?: unknown } | undefined)?.tls);
        return real(input, init);
      });
    try {
      await client().getConfig();
      await client({ allowInsecureTls: false }).getConfig();
      expect(seen).toEqual([undefined, undefined]);
      await client({ allowInsecureTls: true }).getConfig();
      expect(seen[2]).toEqual({ rejectUnauthorized: false });
    } finally {
      spy.mockRestore();
    }
  });

  it("has user-presentable messages", () => {
    expect(messageForCode("tls")).toMatch(/certificate/);
    expect(messageForCode("nope")).toBe("An unexpected error occurred.");
    expect(errorCode(new HomeAssistantError("timeout"))).toBe("timeout");
    expect(describeError(new HomeAssistantError("unauthorized"))).toMatch(
      /token/,
    );
  });
});

describe("getConfig", () => {
  it("returns version, time zone and location name only", async () => {
    expect(await client().getConfig()).toEqual({
      version: "2026.1.0",
      timeZone: "Europe/Zurich",
      locationName: "Example Home",
    });
  });
});

describe("states", () => {
  beforeEach(() => {
    fake.setState("sensor.example_washer_cycles", "128", { unit: "cycles" });
    fake.setState("binary_sensor.example_door", "on");
    fake.setState("sensor.example_offline", "unavailable");
  });

  it("lists all states", async () => {
    const states = await client().getStates();
    expect(states.map((s) => s.entityId)).toEqual([
      "sensor.example_washer_cycles",
      "binary_sensor.example_door",
      "sensor.example_offline",
    ]);
    expect(states[0]).toMatchObject({
      state: "128",
      attributes: { unit: "cycles" },
    });
  });

  it("reads one state and maps 404 to not_found", async () => {
    const s = await client().getState("sensor.example_washer_cycles");
    expect(s.state).toBe("128");
    expect(await codeOf(client().getState("sensor.example_missing"))).toBe(
      "not_found",
    );
  });

  it("validates entity ids before sending", async () => {
    for (const bad of [
      "",
      "nodot",
      "Sensor.Upper",
      "sensor.a/b",
      "sensor.a?x=1",
      "../config",
      "sensor.a b",
    ]) {
      expect(await codeOf(client().getState(bad)), bad).toBe("invalid_input");
    }
    expect(fake.requests).toHaveLength(0);
  });

  it("fetches all states once and filters for several entities", async () => {
    const result = await client().getEntitiesStates([
      "sensor.example_washer_cycles",
      "sensor.example_washer_cycles",
      "sensor.example_gone",
      "sensor.example_offline",
    ]);
    expect([...result.states.keys()]).toEqual([
      "sensor.example_washer_cycles",
      "sensor.example_offline",
    ]);
    expect(result.missing).toEqual(["sensor.example_gone"]);
    expect(fake.requestsTo("/api/states")).toHaveLength(1);
  });

  it("feeds signals", async () => {
    fake.setState(
      "sensor.example_washer_cycles",
      "129",
      {},
      "2026-03-01T10:00:00+00:00",
    );
    const { states } = await client().getEntitiesStates([
      "sensor.example_washer_cycles",
      "sensor.example_offline",
    ]);
    expect(toSignal(states.get("sensor.example_washer_cycles")!, 77)).toEqual({
      numeric: 129,
      text: "129",
      changedAt: Date.parse("2026-03-01T10:00:00Z"),
      seenAt: 77,
    });
    expect(toSignal(states.get("sensor.example_offline")!, 77)).toMatchObject({
      numeric: null,
      text: null,
    });
  });

  it("rejects states with bad entity ids", async () => {
    fake.states.set("Bad Id", {
      entity_id: "Bad Id",
      state: "1",
      attributes: {},
      last_changed: "2026-01-01T00:00:00Z",
      last_updated: "2026-01-01T00:00:00Z",
    });
    expect(await codeOf(client().getStates())).toBe("invalid_response");
  });
});

describe("calendars", () => {
  beforeEach(() => {
    fake.addCalendar(
      "calendar.example_waste",
      [
        {
          summary: "Paper collection",
          start: { date: "2026-03-27" },
          end: { date: "2026-03-28" },
        },
        {
          summary: "Bio waste",
          start: { dateTime: "2026-03-28T23:30:00+00:00" },
          end: { dateTime: "2026-03-29T00:30:00+00:00" },
          description: "Green bin",
          uid: "evt-1",
        },
        {
          summary: "Far away",
          start: { date: "2026-08-01" },
          end: { date: "2026-08-02" },
        },
      ],
      "Waste",
    );
  });

  it("lists calendars", async () => {
    expect(await client().listCalendars()).toEqual([
      { entityId: "calendar.example_waste", name: "Waste" },
    ]);
  });

  it("returns all-day and timed events in a range and converts them to dates", async () => {
    const events = await client().getCalendarEvents(
      "calendar.example_waste",
      "2026-03-01T00:00:00Z",
      new Date("2026-04-30T00:00:00Z"),
    );
    expect(events.map((e) => e.summary)).toEqual([
      "Paper collection",
      "Bio waste",
    ]);
    expect(events[0]!.start).toEqual({ date: "2026-03-27" });
    expect(events[1]).toMatchObject({
      start: { dateTime: "2026-03-28T23:30:00+00:00" },
      description: "Green bin",
      uid: "evt-1",
    });
    const req = fake.requests.at(-1)!;
    expect(req.path).toBe("/api/calendars/calendar.example_waste");
    expect(req.query.get("start")).toBe("2026-03-01T00:00:00.000Z");
    expect(req.query.get("end")).toBe("2026-04-30T00:00:00.000Z");
    expect(calendarEventsToDates(events, "Europe/Zurich")).toEqual([
      "2026-03-27",
      "2026-03-29",
    ]);
    expect(calendarEventsToDates(events, "Europe/Zurich", "bio")).toEqual([
      "2026-03-29",
    ]);
  });

  it("validates entity and range", async () => {
    const c = client();
    expect(
      await codeOf(
        c.getCalendarEvents("sensor.example_a", "2026-01-01", "2026-02-01"),
      ),
    ).toBe("invalid_input");
    expect(
      await codeOf(
        c.getCalendarEvents(
          "calendar.example_waste",
          "2026-02-01",
          "2026-01-01",
        ),
      ),
    ).toBe("invalid_input");
    expect(
      await codeOf(
        c.getCalendarEvents("calendar.example_waste", "garbage", "2026-01-01"),
      ),
    ).toBe("invalid_input");
    expect(fake.requests).toHaveLength(0);
  });

  it("maps an unknown calendar to not_found", async () => {
    expect(
      await codeOf(
        client().getCalendarEvents(
          "calendar.example_none",
          "2026-01-01",
          "2026-02-01",
        ),
      ),
    ).toBe("not_found");
  });

  it("rejects events with unusable times", async () => {
    fake.addCalendar("calendar.example_bad", [
      {
        summary: "x",
        start: { date: "2026-13-45" },
        end: { date: "2026-13-46" },
      },
    ]);
    expect(
      await codeOf(
        client().getCalendarEvents(
          "calendar.example_bad",
          "2000-01-01",
          "2100-01-01",
        ),
      ),
    ).toBe("invalid_response");
  });
});

describe("services and notifications", () => {
  it("calls a notify service with the actionable payload and records it", async () => {
    const payload = buildActionableNotification({
      title: "Filter due",
      message: "Replace the washer filter",
      url: "https://hauswart.example.org/tasks/42",
      tag: "task-42",
      actions: [{ action: "HW_DONE_abc", title: "Done" }],
    });
    await client().sendNotification("mobile_app_example_phone", payload);
    expect(fake.notifications).toEqual([
      { domain: "notify", service: "mobile_app_example_phone", data: payload },
    ]);
    expect(fake.requests.at(-1)).toMatchObject({
      method: "POST",
      path: "/api/services/notify/mobile_app_example_phone",
    });
  });

  it("calls arbitrary services with data", async () => {
    await client().callService("light", "turn_on", {
      entity_id: "light.example",
    });
    await client().callService("light", "turn_off");
    expect(fake.serviceCalls).toEqual([
      {
        domain: "light",
        service: "turn_on",
        data: { entity_id: "light.example" },
      },
      { domain: "light", service: "turn_off", data: {} },
    ]);
  });

  it("validates domain and service names", async () => {
    for (const [d, s] of [
      ["notify", "Mobile_App"],
      ["notify", "a/b"],
      ["notify", "../states"],
      ["notify", ""],
      ["no tify", "x"],
      ["notify", "x?y=1"],
      ["Notify", "x"],
      ["notify", "x".repeat(101)],
    ] as const) {
      expect(await codeOf(client().callService(d, s)), `${d}.${s}`).toBe(
        "invalid_input",
      );
    }
    expect(fake.requests).toHaveLength(0);
  });

  it("maps an unknown service to bad_request", async () => {
    expect(await codeOf(client().callService("notify", "nobody"))).toBe(
      "bad_request",
    );
  });

  it("lists notify services sorted and without the domain", async () => {
    expect(await client().listNotifyServices()).toEqual([
      "mobile_app_example_phone",
      "notify",
      "persistent_notification",
    ]);
    fake.services.delete("notify");
    expect(await client().listNotifyServices()).toEqual([]);
  });
});
