import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { addDays } from "$lib/dates";
import { connections, notifications, taskCompletions } from "$lib/server/db";
import { getConnectionRow } from "$lib/server/connections/connections";
import { getSignal, listSamples } from "$lib/server/signals/service";
import { completeTask } from "$lib/server/tasks/completions";
import { getTask } from "$lib/server/tasks/tasks";
import { createTestUser } from "$lib/testing/auth";
import { today } from "$lib/testing/dates";
import { useTestDB } from "$lib/testing/db";
import { makeTask } from "$lib/testing/domain";
import { createAsset } from "$lib/server/assets/assets";
import { createHint } from "$lib/server/hints/hints";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import { createHintRequestSchema } from "$lib/api/schemas/hints";
import { pollStates, syncCalendars } from "./sync";
import { useFakeHomeAssistant } from "./testing";

const MIN = 60_000;
const WASHER = "sensor.example_washer_cycles";

describe("Home Assistant polling and calendar sync", () => {
  const test = useTestDB();
  const { fake, connect } = useFakeHomeAssistant();
  const ctx = (now = Date.now()) => ({ db: test.db, now });
  afterEach(() => vi.restoreAllMocks());

  const counterTask = (threshold = 5, extra = {}) =>
    makeTask(ctx(), {
      title: "Descale washer",
      trigger: {
        v: 1,
        type: "counter_delta",
        entityId: WASHER,
        threshold,
        unit: "cycles",
        ...extra,
      },
    });

  describe("states", () => {
    it("does nothing without a connection, or when it is switched off", async () => {
      await counterTask();
      expect(await pollStates(ctx())).toEqual({ status: "no_connection" });
      connect({ enabled: false });
      expect(await pollStates(ctx())).toEqual({ status: "no_connection" });
      expect(fake.requests).toEqual([]);
    });

    it("reads only what is watched and stores signals and samples", async () => {
      connect();
      fake.setState(WASHER, "12", {
        unit_of_measurement: "cycles",
        friendly_name: "Washer",
      });
      fake.setState("sensor.example_unwatched", "99");
      await counterTask();
      const result = await pollStates(ctx());
      expect(result).toMatchObject({
        status: "ok",
        read: 1,
        missing: 0,
        changed: 1,
      });
      expect(fake.requestsTo("/api/states", "GET")).toHaveLength(1);
      expect(getSignal(ctx(), WASHER)).toMatchObject({
        numeric: 12,
        text: "12",
        unit: "cycles",
        source: "ha",
      });
      expect(getSignal(ctx(), "sensor.example_unwatched")).toBeUndefined();
      expect(listSamples(ctx(), WASHER)).toHaveLength(1);
      expect(fake.requests[0].headers.get("authorization")).toBe(
        `Bearer ${fake.token}`,
      );
    });

    it("a washer that runs 0 to 5 cycles makes the task due, and completing it snapshots the counter", async () => {
      connect();
      const anna = await createTestUser();
      fake.setState(WASHER, "0");
      const task = await counterTask();
      await pollStates(ctx());
      expect(getTask(ctx(), task.id).state).toMatchObject({
        status: "ok",
        progress: { current: 0, target: 5 },
      });
      for (const [value, expected] of [
        [1, 1],
        [3, 3],
      ] as const) {
        fake.setState(WASHER, String(value));
        await pollStates(ctx());
        expect(getTask(ctx(), task.id).state?.progress?.current).toBe(expected);
      }
      expect(getTask(ctx(), task.id).state?.status).toBe("ok");
      fake.setState(WASHER, "5");
      const polled = await pollStates(ctx());
      expect(polled).toMatchObject({ status: "ok", changed: 1 });
      expect(getTask(ctx(), task.id).state).toMatchObject({
        status: "due",
        dueKind: "condition",
      });
      const due = test.db
        .select()
        .from(notifications)
        .all()
        .filter((n) => n.kind === "due");
      expect(due).toHaveLength(1);
      expect(due[0].userId).toBe(anna.id);

      const { completion } = await completeTask(ctx(), task.id, {
        kind: "done",
        source: "manual",
        userId: anna.id,
      });
      expect(completion.counterValue).toBe(5);
      fake.setState(WASHER, "7");
      await pollStates(ctx());
      expect(getTask(ctx(), task.id).state).toMatchObject({
        status: "ok",
        progress: { current: 2, target: 5 },
      });
    });

    it("a counter that jumps because a cloud synced at once is due in one step", async () => {
      connect();
      fake.setState(WASHER, "4");
      const task = await counterTask(50);
      await pollStates(ctx());
      fake.setState(WASHER, "173");
      await pollStates(ctx());
      expect(getTask(ctx(), task.id).state).toMatchObject({
        status: "due",
        progress: { current: 169, target: 50 },
      });
    });

    it("an unavailable reading changes nothing", async () => {
      connect();
      fake.setState(WASHER, "2");
      const task = await counterTask();
      await pollStates(ctx());
      fake.setState(WASHER, "unavailable");
      const r = await pollStates(ctx());
      expect(r).toMatchObject({ status: "ok", changed: 0 });
      expect(getSignal(ctx(), WASHER)).toMatchObject({ numeric: 2 });
      expect(getTask(ctx(), task.id).state?.status).toBe("ok");
    });

    it("an entity Home Assistant does not know is counted, not fatal", async () => {
      connect();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      fake.setState(WASHER, "1");
      await counterTask();
      await makeTask(ctx(), {
        trigger: {
          v: 1,
          type: "counter_delta",
          entityId: "sensor.example_gone",
          threshold: 5,
        },
      });
      const r = await pollStates(ctx());
      expect(r).toMatchObject({ status: "ok", read: 1, missing: 1 });
      expect(warn.mock.calls.map((c) => String(c[0])).join()).toContain(
        "entities_missing",
      );
      expect(getSignal(ctx(), WASHER)).toBeDefined();
    });

    it("ids that are not entity ids are not requested, so one bad hint cannot stop the polling", async () => {
      connect();
      fake.setState(WASHER, "1");
      await counterTask();
      const asset = createAsset(
        ctx(),
        createAssetRequestSchema.parse({ name: "Door" }),
      );
      createHint(
        ctx(),
        asset.id,
        createHintRequestSchema.parse({
          title: "x",
          reaction: {
            type: "signal_change",
            entityId: "not an entity id",
            toState: "on",
            notify: "all",
          },
        }),
      );
      expect(await pollStates(ctx())).toMatchObject({ status: "ok", read: 1 });
    });

    it("completes a counter task by itself when the counter resets, once", async () => {
      connect();
      fake.setState("sensor.example_vent_hours", "0");
      const task = await makeTask(ctx(), {
        title: "Ventilation filter",
        trigger: {
          v: 1,
          type: "counter_delta",
          entityId: "sensor.example_vent_hours",
          threshold: 400,
          autoCompleteOnReset: { minDrop: 100 },
        },
      });
      await pollStates(ctx());
      fake.setState("sensor.example_vent_hours", "450");
      await pollStates(ctx());
      expect(getTask(ctx(), task.id).state?.status).toBe("due");
      fake.setState("sensor.example_vent_hours", "3");
      const r = await pollStates(ctx());
      expect(r).toMatchObject({ status: "ok", autoCompleted: 1 });
      const done = test.db
        .select()
        .from(taskCompletions)
        .where(eq(taskCompletions.taskId, task.id))
        .all();
      expect(done).toHaveLength(1);
      expect(done[0]).toMatchObject({
        source: "ha",
        userId: null,
        counterValue: 3,
      });
      expect(getTask(ctx(), task.id).state?.status).toBe("ok");
      // polling the same value again completes nothing more
      await pollStates(ctx());
      expect(
        test.db
          .select()
          .from(taskCompletions)
          .where(eq(taskCompletions.taskId, task.id))
          .all(),
      ).toHaveLength(1);
    });

    it("a state condition is due while it holds and can be acknowledged", async () => {
      connect();
      fake.setState("binary_sensor.example_door", "off");
      const task = await makeTask(ctx(), {
        trigger: {
          v: 1,
          type: "state_condition",
          entityId: "binary_sensor.example_door",
          op: "eq",
          value: "on",
        },
      });
      await pollStates(ctx());
      expect(getTask(ctx(), task.id).state?.status).toBe("ok");
      fake.setState("binary_sensor.example_door", "on");
      await pollStates(ctx());
      expect(getTask(ctx(), task.id).state).toMatchObject({ status: "due" });
      await completeTask(ctx(), task.id, {
        kind: "done",
        source: "manual",
        userId: null,
      });
      await pollStates(ctx());
      expect(getTask(ctx(), task.id).state).toMatchObject({
        status: "ok",
        reasons: ["acknowledged"],
      });
    });
  });

  describe("health and backoff", () => {
    const row = () => getConnectionRow(ctx(), "homeassistant", null)!;

    it("records success", async () => {
      connect();
      fake.setState(WASHER, "1");
      await counterTask();
      await pollStates(ctx());
      expect(row()).toMatchObject({
        status: "ok",
        lastError: null,
        consecutiveFailures: 0,
      });
      expect(row().lastOkAt).not.toBeNull();
    });

    it("maps failures to short codes and backs off 1, 2, 4 minutes", async () => {
      connect();
      vi.spyOn(console, "error").mockImplementation(() => {});
      fake.setState(WASHER, "1");
      await counterTask();
      const t0 = Date.now();

      fake.failNext("/api/states", 500, 99);
      expect(await pollStates(ctx(t0))).toEqual({
        status: "failed",
        code: "server",
        failures: 1,
      });
      expect(row()).toMatchObject({
        status: "error",
        lastError: "server",
        consecutiveFailures: 1,
      });
      const calls = fake.requests.length;

      expect(await pollStates(ctx(t0 + 30_000))).toEqual({ status: "backoff" });
      expect(fake.requests.length).toBe(calls);

      expect(await pollStates(ctx(t0 + MIN + 1))).toMatchObject({
        status: "failed",
        failures: 2,
      });
      expect(await pollStates(ctx(t0 + 2 * MIN))).toEqual({
        status: "backoff",
      });
      expect(await pollStates(ctx(t0 + 3 * MIN + 10))).toMatchObject({
        status: "failed",
        failures: 3,
      });
      expect(await pollStates(ctx(t0 + 6 * MIN))).toEqual({
        status: "backoff",
      });
      expect(await pollStates(ctx(t0 + 7 * MIN + 20))).toMatchObject({
        failures: 4,
      });
    });

    it("recovers: the failure count and error are cleared on the first success", async () => {
      connect();
      vi.spyOn(console, "error").mockImplementation(() => {});
      fake.setState(WASHER, "1");
      await counterTask();
      const t0 = Date.now();
      fake.failNext("/api/states", 503, 1);
      await pollStates(ctx(t0));
      expect(row().consecutiveFailures).toBe(1);
      expect(await pollStates(ctx(t0 + MIN + 1))).toMatchObject({
        status: "ok",
      });
      expect(row()).toMatchObject({
        status: "ok",
        lastError: null,
        consecutiveFailures: 0,
      });
    });

    it("ignoreBackoff polls anyway (a changed connection)", async () => {
      connect();
      vi.spyOn(console, "error").mockImplementation(() => {});
      fake.setState(WASHER, "1");
      await counterTask();
      const t0 = Date.now();
      fake.failNext("/api/states", 500, 1);
      await pollStates(ctx(t0));
      expect(
        await pollStates(ctx(t0 + 1000), { ignoreBackoff: true }),
      ).toMatchObject({ status: "ok" });
    });

    it("a rejected token is reported as unauthorized", async () => {
      connect({ token: "wrong-token" });
      vi.spyOn(console, "error").mockImplementation(() => {});
      await counterTask();
      expect(await pollStates(ctx())).toMatchObject({
        status: "failed",
        code: "unauthorized",
      });
      expect(row().lastError).toBe("unauthorized");
    });

    it("an unreachable server is a network failure", async () => {
      connect();
      vi.spyOn(console, "error").mockImplementation(() => {});
      await counterTask();
      const closed = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: () => new Response(),
      });
      const port = closed.port;
      await closed.stop(true);
      test.db
        .update(connections)
        .set({ baseUrl: `http://127.0.0.1:${port}` })
        .run();
      expect(await pollStates(ctx())).toMatchObject({
        status: "failed",
        code: "network",
      });
    });

    it("a malformed answer is invalid_response and never partial data", async () => {
      connect();
      vi.spyOn(console, "error").mockImplementation(() => {});
      fake.setState(WASHER, "1");
      await counterTask();
      fake.states.set("sensor.broken", {
        entity_id: "NOT VALID",
        state: "1",
        attributes: {},
        last_changed: "x",
        last_updated: "x",
      });
      expect(await pollStates(ctx())).toMatchObject({
        status: "failed",
        code: "invalid_response",
      });
      expect(getSignal(ctx(), WASHER)).toBeUndefined();
    });

    it("does not log tokens or addresses", async () => {
      connect({ token: "wrong-token" });
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      await counterTask();
      await pollStates(ctx());
      const logged = error.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain("poll_failed");
      expect(logged).not.toContain("wrong-token");
      expect(logged).not.toContain("127.0.0.1");
    });

    it("with nothing to watch it only checks the connection now and then", async () => {
      connect();
      const t0 = Date.now();
      expect(await pollStates(ctx(t0))).toEqual({ status: "idle" });
      expect(fake.requestsTo("/api/config")).toHaveLength(1);
      expect(fake.requestsTo("/api/states")).toHaveLength(0);
      expect(row().status).toBe("ok");
      expect(await pollStates(ctx(t0 + MIN))).toEqual({ status: "idle" });
      expect(fake.requestsTo("/api/config")).toHaveLength(1);
      expect(await pollStates(ctx(t0 + 11 * MIN))).toEqual({ status: "idle" });
      expect(fake.requestsTo("/api/config")).toHaveLength(2);
    });
  });

  describe("calendars", () => {
    const CAL = "calendar.example_waste";
    const calTask = (summaryMatch?: string, offsetDays = -1) =>
      makeTask(ctx(), {
        title: "Put out paper",
        trigger: {
          v: 1,
          type: "ha_calendar",
          entityId: CAL,
          offsetDays,
          ...(summaryMatch ? { summaryMatch } : {}),
        },
      });

    it("reads the next 60 days and makes the task due the evening before", async () => {
      connect();
      const tomorrow = addDays(today(), 1);
      fake.addCalendar(CAL, [
        {
          summary: "Paper collection",
          start: { date: tomorrow },
          end: { date: addDays(tomorrow, 1) },
        },
        {
          summary: "Glass",
          start: { date: addDays(today(), 3) },
          end: { date: addDays(today(), 4) },
        },
      ]);
      const task = await calTask("paper");
      const result = await syncCalendars(ctx());
      expect(result).toEqual({
        synced: 1,
        failed: 0,
        changedKeys: [`${CAL}#paper`],
      });
      const request = fake.requestsTo(`/api/calendars/${CAL}`)[0];
      const span =
        Date.parse(request.query.get("end")!) -
        Date.parse(request.query.get("start")!);
      expect(Math.round(span / 86_400_000)).toBe(61);
      expect(getTask(ctx(), task.id).state).toMatchObject({
        status: "due",
        dueDate: today(),
        occurrenceKey: tomorrow,
      });
    });

    it("keeps the dates of different filters apart", async () => {
      connect();
      fake.addCalendar(CAL, [
        {
          summary: "Paper",
          start: { date: addDays(today(), 5) },
          end: { date: addDays(today(), 6) },
        },
        {
          summary: "Glass",
          start: { date: addDays(today(), 9) },
          end: { date: addDays(today(), 10) },
        },
      ]);
      const paper = await calTask("paper");
      const glass = await calTask("/glass/");
      await syncCalendars(ctx());
      expect(getTask(ctx(), paper.id).state?.occurrenceKey).toBe(
        addDays(today(), 5),
      );
      expect(getTask(ctx(), glass.id).state?.occurrenceKey).toBe(
        addDays(today(), 9),
      );
    });

    it("a failing calendar keeps its old dates; one that is not a calendar entity is skipped", async () => {
      connect();
      vi.spyOn(console, "error").mockImplementation(() => {});
      fake.addCalendar(CAL, [
        {
          summary: "Paper",
          start: { date: addDays(today(), 5) },
          end: { date: addDays(today(), 6) },
        },
      ]);
      const task = await calTask();
      await makeTask(ctx(), {
        trigger: {
          v: 1,
          type: "ha_calendar",
          entityId: "sensor.not_a_calendar",
          offsetDays: 0,
        },
      });
      expect(await syncCalendars(ctx())).toMatchObject({
        synced: 1,
        failed: 1,
      });
      fake.failNext(`/api/calendars/${CAL}`, 500, 1);
      expect(await syncCalendars(ctx())).toMatchObject({
        synced: 0,
        failed: 2,
      });
      expect(getTask(ctx(), task.id).state?.occurrenceKey).toBe(
        addDays(today(), 5),
      );
    });

    it("leaves what has no change alone, and re-reads on request", async () => {
      connect();
      fake.addCalendar(CAL, [
        {
          summary: "Paper",
          start: { date: addDays(today(), 5) },
          end: { date: addDays(today(), 6) },
        },
      ]);
      await calTask();
      const lastSynced = new Map<string, number>();
      const t0 = Date.now();
      expect(
        await syncCalendars(ctx(t0), { lastSynced, maxAgeMs: 6 * 60 * MIN }),
      ).toMatchObject({ synced: 1 });
      expect(
        await syncCalendars(ctx(t0 + MIN), {
          lastSynced,
          maxAgeMs: 6 * 60 * MIN,
        }),
      ).toMatchObject({ synced: 0 });
      expect(fake.requestsTo(`/api/calendars/${CAL}`)).toHaveLength(1);
      const again = await syncCalendars(ctx(t0 + 2 * MIN), { lastSynced });
      expect(again).toMatchObject({ synced: 1, changedKeys: [] });
    });

    it("an invalid filter pattern is skipped and logged", async () => {
      connect();
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      fake.addCalendar(CAL, []);
      await calTask("/(a+)+$/");
      expect(await syncCalendars(ctx())).toMatchObject({
        synced: 0,
        failed: 1,
      });
      expect(error.mock.calls.map((c) => String(c[0])).join()).toContain(
        "calendar_failed",
      );
    });

    it("maps a timed event to the local date, not the UTC one", async () => {
      connect();
      // 23:30 UTC the day before tomorrow is already tomorrow in Zurich
      const target = addDays(today(), 4);
      fake.addCalendar(CAL, [
        {
          summary: "Late pickup",
          start: { dateTime: `${addDays(target, -1)}T23:30:00Z` },
          end: { dateTime: `${target}T00:30:00Z` },
        },
      ]);
      const task = await calTask(undefined, 0);
      await syncCalendars(ctx());
      expect(getTask(ctx(), task.id).state?.occurrenceKey).toBe(target);
    });
  });
});
