import { afterEach, describe, expect, it } from "vitest";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import { createAsset } from "$lib/server/assets/assets";
import { createRoom } from "$lib/server/rooms/rooms";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt, everyDays, makeTask, NOW } from "$lib/testing/domain";
import { completeTask, snoozeTask, undoCompletion } from "./completions";
import { getDashboard } from "./dashboard";
import { createPreparation } from "./preparations";
import { setSignalProvider } from "./signals";
import { getStats } from "./stats";
import { updateTask } from "./tasks";

describe("dashboard", () => {
  const test = useTestDB();
  const ctx = (now = NOW) => ctxAt(test.db, now);
  afterEach(() => setSignalProvider(null));

  it("is empty on a fresh household", async () => {
    const d = await getDashboard(ctx());
    expect(d).toMatchObject({
      today: "2026-06-15",
      counts: { overdue: 0, today: 0, thisWeek: 0, preparations: 0 },
      upcoming: {
        overdue: [],
        today: [],
        thisWeek: [],
        later: [],
        signalBased: [],
      },
      preparations: [],
      recentCompletions: [],
    });
    expect(d.generatedAt.getTime()).toBe(NOW);
  });

  it("sorts tasks into overdue, today, this week and later, dropping what is too far off", async () => {
    await makeTask(ctx(), {
      title: "Überfällig",
      trigger: everyDays(30, "2026-06-10"),
    });
    await makeTask(ctx(), {
      title: "Heute",
      trigger: everyDays(30, "2026-06-15"),
    });
    await makeTask(ctx(), {
      title: "Diese Woche",
      trigger: everyDays(30, "2026-06-19"),
    });
    await makeTask(ctx(), {
      title: "Später",
      trigger: everyDays(30, "2026-07-20"),
    });
    await makeTask(ctx(), {
      title: "Zu weit",
      trigger: everyDays(30, "2026-12-01"),
    });
    const d = await getDashboard(ctx());
    const titles = (items: { title: string }[]) => items.map((i) => i.title);
    expect(titles(d.upcoming.overdue)).toEqual(["Überfällig"]);
    expect(titles(d.upcoming.today)).toEqual(["Heute"]);
    expect(titles(d.upcoming.thisWeek)).toEqual(["Diese Woche"]);
    expect(titles(d.upcoming.later)).toEqual(["Später"]);
    expect(d.counts).toMatchObject({ overdue: 1, today: 1, thisWeek: 1 });
  });

  it("describes each task with its asset, room and assignee", async () => {
    const anna = await createTestUser({ displayName: "Anna" });
    const room = createRoom(ctx(), { name: "Küche" });
    const asset = createAsset(
      ctx(),
      createAssetRequestSchema.parse({ name: "Dampfabzug", roomId: room.id }),
    );
    await makeTask(ctx(), {
      title: "Filter wechseln",
      category: "filter",
      priority: "high",
      assetId: asset.id,
      assignMode: "fixed",
      assigneeUserId: anna.id,
      trigger: everyDays(30, "2026-06-15"),
    });
    const [item] = (await getDashboard(ctx())).upcoming.today;
    expect(item).toMatchObject({
      title: "Filter wechseln",
      category: "filter",
      priority: "high",
      assetId: asset.id,
      assetName: "Dampfabzug",
      roomId: room.id,
      roomName: "Küche",
      assigneeUserId: anna.id,
      assigneeName: "Anna",
      status: "due",
      dueKind: "exact",
      date: "2026-06-15",
      estimated: false,
    });
  });

  it("prefers the task's own room over the asset's", async () => {
    const [kitchen, bath] = [
      createRoom(ctx(), { name: "Küche" }),
      createRoom(ctx(), { name: "Bad" }),
    ];
    const asset = createAsset(
      ctx(),
      createAssetRequestSchema.parse({
        name: "Dampfabzug",
        roomId: kitchen.id,
      }),
    );
    await makeTask(ctx(), {
      assetId: asset.id,
      roomId: bath.id,
      trigger: everyDays(30, "2026-06-15"),
    });
    expect((await getDashboard(ctx())).upcoming.today[0].roomName).toBe("Bad");
  });

  it("leaves out snoozed and archived tasks", async () => {
    const snoozed = await makeTask(ctx(), {
      title: "Schlummert",
      trigger: everyDays(30, "2026-06-16"),
    });
    await snoozeTask(ctx(), snoozed.id, "2026-06-30");
    const archived = await makeTask(ctx(), {
      title: "Archiv",
      trigger: everyDays(30, "2026-06-16"),
    });
    await updateTask(ctx(), archived.id, { archived: true });
    await makeTask(ctx(), {
      title: "Aktiv",
      trigger: everyDays(30, "2026-06-16"),
    });
    const d = await getDashboard(ctx());
    expect(d.upcoming.thisWeek.map((i) => i.title)).toEqual(["Aktiv"]);
  });

  it("shows tasks without a date as signal-based", async () => {
    await makeTask(ctx(), {
      title: "Zähler",
      trigger: {
        v: 1,
        type: "counter_delta",
        entityId: "sensor.zaehler",
        threshold: 10,
      },
    });
    await makeTask(ctx(), {
      title: "Monatsziel",
      trigger: { v: 1, type: "min_per_period", period: "month", count: 3 },
    });
    const d = await getDashboard(ctx());
    expect(d.upcoming.signalBased.map((i) => i.title)).toEqual(["Zähler"]);
    expect(d.upcoming.signalBased[0]).toMatchObject({
      date: null,
      status: "unknown",
    });
  });

  it("lists preparations that have become relevant", async () => {
    const soon = await makeTask(ctx(), {
      title: "Filter wechseln",
      trigger: everyDays(30, "2026-06-25"),
    });
    await createPreparation(ctx(), soon.id, {
      title: "Filter bestellen",
      kind: "generic",
      leadDays: 14,
      qty: 1,
    });
    await createPreparation(ctx(), soon.id, {
      title: "Später",
      kind: "generic",
      leadDays: 3,
      qty: 1,
    });
    const snoozed = await makeTask(ctx(), {
      title: "Schlummert",
      trigger: everyDays(30, "2026-06-25"),
    });
    await createPreparation(ctx(), snoozed.id, {
      title: "Still",
      kind: "generic",
      leadDays: 14,
      qty: 1,
    });
    await snoozeTask(ctx(), snoozed.id, "2026-07-30");
    const d = await getDashboard(ctx());
    expect(d.preparations).toEqual([
      {
        taskId: soon.id,
        taskTitle: "Filter wechseln",
        prepId: expect.any(String),
        title: "Filter bestellen",
        state: "now",
        date: "2026-06-25",
      },
    ]);
    expect(d.counts.preparations).toBe(1);
  });

  it("shows the last 10 completions with who, when and how", async () => {
    const anna = await createTestUser({ displayName: "Anna" });
    const task = await makeTask(ctx(), {
      title: "Putzen",
      trigger: everyDays(1, "2026-06-01"),
    });
    for (let i = 0; i < 12; i += 1) {
      await completeTask(ctx(), task.id, {
        kind: "done",
        source: i === 11 ? "qr" : "manual",
        userId: anna.id,
        completedAt: NOW - (11 - i) * 60_000,
      });
    }
    const { recentCompletions } = await getDashboard(ctx());
    expect(recentCompletions).toHaveLength(10);
    expect(recentCompletions[0]).toMatchObject({
      taskTitle: "Putzen",
      userName: "Anna",
      source: "qr",
    });
    expect(recentCompletions[0].completedAt.getTime()).toBe(NOW);
  });

  it("follows the household's today", async () => {
    await makeTask(ctx(), { title: "T", trigger: everyDays(30, "2026-06-16") });
    expect((await getDashboard(ctx())).upcoming.thisWeek).toHaveLength(1);
    const later = await getDashboard(ctx(at("2026-06-17")));
    expect(later.upcoming.thisWeek).toHaveLength(0);
    expect(later.upcoming.overdue).toHaveLength(1);
  });
});

describe("stats", () => {
  const test = useTestDB();
  const ctx = (now = NOW) => ctxAt(test.db, now);

  it("counts completions per person and category, with on-time shares", async () => {
    const [anna, ben] = [await createTestUser(), await createTestUser()];
    const cleaning = await makeTask(ctx(), {
      category: "cleaning",
      trigger: everyDays(1, "2026-06-01"),
    });
    const filter = await makeTask(ctx(), {
      category: "filter",
      trigger: everyDays(30, "2026-06-10"),
    });
    await completeTask(ctx(), cleaning.id, {
      kind: "done",
      source: "manual",
      userId: anna.id,
    });
    await completeTask(ctx(), cleaning.id, {
      kind: "done",
      source: "manual",
      userId: anna.id,
    });
    await completeTask(ctx(), cleaning.id, {
      kind: "skipped",
      source: "manual",
      userId: ben.id,
    });
    await completeTask(ctx(), filter.id, {
      kind: "done",
      source: "manual",
      userId: ben.id,
    });
    const stats = getStats(ctx(), {});
    expect(stats).toMatchObject({ from: "2026-03-18", to: "2026-06-15" });
    expect(stats.total).toMatchObject({ done: 3, skipped: 1 });
    expect(stats.byUser[anna.id]).toMatchObject({ done: 2, skipped: 0 });
    expect(stats.byUser[ben.id]).toMatchObject({
      done: 1,
      skipped: 1,
      onTimeShare: 0,
    });
    expect(stats.byCategory.cleaning).toMatchObject({ done: 2, skipped: 1 });
    expect(stats.byCategory.filter).toMatchObject({ done: 1 });
  });

  it("respects the date range and ignores undone completions", async () => {
    const task = await makeTask(ctx(), { trigger: everyDays(1, "2026-06-01") });
    await completeTask(ctx(), task.id, {
      kind: "done",
      source: "manual",
      userId: null,
      completedAt: at("2026-05-01"),
    });
    const { completion } = await completeTask(ctx(), task.id, {
      kind: "done",
      source: "manual",
      userId: null,
      completedAt: at("2026-06-10"),
    });
    await completeTask(ctx(), task.id, {
      kind: "done",
      source: "manual",
      userId: null,
      completedAt: at("2026-06-12"),
    });
    expect(
      getStats(ctx(), { from: "2026-06-01", to: "2026-06-30" }).total.done,
    ).toBe(2);
    expect(
      getStats(ctx(), { from: "2026-05-01", to: "2026-05-31" }).total.done,
    ).toBe(1);
    expect(
      getStats(ctx(), { from: "2026-06-10", to: "2026-06-10" }).total.done,
    ).toBe(1);
    const user = await createTestUser();
    await undoCompletion(ctx(), completion.id, user.id);
    expect(
      getStats(ctx(), { from: "2026-06-01", to: "2026-06-30" }).total.done,
    ).toBe(1);
  });

  it("attributes completions without a person to the unassigned bucket", async () => {
    const task = await makeTask(ctx());
    await completeTask(ctx(), task.id, {
      kind: "done",
      source: "ha",
      userId: null,
    });
    expect(getStats(ctx(), {}).byUser._unassigned.done).toBe(1);
  });

  it("is empty without completions", () => {
    expect(getStats(ctx(), {}).total).toEqual({
      done: 0,
      skipped: 0,
      onTime: 0,
      measurable: 0,
      onTimeShare: null,
    });
  });

  it("rejects backwards and oversized ranges", () => {
    expect(() =>
      getStats(ctx(), { from: "2026-06-10", to: "2026-06-01" }),
    ).toThrow("Invalid request");
    expect(() =>
      getStats(ctx(), { from: "2020-01-01", to: "2026-06-01" }),
    ).toThrow("Invalid request");
  });
});
