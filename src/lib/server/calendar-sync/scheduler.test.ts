import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAppointment,
  type CreateAppointmentInput,
} from "$lib/server/appointments/appointments";
import { calendarTargets, connections } from "$lib/server/db";
import { emitEvent } from "$lib/server/events";
import { completeTask } from "$lib/server/tasks/completions";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt, everyDays, makeTask, NOW } from "$lib/testing/domain";
import { getTargetRow } from "./store";
import {
  addTarget,
  CALENDAR_ID,
  connectCalendarSystem,
  useFakeCalendars,
} from "./testing";
import { startCalendarSyncScheduler } from "./scheduler";
import { syncTarget } from "./sync";
import { updateTarget } from "./targets";
import { ADMIN } from "./testing";

async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MINUTE = 60_000;

describe("calendar sync scheduler", () => {
  const test = useTestDB();
  const fake = useFakeCalendars();
  const ctx = (now = NOW) => ctxAt(test.db, now);
  const stops: Array<() => void> = [];
  afterEach(async () => {
    while (stops.length) stops.pop()!();
    await fake.idle();
    vi.restoreAllMocks();
  });

  const start = (options = {}) => {
    const stop = startCalendarSyncScheduler({
      firstRunDelayMs: 5,
      checkIntervalMs: 1_000_000,
      kickDelayMs: 5,
      clock: () => NOW,
      ...options,
    });
    stops.push(stop);
    return stop;
  };
  const book = (
    title: string,
    day = "2026-06-20",
    over: Partial<CreateAppointmentInput> = {},
  ) =>
    createAppointment(
      ctx(),
      {
        title,
        startsAt: at(day, "09:00"),
        endsAt: at(day, "10:00"),
        ...over,
      },
      null,
    );
  const titles = () =>
    [...fake.ours(CALENDAR_ID).values()].map((e) => e.item!.summary).sort();

  async function setup(over: Parameters<typeof addTarget>[2] = {}) {
    connectCalendarSystem(ctx());
    return addTarget(ctx(), fake, over);
  }

  it("syncs the targets that are on, shortly after it starts, and none that are off", async () => {
    const on = await setup();
    const off = await addTarget(ctx(), fake, {
      calendarId: "calendar.off",
      enabled: false,
    });
    book("Kaminfeger");
    start();
    await waitFor(() => titles().length === 1);
    expect(getTargetRow(ctx(), on.id)).toMatchObject({ status: "ok" });
    expect(getTargetRow(ctx(), off.id)).toMatchObject({ status: "unknown" });
    expect(fake.get("calendar.off").events).toEqual([]);
  });

  it("does not sync a target whose connection is switched off", async () => {
    await setup();
    book("Kaminfeger");
    test.db.update(connections).set({ enabled: false }).run();
    start();
    await pause(100);
    expect(fake.calls).toEqual([{ step: "open" }]);
  });

  it("writes a change soon, without asking the calendar when nothing changed", async () => {
    await setup();
    book("Erster");
    start({ checkIntervalMs: 15, intervalMs: 1_000_000 });
    await waitFor(() => titles().length === 1);
    await pause(100);
    // Many ticks passed with nothing new: the calendar was not read again.
    expect(fake.callsOf("list")).toHaveLength(1);
    const reads = fake.callsOf("list").length;
    book("Zweiter");
    await waitFor(() => titles().length === 2);
    expect(fake.callsOf("list").length).toBeGreaterThan(reads);
  });

  it("reads the calendar again every interval, which is how a deleted event is noticed", async () => {
    const target = await setup();
    book("Kaminfeger");
    let now = NOW;
    start({
      checkIntervalMs: 15,
      intervalMs: 15 * MINUTE,
      clock: () => now,
    });
    await waitFor(() => titles().length === 1);
    fake.get(CALENDAR_ID).events = [];
    await pause(100);
    expect(titles()).toEqual([]);
    now += 16 * MINUTE;
    await waitFor(() => titles().length === 1);
    expect(getTargetRow(ctx(), target.id)!.lastCheckedAt).toEqual(
      new Date(now),
    );
  });

  it("looks again soon after a task is completed", async () => {
    await setup({ kinds: ["task_due"] });
    const task = await makeTask(ctx(), {
      title: "Filter wechseln",
      trigger: everyDays(30, "2026-06-20"),
    });
    start({ checkIntervalMs: 50 });
    await waitFor(() => titles().length === 1);
    const [first] = [...fake.ours(CALENDAR_ID).keys()];
    await completeTask(ctx(), task.id, {
      kind: "done",
      source: "manual",
      userId: null,
    });
    await waitFor(() => !fake.ours(CALENDAR_ID).has(first!));
    expect(fake.ours(CALENDAR_ID).size).toBe(1);
  });

  it("syncs a target at once when it is saved, backing off or not", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const target = await setup();
    fake.failNext("open", "unauthorized", 2);
    start({ firstRunDelayMs: 1_000_000 });
    // Saving (here: a change) triggers a run; the first fails.
    updateTarget(ctx(), ADMIN, target.id, { name: "Eins" });
    await waitFor(
      () => getTargetRow(ctx(), target.id)!.consecutiveFailures === 1,
    );
    // Backing off, a second save still runs at once.
    updateTarget(ctx(), ADMIN, target.id, { name: "Zwei" });
    await waitFor(
      () => getTargetRow(ctx(), target.id)!.consecutiveFailures === 2,
    );
    updateTarget(ctx(), ADMIN, target.id, { name: "Drei" });
    await waitFor(() => getTargetRow(ctx(), target.id)!.status === "ok");
  });

  it("does not run a target that is switched off by a change", async () => {
    const target = await setup();
    start({ firstRunDelayMs: 1_000_000 });
    updateTarget(ctx(), ADMIN, target.id, { enabled: false });
    await pause(80);
    expect(fake.callsOf("list")).toEqual([]);
  });

  it("backs off after a failure: 1 minute, then 2, until the calendar works again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const target = await setup();
    book("Kaminfeger");
    fake.failNext("open", "network", 2);
    let now = NOW;
    start({ checkIntervalMs: 15, intervalMs: 1_000, clock: () => now });
    await waitFor(
      () => getTargetRow(ctx(), target.id)!.consecutiveFailures === 1,
    );
    const calls = fake.calls.length;
    await pause(100);
    expect(fake.calls.length).toBe(calls);
    now += 61_000;
    await waitFor(
      () => getTargetRow(ctx(), target.id)!.consecutiveFailures === 2,
    );
    const second = fake.calls.length;
    await pause(60);
    now += 30_000;
    await pause(60);
    // Two failures: two minutes; 30 seconds later it is still too early.
    expect(fake.calls.length).toBe(second);
    now += 120_000;
    await waitFor(() => getTargetRow(ctx(), target.id)!.status === "ok");
    expect(titles()).toEqual(["Kaminfeger"]);
  });

  it("syncs the targets of a connection that was saved", async () => {
    const target = await setup();
    book("Kaminfeger");
    start({ firstRunDelayMs: 1_000_000 });
    emitEvent("connectionChanged", { ctx: ctx(), kind: "homeassistant" });
    await waitFor(() => titles().length === 1);
    expect(getTargetRow(ctx(), target.id)!.status).toBe("ok");
  });

  it("goes on at once with what a run had to leave, without waiting for the next tick", async () => {
    await setup();
    for (let i = 0; i < 5; i++) book(`T${i}`, `2026-06-2${i}`);
    start({ maxOperations: 2 });
    await waitFor(() => titles().length === 5);
    expect(fake.callsOf("create")).toHaveLength(5);
  });

  it("waits out the back-off after a run that failed with work left, instead of trying again at once", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const target = await setup();
    for (let i = 0; i < 3; i++) book(`T${i}`, `2026-06-2${i}`);
    fake.failNext("create", "network", 100);
    start({ checkIntervalMs: 10 });
    await waitFor(
      () => getTargetRow(ctx(), target.id)!.consecutiveFailures === 1,
    );
    await pause(150);
    expect(fake.callsOf("create")).toHaveLength(1);
    expect(getTargetRow(ctx(), target.id)!.consecutiveFailures).toBe(1);
  });

  it("does not lose a request that arrives while the target is being synced", async () => {
    const target = await setup();
    book("Kaminfeger");
    fake.delayMs = 40;
    start({ firstRunDelayMs: 1_000_000 });
    const manual = syncTarget(ctx(), target.id);
    await pause(10);
    emitEvent("calendarTargetChanged", { ctx: ctx(), targetId: target.id });
    expect((await manual).ok).toBe(true);
    const reads = fake.callsOf("list").length;
    // The scheduler found the target busy, and comes back for it.
    await waitFor(() => fake.callsOf("list").length > reads);
  });

  it("never runs two syncs at once", async () => {
    await setup();
    book("Kaminfeger");
    fake.delayMs = 30;
    start({ checkIntervalMs: 5, intervalMs: 1, kickDelayMs: 1 });
    await pause(250);
    expect(fake.maxActive).toBe(1);
    expect(titles()).toEqual(["Kaminfeger"]);
  });

  it("records a target with unreadable settings and still runs the others", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = await setup();
    const other = await addTarget(ctx(), fake, {
      calendarId: "calendar.other",
    });
    book("Kaminfeger");
    test.db
      .update(calendarTargets)
      .set({ configJson: { kinds: [] } })
      .where(eq(calendarTargets.id, broken.id))
      .run();
    start();
    await waitFor(() => getTargetRow(ctx(), other.id)!.status === "ok");
    expect(getTargetRow(ctx(), broken.id)).toMatchObject({
      status: "error",
      lastError: "config_invalid",
    });
    const logged = spy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("calendar_sync.config_invalid");
    expect(logged).not.toContain("Kaminfeger");
  });

  it("stops: nothing runs after the returned function was called", async () => {
    await setup();
    const stop = start({ firstRunDelayMs: 50 });
    stop();
    book("Kaminfeger");
    await pause(120);
    expect(titles()).toEqual([]);
  });
});
