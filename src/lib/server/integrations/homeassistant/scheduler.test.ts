import { afterEach, describe, expect, it, vi } from "vitest";
import { connections } from "$lib/server/db";
import { saveConnection } from "$lib/server/connections/connections";
import { createCaller } from "$lib/testing/api";
import { addDays } from "$lib/dates";
import { createTestUser, loginTestUser } from "$lib/testing/auth";
import { today } from "$lib/testing/dates";
import { useTestDB } from "$lib/testing/db";
import { makeTask } from "$lib/testing/domain";
import { registeredChannels } from "$lib/server/notifications/channels";
import { getSignal } from "$lib/server/signals/service";
import { getTask } from "$lib/server/tasks/tasks";
import { registerHomeAssistant } from "./index";
import { startHomeAssistantScheduler } from "./scheduler";
import { useFakeHomeAssistant } from "./testing";

const WASHER = "sensor.example_washer_cycles";
const counter = (entityId = WASHER) =>
  ({ v: 1, type: "counter_delta", entityId, threshold: 5 }) as const;

describe("Home Assistant scheduler", () => {
  const test = useTestDB();
  const { fake, connect } = useFakeHomeAssistant();
  const stops: (() => void)[] = [];
  afterEach(() => {
    stops.splice(0).forEach((s) => s());
    vi.restoreAllMocks();
  });
  const ctx = () => ({ db: test.db, now: Date.now() });
  const start = (options = {}) => {
    const stop = startHomeAssistantScheduler({
      firstRunDelayMs: 5,
      pollIntervalMs: 3_600_000,
      calendarIntervalMs: 3_600_000,
      kickDelayMs: 10,
      ...options,
    });
    stops.push(stop);
    return stop;
  };
  const states = () => fake.requestsTo("/api/states", "GET").length;

  it("reads shortly after start and then on every tick", async () => {
    connect();
    fake.setState(WASHER, "1");
    const task = await makeTask(ctx(), { trigger: counter() });
    start({ pollIntervalMs: 40 });
    await vi.waitFor(() => expect(getSignal(ctx(), WASHER)?.numeric).toBe(1));
    fake.setState(WASHER, "6");
    await vi.waitFor(
      () => expect(getTask(ctx(), task.id).state?.status).toBe("due"),
      { timeout: 3000 },
    );
    expect(states()).toBeGreaterThanOrEqual(2);
  });

  it("reads soon after a task that adds something to watch is saved, so the baseline is not lost", async () => {
    connect();
    fake.setState(WASHER, "10");
    start();
    await new Promise((r) => setTimeout(r, 30));
    const before = states();
    const task = await makeTask(ctx(), { trigger: counter() });
    await vi.waitFor(() =>
      expect(getTask(ctx(), task.id).state?.counterBaseline).toBe(10),
    );
    expect(states()).toBe(before + 1);
  });

  it("a burst of changes causes one read", async () => {
    connect();
    fake.setState(WASHER, "1");
    start({ kickDelayMs: 40 });
    await new Promise((r) => setTimeout(r, 30));
    const before = states();
    for (let i = 0; i < 5; i++) await makeTask(ctx(), { trigger: counter() });
    await vi.waitFor(() => expect(states()).toBe(before + 1));
    await new Promise((r) => setTimeout(r, 120));
    expect(states()).toBe(before + 1);
  });

  it("reads again when the connection is saved, even while it is backing off", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const row = connect({ token: "wrong" });
    fake.setState(WASHER, "1");
    await makeTask(ctx(), { trigger: counter() });
    start({ pollIntervalMs: 30 });
    await vi.waitFor(() =>
      expect(
        test.db.select().from(connections).get()?.consecutiveFailures,
      ).toBeGreaterThan(0),
    );
    saveConnection(ctx(), "homeassistant", null, {
      baseUrl: fake.baseUrl,
      token: fake.token,
      allowInsecureTls: false,
    });
    await vi.waitFor(() => expect(getSignal(ctx(), WASHER)?.numeric).toBe(1));
    expect(test.db.select().from(connections).get()).toMatchObject({
      status: "ok",
      consecutiveFailures: 0,
      id: row.id,
    });
  });

  it("backs off after a failure instead of hammering the server", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    connect({ token: "wrong" });
    await makeTask(ctx(), { trigger: counter() });
    start({ pollIntervalMs: 20 });
    await vi.waitFor(() =>
      expect(
        test.db.select().from(connections).get()?.consecutiveFailures,
      ).toBe(1),
    );
    const calls = fake.requests.length;
    await new Promise((r) => setTimeout(r, 300));
    // one minute of backoff: the 20 ms ticks in between make no request
    expect(fake.requests.length).toBe(calls);
  });

  it("never overlaps runs; a request during a run is served once afterwards", async () => {
    connect();
    fake.setState(WASHER, "1");
    fake.delayMs = 120;
    await makeTask(ctx(), { trigger: counter() });
    start({ pollIntervalMs: 15, firstRunDelayMs: 5 });
    await new Promise((r) => setTimeout(r, 450));
    // a 120 ms request cannot be started 30 times
    expect(states()).toBeLessThanOrEqual(4);
    expect(states()).toBeGreaterThanOrEqual(2);
  });

  it("stops: no more reads, no more reactions to events", async () => {
    connect();
    fake.setState(WASHER, "1");
    const stop = start({ pollIntervalMs: 20 });
    await makeTask(ctx(), { trigger: counter() });
    await vi.waitFor(() => expect(states()).toBeGreaterThan(0));
    stop();
    await new Promise((r) => setTimeout(r, 40));
    const calls = fake.requests.length;
    await makeTask(ctx(), { trigger: counter("sensor.example_other") });
    await new Promise((r) => setTimeout(r, 120));
    expect(fake.requests.length).toBe(calls);
  });

  it("logs a failing run by name and carries on with the next", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    connect();
    fake.setState(WASHER, "1");
    await makeTask(ctx(), { trigger: counter() });
    test.db.update(connections).set({ tokenEnc: "v1.garbage.garbage" }).run();
    start({ pollIntervalMs: 20 });
    await vi.waitFor(() =>
      expect(error.mock.calls.map((c) => String(c[0])).join()).toContain(
        "homeassistant.scheduler_failed",
      ),
    );
    const logged = error.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("IntegrationError");
    expect(logged).not.toContain("garbage");
    // a repaired token is picked up by the next tick
    saveConnection(ctx(), "homeassistant", null, {
      baseUrl: fake.baseUrl,
      token: fake.token,
      allowInsecureTls: false,
    });
    await vi.waitFor(() => expect(getSignal(ctx(), WASHER)?.numeric).toBe(1));
  });

  it("reads calendars at the start and when a new calendar becomes watched", async () => {
    connect();
    const date = addDays(today(), 3);
    fake.addCalendar("calendar.example_waste", [
      { summary: "Paper", start: { date }, end: { date: addDays(date, 1) } },
    ]);
    const first = await makeTask(ctx(), {
      trigger: {
        v: 1,
        type: "ha_calendar",
        entityId: "calendar.example_waste",
        offsetDays: -1,
      },
    });
    start();
    await vi.waitFor(() =>
      expect(getTask(ctx(), first.id).state?.occurrenceKey).toBe(date),
    );
    const calls = fake.requestsTo(
      "/api/calendars/calendar.example_waste",
    ).length;
    const second = await makeTask(ctx(), {
      trigger: {
        v: 1,
        type: "ha_calendar",
        entityId: "calendar.example_waste",
        summaryMatch: "paper",
        offsetDays: 0,
      },
    });
    await vi.waitFor(() =>
      expect(getTask(ctx(), second.id).state?.occurrenceKey).toBe(date),
    );
    // only the new subscription was read, the first one is fresh
    expect(
      fake.requestsTo("/api/calendars/calendar.example_waste").length,
    ).toBe(calls + 1);
  });
});

describe("registerHomeAssistant (the whole adapter, through the API)", () => {
  useTestDB();
  const { fake } = useFakeHomeAssistant();
  const stops: (() => void)[] = [];
  afterEach(() => stops.splice(0).forEach((s) => s()));

  it("registers the settings, the channel and the scheduler, and removes them again", async () => {
    stops.push(
      registerHomeAssistant({
        scheduler: {
          firstRunDelayMs: 5,
          pollIntervalMs: 3_600_000,
          calendarIntervalMs: 3_600_000,
          kickDelayMs: 10,
        },
      }),
    );
    const admin = await createTestUser({ role: "admin" });
    const call = createCaller({ session: loginTestUser(admin).token });
    const saved = await call("PUT", "/api/v1/integrations/homeassistant", {
      json: {
        baseUrl: fake.baseUrl,
        token: fake.token,
        allowInsecureTls: false,
      },
    });
    expect(saved.body).toMatchObject({ available: true });
    expect(registeredChannels()).toContain("ha_notify");
    stops.splice(0).forEach((s) => s());
    expect(registeredChannels()).not.toContain("ha_notify");
    const after = await call("GET", "/api/v1/integrations");
    expect(
      (after.body as { items: { available: boolean }[] }).items[0].available,
    ).toBe(false);
  });
});
