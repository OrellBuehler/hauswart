import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import { createCalendarFeedRequestSchema } from "$lib/api/schemas/share";
import { createDefectRequestSchema } from "$lib/api/schemas/defects";
import {
  createAppointment,
  updateAppointment,
  type CreateAppointmentInput,
} from "$lib/server/appointments/appointments";
import { createAsset } from "$lib/server/assets/assets";
import { changeStatus, createDefect } from "$lib/server/defects/defects";
import { assets, taskState, tasks } from "$lib/server/db";
import { updateHousehold } from "$lib/server/household/household";
import { createRoom } from "$lib/server/rooms/rooms";
import {
  completePreparation,
  createPreparation,
} from "$lib/server/tasks/preparations";
import { snoozeTask } from "$lib/server/tasks/completions";
import { updateTask } from "$lib/server/tasks/tasks";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt, everyDays, makeTask, NOW } from "$lib/testing/domain";
import { parseIcs } from "$lib/testing/ics";
import { APPOINTMENT_LOOKBACK_DAYS, buildFeedCalendar } from "./feed";
import { createFeed, findFeedByToken } from "./feeds";

const ORIGIN = "https://hauswart.example.org";

describe("calendar feed content", () => {
  const test = useTestDB();
  const ctx = (now = NOW) => ctxAt(test.db, now);

  async function feedFor(
    userId: string,
    over: Record<string, unknown> = {},
    now = NOW,
  ) {
    const created = createFeed(
      ctx(),
      userId,
      createCalendarFeedRequestSchema.parse({ name: "Wohnung", ...over }),
    );
    const row = findFeedByToken(ctx(), created.token!)!;
    const built = await buildFeedCalendar(ctx(now), row, ORIGIN);
    return { ...built, parsed: parseIcs(built.ics), row };
  }
  const titles = (events: { summary: string }[]) =>
    events.map((e) => e.summary);

  it("is a valid empty calendar when nothing is due", async () => {
    const user = await createTestUser();
    const { ics, parsed } = await feedFor(user.id);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(parsed.events).toEqual([]);
    expect(parsed.name).toBe("Haushalt: Wohnung");
  });

  it("puts the next occurrence of a task on its due date, with place, url and stable uid", async () => {
    const user = await createTestUser();
    const room = createRoom(ctx(), { name: "Küche" });
    const asset = createAsset(
      ctx(),
      createAssetRequestSchema.parse({ name: "Dampfabzug", roomId: room.id }),
    );
    const task = await makeTask(ctx(), {
      title: "Filter wechseln",
      category: "filter",
      assetId: asset.id,
      trigger: everyDays(30, "2026-06-20"),
    });
    const { parsed } = await feedFor(user.id);
    expect(parsed.events).toHaveLength(1);
    const [event] = parsed.events;
    const occurrence = test.db
      .select()
      .from(taskState)
      .where(eq(taskState.taskId, task.id))
      .get()!.occurrenceKey;
    expect(event).toMatchObject({
      uid: `task-${task.id}-${occurrence}@hauswart`,
      summary: "Filter wechseln",
      start: "20260620",
      end: "20260621",
      status: "CONFIRMED",
      url: `${ORIGIN}/tasks/${task.id}`,
      categories: "Filter",
      trigger: null,
    });
    expect(event.description).toBe("Gerät: Dampfabzug\nRaum: Küche");
  });

  it("puts the time limit of a counter task on its date, without needing a reading", async () => {
    const user = await createTestUser();
    await makeTask(ctx(), {
      title: "Service",
      trigger: {
        v: 1,
        type: "counter_delta",
        entityId: "odometer:example-car",
        threshold: 15_000,
        unit: "km",
        orEvery: { every: 12, unit: "month" },
      },
    });
    const { parsed } = await feedFor(user.id);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]).toMatchObject({
      summary: "Service",
      start: "20270615",
      status: "CONFIRMED",
    });
  });

  it("shows overdue tasks on their (past) due date", async () => {
    const user = await createTestUser();
    await makeTask(ctx(), { trigger: everyDays(30, "2026-06-01") });
    const { parsed } = await feedFor(user.id);
    expect(parsed.events.map((e) => e.start)).toEqual(["20260601"]);
  });

  it("spans the window of a minimum-per-period task", async () => {
    const user = await createTestUser();
    await makeTask(ctx(), {
      title: "Zweimal lüften",
      trigger: { v: 1, type: "min_per_period", period: "month", count: 2 },
    });
    const { parsed } = await feedFor(user.id);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]).toMatchObject({
      start: "20260601",
      end: "20260701",
    });
    expect(parsed.events[0].description).toContain("2026-06-01 bis 2026-06-30");
  });

  it("leaves out tasks without a date, snoozed, archived and one-off done ones", async () => {
    const user = await createTestUser();
    await makeTask(ctx(), {
      title: "Ohne Datum",
      trigger: {
        v: 1,
        type: "state_condition",
        entityId: "sensor.example",
        op: "gt",
        value: 5,
      },
    });
    const snoozed = await makeTask(ctx(), {
      title: "Pausiert",
      trigger: everyDays(30, "2026-06-20"),
    });
    await snoozeTask(ctx(), snoozed.id, "2026-06-25");
    const archived = await makeTask(ctx(), {
      title: "Archiviert",
      trigger: everyDays(30, "2026-06-21"),
    });
    await updateTask(ctx(), archived.id, { archived: true });
    await makeTask(ctx(), {
      title: "Aktiv",
      trigger: everyDays(30, "2026-06-22"),
    });
    const { parsed } = await feedFor(user.id);
    expect(titles(parsed.events)).toEqual(["Aktiv"]);
  });

  describe("scope", () => {
    it("mine = assigned to the owner or to nobody; all = every task", async () => {
      const [anna, ben] = [await createTestUser(), await createTestUser()];
      await makeTask(ctx(), {
        title: "Von Anna",
        assignMode: "fixed",
        assigneeUserId: anna.id,
        trigger: everyDays(30, "2026-06-20"),
      });
      await makeTask(ctx(), {
        title: "Von Ben",
        assignMode: "fixed",
        assigneeUserId: ben.id,
        trigger: everyDays(30, "2026-06-21"),
      });
      await makeTask(ctx(), {
        title: "Von niemandem",
        trigger: everyDays(30, "2026-06-22"),
      });
      expect(titles((await feedFor(anna.id)).parsed.events)).toEqual([
        "Von Anna",
        "Von niemandem",
      ]);
      expect(titles((await feedFor(ben.id)).parsed.events)).toEqual([
        "Von Ben",
        "Von niemandem",
      ]);
      expect(
        titles((await feedFor(anna.id, { scope: "all" })).parsed.events),
      ).toEqual(["Von Anna", "Von Ben", "Von niemandem"]);
    });

    it("follows a rotating assignee", async () => {
      const [anna, ben] = [await createTestUser(), await createTestUser()];
      await makeTask(ctx(), {
        title: "Wechselnd",
        assignMode: "rotate",
        rotationOrder: [ben.id, anna.id],
        trigger: everyDays(30, "2026-06-20"),
      });
      expect((await feedFor(ben.id)).parsed.events).toHaveLength(1);
      expect((await feedFor(anna.id)).parsed.events).toHaveLength(0);
    });
  });

  describe("estimated dates", () => {
    async function estimatedTask(estimate: {
      date: string;
      confidence: "low" | "medium";
    }) {
      const task = await makeTask(ctx(), {
        title: "Batterie",
        trigger: everyDays(90, "2026-12-01"),
      });
      test.db
        .update(taskState)
        .set({ dueDate: null, dueKind: "estimated", estimateJson: estimate })
        .where(eq(taskState.taskId, task.id))
        .run();
      return task;
    }

    it("a hard time limit stays in the calendar, exact, when the counter is expected to get there first", async () => {
      const user = await createTestUser();
      const task = await estimatedTask({
        date: "2026-07-01",
        confidence: "medium",
      });
      test.db
        .update(taskState)
        .set({ dueDate: "2026-12-01" })
        .where(eq(taskState.taskId, task.id))
        .run();
      for (const includeEstimated of [false, true]) {
        const { parsed } = await feedFor(user.id, { includeEstimated });
        expect(parsed.events).toHaveLength(1);
        expect(parsed.events[0]).toMatchObject({
          summary: "Batterie",
          start: "20261201",
        });
        expect(parsed.events[0].status).not.toBe("TENTATIVE");
      }
    });

    it("are left out unless the feed asks for them", async () => {
      const user = await createTestUser();
      await estimatedTask({ date: "2026-07-01", confidence: "medium" });
      expect((await feedFor(user.id)).parsed.events).toEqual([]);
    });

    it("show as tentative with a tilde, without alarm", async () => {
      const user = await createTestUser();
      await estimatedTask({ date: "2026-07-01", confidence: "medium" });
      const { parsed } = await feedFor(user.id, {
        includeEstimated: true,
        alarmTime: "18:00",
        alarmDaysBefore: 1,
      });
      expect(parsed.events).toHaveLength(1);
      expect(parsed.events[0]).toMatchObject({
        summary: "~ Batterie",
        status: "TENTATIVE",
        start: "20260701",
        trigger: null,
      });
      expect(parsed.events[0].description).toContain("Geschätzter Termin");
    });

    it("need medium confidence and a date within 45 days", async () => {
      const user = await createTestUser();
      await estimatedTask({ date: "2026-07-01", confidence: "low" });
      expect(
        (await feedFor(user.id, { includeEstimated: true })).parsed.events,
      ).toEqual([]);
      test.db
        .update(taskState)
        .set({
          estimateJson: { date: "2026-07-30", confidence: "medium" },
        })
        .run();
      expect(
        (await feedFor(user.id, { includeEstimated: true })).parsed.events,
      ).toHaveLength(1);
      test.db
        .update(taskState)
        .set({
          estimateJson: { date: "2026-07-31", confidence: "medium" },
        })
        .run();
      expect(
        (await feedFor(user.id, { includeEstimated: true })).parsed.events,
      ).toEqual([]);
    });
  });

  describe("preparations", () => {
    async function withPrep() {
      const task = await makeTask(ctx(), {
        title: "Heizung warten",
        trigger: everyDays(30, "2026-06-20"),
      });
      const prep = await createPreparation(ctx(), task.id, {
        title: "Termin vereinbaren",
        kind: "generic",
        leadDays: 3,
        qty: 1,
      });
      return { task, prep };
    }

    it("appear on the day they become relevant", async () => {
      const user = await createTestUser();
      const { task, prep } = await withPrep();
      const { parsed } = await feedFor(user.id);
      const event = parsed.events.find((e) => e.uid.startsWith("prep-"))!;
      expect(event).toMatchObject({
        summary: "Vorbereiten: Termin vereinbaren",
        start: "20260617",
        end: "20260618",
        url: `${ORIGIN}/tasks/${task.id}`,
      });
      expect(event.uid).toContain(prep.id);
      expect(event.description).toContain("Für: Heizung warten");
      expect(parsed.events).toHaveLength(2);
    });

    it("can be switched off, and disappear once done", async () => {
      const user = await createTestUser();
      const { task, prep } = await withPrep();
      expect(
        (await feedFor(user.id, { includePreparations: false })).parsed.events,
      ).toHaveLength(1);
      await completePreparation(ctx(), task.id, prep.id, { userId: user.id });
      expect((await feedFor(user.id)).parsed.events).toHaveLength(1);
    });

    it("follow their task's scope", async () => {
      const [anna, ben] = [await createTestUser(), await createTestUser()];
      const task = await makeTask(ctx(), {
        assignMode: "fixed",
        assigneeUserId: ben.id,
        trigger: everyDays(30, "2026-06-20"),
      });
      await createPreparation(ctx(), task.id, {
        title: "Vorbereiten",
        kind: "generic",
        leadDays: 2,
        qty: 1,
      });
      expect((await feedFor(anna.id)).parsed.events).toEqual([]);
      expect((await feedFor(ben.id)).parsed.events).toHaveLength(2);
    });

    it("are tentative for an estimated task and skipped when the feed has no estimates", async () => {
      const user = await createTestUser();
      const task = await makeTask(ctx(), {
        title: "Batterie",
        trigger: everyDays(90, "2026-12-01"),
      });
      await createPreparation(ctx(), task.id, {
        title: "Bestellen",
        kind: "generic",
        leadDays: 7,
        qty: 1,
      });
      test.db
        .update(taskState)
        .set({
          dueDate: null,
          dueKind: "estimated",
          estimateJson: { date: "2026-07-10", confidence: "medium" },
        })
        .where(eq(taskState.taskId, task.id))
        .run();
      expect((await feedFor(user.id)).parsed.events).toEqual([]);
      const { parsed } = await feedFor(user.id, { includeEstimated: true });
      expect(parsed.events.map((e) => [e.summary, e.start, e.status])).toEqual([
        ["~ Vorbereiten: Bestellen", "20260703", "TENTATIVE"],
        ["~ Batterie", "20260710", "TENTATIVE"],
      ]);
    });
  });

  describe("defects", () => {
    const defect = (over: Record<string, unknown> = {}) =>
      createDefect(
        ctx(),
        createDefectRequestSchema.parse({
          title: "Riss in der Wand",
          deadlineDate: "2026-07-01",
          ...over,
        }),
        null,
      );

    it("shows the deadline once: the reminder task is replaced by the defect event", async () => {
      const user = await createTestUser();
      const room = createRoom(ctx(), { name: "Bad" });
      const d = await defect({ roomId: room.id });
      const { parsed } = await feedFor(user.id);
      expect(parsed.events).toHaveLength(1);
      expect(parsed.events[0]).toMatchObject({
        uid: `defect-${d.id}-deadline@hauswart`,
        summary: "Mängelfrist 1: Riss in der Wand",
        start: "20260701",
        url: `${ORIGIN}/defects/${d.id}`,
      });
      expect(parsed.events[0].description).toBe("Raum: Bad");
    });

    it("can be switched off (reminder task included) and ends with the defect", async () => {
      const user = await createTestUser();
      const d = await defect();
      expect(
        (await feedFor(user.id, { includeDefects: false })).parsed.events,
      ).toEqual([]);
      await changeStatus(ctx(), d.id, { status: "fixed" }, null);
      expect((await feedFor(user.id)).parsed.events).toEqual([]);
    });

    it("skips defects without a deadline", async () => {
      const user = await createTestUser();
      await defect({ deadlineDate: null });
      expect((await feedFor(user.id)).parsed.events).toEqual([]);
    });
  });

  describe("warranties", () => {
    const asset = (name: string, over: Record<string, unknown>) =>
      createAsset(ctx(), createAssetRequestSchema.parse({ name, ...over }));

    it("lists expiries within a year, the extended date wins", async () => {
      const user = await createTestUser();
      const room = createRoom(ctx(), { name: "Küche" });
      const geschirr = asset("Geschirrspüler", {
        roomId: room.id,
        warrantyUntil: "2026-09-01",
        warrantyExtendedUntil: "2026-12-01",
      });
      asset("Kühlschrank", { warrantyUntil: "2027-06-15" });
      asset("Backofen", { warrantyUntil: "2027-06-16" });
      asset("Altgerät", { warrantyUntil: "2026-06-14" });
      asset("Ohne Garantie", {});
      const { parsed } = await feedFor(user.id);
      expect(parsed.events.map((e) => [e.summary, e.start])).toEqual([
        ["Garantie läuft ab: Geschirrspüler", "20261201"],
        ["Garantie läuft ab: Kühlschrank", "20270615"],
      ]);
      expect(parsed.events[0]).toMatchObject({
        uid: `warranty-${geschirr.id}@hauswart`,
        url: `${ORIGIN}/assets/${geschirr.id}`,
      });
      expect(parsed.events[0].description).toBe(
        "Raum: Küche\nGarantie bis 2026-12-01",
      );
    });

    it("can be switched off and skips archived assets", async () => {
      const user = await createTestUser();
      const a = asset("Geschirrspüler", { warrantyUntil: "2026-09-01" });
      expect(
        (await feedFor(user.id, { includeWarranties: false })).parsed.events,
      ).toEqual([]);
      test.db
        .update(assets)
        .set({ archivedAt: new Date(NOW) })
        .where(eq(assets.id, a.id))
        .run();
      expect((await feedFor(user.id)).parsed.events).toEqual([]);
    });
  });

  describe("appointments", () => {
    const book = (over: Partial<CreateAppointmentInput> = {}) =>
      createAppointment(
        ctx(),
        {
          title: "Kaminfeger",
          startsAt: at("2026-06-20", "09:00"),
          endsAt: at("2026-06-20", "10:30"),
          ...over,
        },
        null,
      );
    const bookAllDay = (over: Partial<CreateAppointmentInput> = {}) =>
      book({
        allDay: true,
        startDate: "2026-06-22",
        startsAt: undefined,
        endsAt: undefined,
        ...over,
      });

    it("puts a timed appointment in as UTC instants with its place, link and a stable uid", async () => {
      const user = await createTestUser();
      const heater = createAsset(
        ctx(),
        createAssetRequestSchema.parse({ name: "Heizung" }),
      );
      const task = await makeTask(ctx(), {
        title: "Heizung warten",
        trigger: everyDays(30, "2026-07-20"),
      });
      const a = book({
        location: "Keller, Tür hinten",
        assetId: heater.id,
        taskId: task.id,
      });
      const { parsed } = await feedFor(user.id);
      const event = parsed.events.find((e) =>
        e.uid.startsWith("appointment-"),
      )!;
      expect(event).toMatchObject({
        uid: `appointment-${a.id}@hauswart`,
        summary: "Kaminfeger",
        startsAt: "20260620T070000Z",
        endsAt: "20260620T083000Z",
        start: "",
        end: "",
        location: "Keller, Tür hinten",
        status: "CONFIRMED",
        transp: "OPAQUE",
        url: `${ORIGIN}/appointments/${a.id}`,
        categories: "",
        trigger: null,
      });
      expect(event.description).toBe("Gerät: Heizung\nFür: Heizung warten");
    });

    it("puts an all-day appointment in as dates with an exclusive end", async () => {
      const user = await createTestUser();
      bookAllDay({ title: "Maler", endDate: "2026-06-24" });
      bookAllDay({ title: "Lieferung", startDate: "2026-06-25" });
      const { parsed } = await feedFor(user.id);
      expect(
        parsed.events.map((e) => [e.summary, e.start, e.end, e.startsAt]),
      ).toEqual([
        ["Maler", "20260622", "20260625", ""],
        ["Lieferung", "20260625", "20260626", ""],
      ]);
      expect(parsed.events[0].transp).toBe("TRANSPARENT");
    });

    it("leaves out cancelled appointments and brings them back when reopened", async () => {
      const user = await createTestUser();
      const a = book();
      updateAppointment(ctx(), a.id, { status: "cancelled" });
      expect((await feedFor(user.id)).parsed.events).toEqual([]);
      updateAppointment(ctx(), a.id, { status: "planned" });
      expect((await feedFor(user.id)).parsed.events).toHaveLength(1);
    });

    it("keeps a done appointment, without an alarm", async () => {
      const user = await createTestUser();
      book({ title: "Geplant" });
      const done = book({
        title: "Erledigt",
        startsAt: at("2026-06-21", "09:00"),
        endsAt: at("2026-06-21", "10:00"),
      });
      updateAppointment(ctx(), done.id, { status: "done" });
      const { parsed } = await feedFor(user.id, {
        alarmTime: "08:00",
      });
      expect(parsed.events.map((e) => [e.summary, e.trigger])).toEqual([
        ["Geplant", "-PT1H"],
        ["Erledigt", null],
      ]);
    });

    it("keeps an appointment for 30 days after it is over", async () => {
      const user = await createTestUser();
      const lookback = NOW - APPOINTMENT_LOOKBACK_DAYS * 86_400_000;
      expect(APPOINTMENT_LOOKBACK_DAYS).toBe(30);
      book({
        title: "Vor 31 Tagen",
        startsAt: at("2026-05-15", "09:00"),
        endsAt: at("2026-05-15", "10:00"),
      });
      book({
        title: "Vor 29 Tagen",
        startsAt: at("2026-05-17", "09:00"),
        endsAt: at("2026-05-17", "10:00"),
      });
      book({
        title: "Endet genau an der Grenze",
        startsAt: lookback - 3_600_000,
        endsAt: lookback,
      });
      book({
        title: "Endet kurz davor",
        startsAt: lookback - 3_600_000,
        endsAt: lookback - 1,
      });
      bookAllDay({ title: "Ganztags vor 31 Tagen", startDate: "2026-05-15" });
      bookAllDay({ title: "Ganztags am Rand", startDate: "2026-05-16" });
      const { parsed } = await feedFor(user.id);
      expect(titles(parsed.events).sort()).toEqual(
        [
          "Vor 29 Tagen",
          "Endet genau an der Grenze",
          "Ganztags am Rand",
        ].sort(),
      );
    });

    it("keeps one that is far ahead", async () => {
      const user = await createTestUser();
      bookAllDay({ title: "Weit weg", startDate: "2028-02-29" });
      expect(titles((await feedFor(user.id)).parsed.events)).toEqual([
        "Weit weg",
      ]);
    });

    describe("scope", () => {
      it("mine = without a task, of an unassigned task or of a task assigned to the owner; all = every appointment", async () => {
        const [anna, ben] = [await createTestUser(), await createTestUser()];
        const annas = await makeTask(ctx(), {
          assignMode: "fixed",
          assigneeUserId: anna.id,
          trigger: everyDays(30, "2026-07-20"),
        });
        const bens = await makeTask(ctx(), {
          assignMode: "fixed",
          assigneeUserId: ben.id,
          trigger: everyDays(30, "2026-07-20"),
        });
        const shared = await makeTask(ctx(), {
          trigger: everyDays(30, "2026-07-20"),
        });
        const rotating = await makeTask(ctx(), {
          assignMode: "rotate",
          rotationOrder: [ben.id, anna.id],
          trigger: everyDays(30, "2026-07-20"),
        });
        book({ title: "Ohne Aufgabe" });
        book({ title: "Von Anna", taskId: annas.id });
        book({ title: "Von Ben", taskId: bens.id });
        book({ title: "Gemeinsam", taskId: shared.id });
        book({ title: "Wechselnd", taskId: rotating.id });
        const mine = async (userId: string, over = {}) =>
          (await feedFor(userId, over)).parsed.events
            .filter((e) => e.uid.startsWith("appointment-"))
            .map((e) => e.summary)
            .sort();
        expect(await mine(anna.id)).toEqual(
          ["Gemeinsam", "Ohne Aufgabe", "Von Anna"].sort(),
        );
        expect(await mine(ben.id)).toEqual(
          ["Gemeinsam", "Ohne Aufgabe", "Von Ben", "Wechselnd"].sort(),
        );
        expect(await mine(anna.id, { scope: "all" })).toEqual(
          [
            "Gemeinsam",
            "Ohne Aufgabe",
            "Von Anna",
            "Von Ben",
            "Wechselnd",
          ].sort(),
        );
      });
    });

    describe("alarms", () => {
      it("ring before a timed appointment and before the midnight of an all-day one", async () => {
        const user = await createTestUser();
        book({
          title: "Morgens",
          startsAt: at("2026-06-20", "09:00"),
          endsAt: at("2026-06-20", "10:00"),
        });
        bookAllDay({ title: "Ganztags", startDate: "2026-06-21" });
        const { parsed } = await feedFor(user.id, {
          alarmTime: "18:00",
          alarmDaysBefore: 1,
        });
        expect(parsed.events.map((e) => [e.summary, e.trigger])).toEqual([
          ["Morgens", "-PT15H"],
          ["Ganztags", "-PT6H"],
        ]);
      });

      it("skip a timed appointment that starts before the alarm time", async () => {
        const user = await createTestUser();
        book({
          title: "Früh",
          startsAt: at("2026-06-20", "07:00"),
          endsAt: at("2026-06-20", "08:00"),
        });
        const { parsed, ics } = await feedFor(user.id, { alarmTime: "08:00" });
        expect(parsed.events).toHaveLength(1);
        expect(ics).not.toContain("VALARM");
      });
    });

    describe("the days the clocks change", () => {
      it("keeps the real instants of an appointment across the jump forward", async () => {
        const user = await createTestUser();
        // 01:30 CET to 03:30 CEST on 2026-03-29 is one real hour.
        book({
          startsAt: at("2026-03-29", "01:30"),
          endsAt: at("2026-03-29", "03:30"),
        });
        const { parsed } = await feedFor(
          user.id,
          { alarmTime: "18:00", alarmDaysBefore: 1 },
          at("2026-03-20", "12:00"),
        );
        expect(parsed.events[0]).toMatchObject({
          startsAt: "20260329T003000Z",
          endsAt: "20260329T013000Z",
          trigger: "-PT7H30M",
        });
      });

      it("counts the alarm of a Monday appointment from the Saturday evening in real hours", async () => {
        const user = await createTestUser();
        book({
          startsAt: at("2026-03-30", "08:00"),
          endsAt: at("2026-03-30", "09:00"),
        });
        const { parsed } = await feedFor(
          user.id,
          { alarmTime: "18:00", alarmDaysBefore: 2 },
          at("2026-03-20", "12:00"),
        );
        expect(parsed.events[0].trigger).toBe("-PT37H");
      });

      it("keeps the real instants across the fall back and an all-day appointment on that day", async () => {
        const user = await createTestUser();
        // 2026-10-25 02:30 happens twice; the first (CEST) one is 00:30Z.
        book({
          startsAt: at("2026-10-25", "02:30"),
          endsAt: at("2026-10-25", "03:30"),
          title: "Doppelt",
        });
        bookAllDay({ title: "Ganztag", startDate: "2026-10-25" });
        const { parsed } = await feedFor(
          user.id,
          {},
          at("2026-10-20", "12:00"),
        );
        const doppelt = parsed.events.find((e) => e.summary === "Doppelt")!;
        expect(doppelt.startsAt).toBe("20261025T003000Z");
        expect(doppelt.endsAt).toBe("20261025T023000Z");
        const ganztag = parsed.events.find((e) => e.summary === "Ganztag")!;
        expect([ganztag.start, ganztag.end]).toEqual(["20261025", "20261026"]);
      });

      it("orders events by their date in the household zone", async () => {
        const user = await createTestUser();
        bookAllDay({ title: "Ganztag Sonntag", startDate: "2026-03-29" });
        bookAllDay({ title: "Ganztag Samstag", startDate: "2026-03-28" });
        // 23:30Z on the 28th is 00:30 on Sunday the 29th in Zurich.
        book({
          title: "Kurz nach Mitternacht",
          startsAt: Date.parse("2026-03-28T23:30:00Z"),
          endsAt: Date.parse("2026-03-29T00:15:00Z"),
        });
        const { parsed } = await feedFor(
          user.id,
          {},
          at("2026-03-26", "12:00"),
        );
        expect(titles(parsed.events)).toEqual([
          "Ganztag Samstag",
          "Ganztag Sonntag",
          "Kurz nach Mitternacht",
        ]);
      });
    });

    describe("privacy", () => {
      it("carries no notes, comments or contact", async () => {
        const user = await createTestUser();
        book({
          notes: "NOTIZ-GEHEIM\n:::secret\nCODE-GEHEIM\n:::",
          location: "Keller",
        });
        const { ics } = await feedFor(user.id);
        expect(ics).toContain("Kaminfeger");
        expect(ics).toContain("LOCATION:Keller");
        expect(ics).not.toContain("GEHEIM");
      });

      it("escapes what a title or location could use to inject properties", async () => {
        const user = await createTestUser();
        book({
          title: "Test\r\nATTENDEE:mailto:evil@example.org",
          location: "Keller\nORGANIZER:mailto:evil@example.org",
        });
        const { ics } = await feedFor(user.id);
        expect(ics).not.toMatch(/^ATTENDEE:/m);
        expect(ics).not.toMatch(/^ORGANIZER:/m);
      });
    });

    describe("stability", () => {
      it("yields the same bytes whenever on the day it is built", async () => {
        const user = await createTestUser();
        book({ location: "Keller" });
        const first = await feedFor(user.id);
        const later = await buildFeedCalendar(
          ctx(at("2026-06-15", "20:00")),
          first.row,
          ORIGIN,
        );
        expect(later.ics).toBe(first.ics);
        expect(later.etag).toBe(first.etag);
      });

      it("raises SEQUENCE and moves LAST-MODIFIED with every change, a status change included", async () => {
        const user = await createTestUser();
        const a = book();
        const before = await feedFor(user.id);
        updateAppointment(ctx(NOW + 5 * 60_000), a.id, {
          location: "Dachboden",
        });
        const edited = await buildFeedCalendar(ctx(), before.row, ORIGIN);
        const [one] = before.parsed.events;
        const [two] = parseIcs(edited.ics).events;
        expect(two.uid).toBe(one.uid);
        expect(two.location).toBe("Dachboden");
        expect(two.sequence).toBe(one.sequence + 5);
        expect(two.lastModified > one.lastModified).toBe(true);
        expect(edited.etag).not.toBe(before.etag);

        updateAppointment(ctx(NOW + 9 * 60_000), a.id, { status: "done" });
        const done = parseIcs(
          (await buildFeedCalendar(ctx(), before.row, ORIGIN)).ics,
        ).events[0];
        expect(done.sequence).toBe(one.sequence + 9);
      });
    });

    it("writes English texts for an English feed", async () => {
      const user = await createTestUser();
      const heater = createAsset(
        ctx(),
        createAssetRequestSchema.parse({ name: "Heating" }),
      );
      const task = await makeTask(ctx(), {
        title: "Service",
        trigger: everyDays(30, "2026-07-20"),
      });
      book({ assetId: heater.id, taskId: task.id });
      const { parsed } = await feedFor(user.id, { locale: "en" });
      expect(parsed.events[0].description).toBe(
        "Device: Heating\nFor: Service",
      );
    });
  });

  describe("alarms", () => {
    it("rings the evening before at the given time", async () => {
      const user = await createTestUser();
      await makeTask(ctx(), { trigger: everyDays(30, "2026-06-20") });
      const { parsed } = await feedFor(user.id, {
        alarmTime: "18:00",
        alarmDaysBefore: 1,
      });
      expect(parsed.events[0].trigger).toBe("-PT6H");
    });

    it("rings in the morning of the day itself", async () => {
      const user = await createTestUser();
      await makeTask(ctx(), { trigger: everyDays(30, "2026-06-20") });
      const { parsed } = await feedFor(user.id, { alarmTime: "08:30" });
      expect(parsed.events[0].trigger).toBe("PT8H30M");
    });

    it("covers preparations, defects and warranties, never estimates", async () => {
      const user = await createTestUser();
      createAsset(
        ctx(),
        createAssetRequestSchema.parse({
          name: "Herd",
          warrantyUntil: "2026-09-01",
        }),
      );
      await createDefect(
        ctx(),
        createDefectRequestSchema.parse({
          title: "Fleck",
          deadlineDate: "2026-07-01",
        }),
        null,
      );
      const { parsed } = await feedFor(user.id, { alarmTime: "09:00" });
      expect(parsed.events).toHaveLength(2);
      expect(parsed.events.every((e) => e.trigger === "PT9H")).toBe(true);
    });

    it("has none without an alarm time", async () => {
      const user = await createTestUser();
      await makeTask(ctx(), { trigger: everyDays(30, "2026-06-20") });
      const { ics } = await feedFor(user.id, { alarmDaysBefore: 2 });
      expect(ics).not.toContain("VALARM");
    });
  });

  describe("privacy", () => {
    it("carries no descriptions, notes, serial numbers or comments", async () => {
      const user = await createTestUser();
      const asset = createAsset(
        ctx(),
        createAssetRequestSchema.parse({
          name: "Tresor",
          notes: "NOTIZ-GEHEIM",
          serialNumber: "SERIAL-GEHEIM",
          warrantyUntil: "2026-09-01",
        }),
      );
      await makeTask(ctx(), {
        title: "Code ändern",
        descriptionMd: "BESCHREIBUNG-GEHEIM\n\n:::secret\nCODE-GEHEIM\n:::",
        assetId: asset.id,
        trigger: everyDays(30, "2026-06-20"),
      });
      await createDefect(
        ctx(),
        createDefectRequestSchema.parse({
          title: "Kratzer",
          descriptionMd: "DEFEKT-GEHEIM",
          deadlineDate: "2026-07-01",
        }),
        null,
      );
      const { ics } = await feedFor(user.id);
      expect(ics).toContain("Code ändern");
      expect(ics).not.toContain("GEHEIM");
    });

    it("escapes what a title could use to inject properties", async () => {
      const user = await createTestUser();
      await makeTask(ctx(), {
        title: "Test\r\nATTENDEE:mailto:evil@example.org",
        trigger: everyDays(30, "2026-06-20"),
      });
      const { ics } = await feedFor(user.id);
      expect(ics).not.toMatch(/^ATTENDEE:/m);
    });
  });

  describe("locale", () => {
    it("writes English texts for an English feed", async () => {
      const user = await createTestUser();
      const room = createRoom(ctx(), { name: "Kitchen" });
      const task = await makeTask(ctx(), {
        title: "Replace filter",
        category: "maintenance",
        roomId: room.id,
        trigger: everyDays(30, "2026-06-20"),
      });
      await createPreparation(ctx(), task.id, {
        title: "Buy filter",
        kind: "generic",
        leadDays: 1,
        qty: 1,
      });
      const { parsed, ics } = await feedFor(user.id, { locale: "en" });
      expect(titles(parsed.events)).toEqual([
        "Prepare: Buy filter",
        "Replace filter",
      ]);
      expect(parsed.events[1].categories).toBe("Maintenance");
      expect(parsed.events[1].description).toBe("Room: Kitchen");
      expect(ics).toContain("PRODID:-//hauswart//calendar feed//EN");
    });

    it("names the calendar after the household", async () => {
      const user = await createTestUser();
      updateHousehold(ctx(), { name: "Haus Muster" });
      expect((await feedFor(user.id)).parsed.name).toBe("Haus Muster: Wohnung");
    });
  });

  describe("stability", () => {
    it("yields the same bytes and ETag however often and whenever on the day it is built", async () => {
      const user = await createTestUser();
      await makeTask(ctx(), { trigger: everyDays(30, "2026-06-20") });
      const first = await feedFor(user.id);
      const later = await buildFeedCalendar(
        ctx(at("2026-06-15", "20:00")),
        first.row,
        ORIGIN,
      );
      expect(later.ics).toBe(first.ics);
      expect(later.etag).toBe(first.etag);
      expect(first.etag).toMatch(/^"[0-9a-f]{64}"$/);
    });

    it("changes the ETag and raises SEQUENCE when a task is edited", async () => {
      const user = await createTestUser();
      const task = await makeTask(ctx(), {
        trigger: everyDays(30, "2026-06-20"),
      });
      test.db
        .update(tasks)
        .set({ updatedAt: new Date(NOW) })
        .where(eq(tasks.id, task.id))
        .run();
      const before = await feedFor(user.id);
      test.db
        .update(tasks)
        .set({ title: "Neu", updatedAt: new Date(NOW + 3 * 60_000) })
        .where(eq(tasks.id, task.id))
        .run();
      const after = await buildFeedCalendar(ctx(), before.row, ORIGIN);
      expect(after.etag).not.toBe(before.etag);
      const [old] = before.parsed.events;
      const [updated] = parseIcs(after.ics).events;
      expect(updated.uid).toBe(old.uid);
      expect(updated.summary).toBe("Neu");
      expect(updated.sequence).toBe(old.sequence + 3);
      expect(updated.dtstamp > old.dtstamp).toBe(true);
    });

    it("orders events by date, then uid", async () => {
      const user = await createTestUser();
      for (const [title, date] of [
        ["C", "2026-06-22"],
        ["A", "2026-06-20"],
        ["B", "2026-06-20"],
      ]) {
        await makeTask(ctx(), { title, trigger: everyDays(30, date) });
      }
      const { parsed } = await feedFor(user.id);
      expect(parsed.events.map((e) => e.start)).toEqual([
        "20260620",
        "20260620",
        "20260622",
      ]);
      const uids = parsed.events.slice(0, 2).map((e) => e.uid);
      expect(uids).toEqual([...uids].sort());
    });
  });
});
