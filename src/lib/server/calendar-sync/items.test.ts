import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { CalendarItemKind } from "$lib/api/enums";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import { calendarTargetConfigSchema } from "$lib/api/schemas/calendar-sync";
import { createDefectRequestSchema } from "$lib/api/schemas/defects";
import { createInsurancePolicyRequestSchema } from "$lib/api/schemas/insurance";
import {
  createAppointment,
  updateAppointment,
  type CreateAppointmentInput,
} from "$lib/server/appointments/appointments";
import { createAsset } from "$lib/server/assets/assets";
import { appointments, assets, insurancePolicies, tasks } from "$lib/server/db";
import { createDefect } from "$lib/server/defects/defects";
import { createPolicy } from "$lib/server/insurance/policies";
import { createRoom } from "$lib/server/rooms/rooms";
import { createPreparation } from "$lib/server/tasks/preparations";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt, everyDays, makeTask, NOW } from "$lib/testing/domain";
import {
  buildDesiredItems,
  horizon,
  itemHash,
  readRange,
  type DesiredItem,
} from "./items";

const HIDDEN = "GEHEIM-NOTIZ-4711";

describe("buildDesiredItems", () => {
  const test = useTestDB();
  const ctx = (now = NOW) => ctxAt(test.db, now);

  const config = (
    kinds: CalendarItemKind[],
    over: Record<string, unknown> = {},
  ) => calendarTargetConfigSchema.parse({ kinds, ...over });
  const items = (
    kinds: CalendarItemKind[],
    over: Record<string, unknown> = {},
    userId: string | null = null,
    now = NOW,
  ) => buildDesiredItems(ctx(now), { config: config(kinds, over), userId });
  const summaries = (list: DesiredItem[]) => list.map((i) => i.summary);

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

  describe("tasks", () => {
    it("puts the next occurrence on its due date as an all-day item with an exclusive end", async () => {
      const room = createRoom(ctx(), { name: "Küche" });
      const asset = createAsset(
        ctx(),
        createAssetRequestSchema.parse({ name: "Dampfabzug", roomId: room.id }),
      );
      const task = await makeTask(ctx(), {
        title: "Filter wechseln",
        assetId: asset.id,
        trigger: everyDays(30, "2026-06-20"),
      });
      const [item] = await items(["task_due"]);
      expect(item).toMatchObject({
        kind: "task_due",
        itemId: task.id,
        summary: "Filter wechseln",
        description: "Gerät: Dampfabzug\nRaum: Küche",
        location: null,
        when: { allDay: true, startDate: "2026-06-20", endDate: "2026-06-21" },
        path: `/tasks/${task.id}`,
        alarmMinutes: null,
      });
      expect(item!.ref).toBe(`task-${task.id}-${item!.instanceKey}`);
      expect(item!.instanceKey).not.toBe("");
    });

    it("can put due dates at a time of day instead, in the household zone", async () => {
      await makeTask(ctx(), {
        title: "Filter wechseln",
        trigger: everyDays(30, "2026-06-20"),
      });
      const [item] = await items(["task_due"], {
        timedMode: "timed",
        dueTime: "07:30",
        dueDurationMinutes: 45,
      });
      expect(item!.when).toEqual({
        allDay: false,
        startsAt: at("2026-06-20", "07:30"),
        endsAt: at("2026-06-20", "08:15"),
      });
    });

    it("follows the clocks: the same time of day is another instant after the night they change", async () => {
      await makeTask(ctx(), { trigger: everyDays(30, "2026-11-01") });
      await makeTask(ctx(), { trigger: everyDays(30, "2026-10-20") });
      const list = await items(["task_due"], {
        timedMode: "timed",
        dueTime: "08:00",
      });
      const starts = list.map((i) => (i.when.allDay ? 0 : i.when.startsAt));
      expect(starts).toEqual([
        at("2026-10-20", "08:00"),
        at("2026-11-01", "08:00"),
      ]);
      expect(starts[1]! - starts[0]!).toBe(12 * 86_400_000 + 3_600_000);
    });

    it("keeps the window of a minimum-per-period task as a span, even at a time of day", async () => {
      await makeTask(ctx(), {
        title: "Zweimal lüften",
        trigger: { v: 1, type: "min_per_period", period: "month", count: 2 },
      });
      for (const over of [{}, { timedMode: "timed" }]) {
        const [item] = await items(["task_due"], over);
        expect(item!.when).toEqual({
          allDay: true,
          startDate: "2026-06-01",
          endDate: "2026-07-01",
        });
        expect(item!.description).toContain("2026-06-01 bis 2026-06-30");
      }
    });

    it("writes the texts in the language of the target", async () => {
      const room = createRoom(ctx(), { name: "Küche" });
      const asset = createAsset(
        ctx(),
        createAssetRequestSchema.parse({ name: "Dampfabzug", roomId: room.id }),
      );
      await makeTask(ctx(), {
        title: "Mit Gerät",
        assetId: asset.id,
        trigger: everyDays(30, "2026-06-21"),
      });
      const list = await items(["task_due"], { locale: "en" });
      expect(list.find((i) => i.summary === "Mit Gerät")!.description).toBe(
        "Device: Dampfabzug\nRoom: Küche",
      );
    });

    it("leaves out snoozed, archived and undated tasks, and estimates", async () => {
      const snoozed = await makeTask(ctx(), {
        title: "Snoozed",
        trigger: everyDays(30, "2026-06-20"),
      });
      const archived = await makeTask(ctx(), {
        title: "Archived",
        trigger: everyDays(30, "2026-06-20"),
      });
      await makeTask(ctx(), {
        title: "Active",
        trigger: everyDays(30, "2026-06-20"),
      });
      test.db
        .update(tasks)
        .set({ snoozedUntil: "2026-07-01" })
        .where(eq(tasks.id, snoozed.id))
        .run();
      test.db
        .update(tasks)
        .set({ archivedAt: new Date(NOW) })
        .where(eq(tasks.id, archived.id))
        .run();
      expect(summaries(await items(["task_due"]))).toEqual(["Active"]);
    });

    it("applies the prefix to every title", async () => {
      await makeTask(ctx(), {
        title: "Filter wechseln",
        trigger: everyDays(30, "2026-06-20"),
      });
      book();
      expect(
        summaries(
          await items(["task_due", "appointments"], { titlePrefix: "[H] " }),
        ),
      ).toEqual(["[H] Filter wechseln", "[H] Kaminfeger"]);
    });

    it("scope mine is the owner's tasks and those of nobody; a household target sees all", async () => {
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
      expect(
        summaries(await items(["task_due"], { scope: "mine" }, anna.id)),
      ).toEqual(["Von Anna", "Von niemandem"]);
      expect(
        summaries(await items(["task_due"], { scope: "all" }, anna.id)),
      ).toHaveLength(3);
      expect(
        summaries(await items(["task_due"], { scope: "mine" }, null)),
      ).toHaveLength(3);
    });
  });

  describe("preparations", () => {
    it("come with the task's occurrence, on the day their lead time starts", async () => {
      const task = await makeTask(ctx(), {
        title: "Heizung warten",
        trigger: everyDays(30, "2026-06-30"),
      });
      await createPreparation(ctx(), task.id, {
        title: "Termin buchen",
        kind: "generic",
        leadDays: 10,
        qty: 1,
      });
      const only = await items(["preparations"]);
      expect(only).toHaveLength(1);
      expect(only[0]).toMatchObject({
        kind: "preparations",
        summary: "Vorbereiten: Termin buchen",
        description: "Für: Heizung warten",
        when: { allDay: true, startDate: "2026-06-20", endDate: "2026-06-21" },
        path: `/tasks/${task.id}`,
      });
      expect(only[0]!.ref).toMatch(/^prep-/);
      expect(summaries(await items(["task_due", "preparations"]))).toEqual([
        "Vorbereiten: Termin buchen",
        "Heizung warten",
      ]);
    });
  });

  describe("appointments", () => {
    it("keep their instants (timed) or dates with an exclusive end (all day), place and busy time", async () => {
      const heater = createAsset(
        ctx(),
        createAssetRequestSchema.parse({ name: "Heizung" }),
      );
      const task = await makeTask(ctx(), {
        title: "Heizung warten",
        trigger: everyDays(30, "2026-07-20"),
      });
      const timed = book({
        location: "Keller",
        assetId: heater.id,
        taskId: task.id,
      });
      const allDay = book({
        title: "Maler",
        allDay: true,
        startDate: "2026-06-22",
        endDate: "2026-06-23",
        startsAt: undefined,
        endsAt: undefined,
      });
      const list = await items(["appointments"]);
      expect(list.map((i) => [i.ref, i.summary, i.when, i.location])).toEqual([
        [
          `appointment-${timed.id}`,
          "Kaminfeger",
          {
            allDay: false,
            startsAt: at("2026-06-20", "09:00"),
            endsAt: at("2026-06-20", "10:30"),
          },
          "Keller",
        ],
        [
          `appointment-${allDay.id}`,
          "Maler",
          { allDay: true, startDate: "2026-06-22", endDate: "2026-06-24" },
          null,
        ],
      ]);
      expect(list[0]!.description).toBe("Gerät: Heizung\nFür: Heizung warten");
      expect(list[0]!.path).toBe(`/appointments/${timed.id}`);
    });

    it("leave out cancelled ones and take them back when reopened", async () => {
      const a = book();
      updateAppointment(ctx(), a.id, { status: "cancelled" });
      expect(await items(["appointments"])).toEqual([]);
      updateAppointment(ctx(), a.id, { status: "planned" });
      expect(await items(["appointments"])).toHaveLength(1);
    });

    it("scope mine leaves out those of a task somebody else does", async () => {
      const [anna, ben] = [await createTestUser(), await createTestUser()];
      const task = await makeTask(ctx(), {
        title: "Von Ben",
        assignMode: "fixed",
        assigneeUserId: ben.id,
        trigger: everyDays(30, "2026-07-20"),
      });
      book({ title: "Ohne Aufgabe" });
      book({ title: "Von Bens Aufgabe", taskId: task.id });
      expect(
        summaries(await items(["appointments"], { scope: "mine" }, anna.id)),
      ).toEqual(["Ohne Aufgabe"]);
      expect(
        summaries(await items(["appointments"], { scope: "mine" }, ben.id)),
      ).toHaveLength(2);
    });
  });

  describe("deadlines and warranties", () => {
    it("carry defect deadlines, and the defect stands for its reminder task", async () => {
      const room = createRoom(ctx(), { name: "Bad" });
      const defect = await createDefect(
        ctx(),
        createDefectRequestSchema.parse({
          title: "Riss in der Wand",
          deadlineDate: "2026-07-01",
          roomId: room.id,
        }),
        null,
      );
      const both = await items(["task_due", "defect_deadlines"]);
      expect(both).toHaveLength(1);
      expect(both[0]).toMatchObject({
        kind: "defect_deadlines",
        ref: `defect-${defect.id}-deadline`,
        summary: "Mängelfrist 1: Riss in der Wand",
        description: "Raum: Bad",
        when: { allDay: true, startDate: "2026-07-01", endDate: "2026-07-02" },
        path: `/defects/${defect.id}`,
      });
      // Without the defect's own entry the reminder task is what shows.
      const tasksOnly = await items(["task_due"]);
      expect(tasksOnly).toHaveLength(1);
      expect(tasksOnly[0]!.kind).toBe("task_due");
    });

    it("carry the cancellation deadline of a policy, and the policy stands for its reminder task", async () => {
      const policy = await createPolicy(
        ctx(),
        createInsurancePolicyRequestSchema.parse({
          title: "Hausrat",
          premiumMinor: 45_000,
          startDate: "2025-01-01",
          endDate: "2026-12-31",
          cancellationNoticeMonths: 3,
          policyNumber: "POL-4711",
          notes: HIDDEN,
        }),
      );
      const both = await items(["task_due", "insurance_deadlines"]);
      expect(both).toHaveLength(1);
      expect(both[0]).toMatchObject({
        kind: "insurance_deadlines",
        ref: `insurance-${policy.id}-cancel`,
        summary: "Kündigungsfrist: Hausrat",
        description: "Der Vertrag läuft bis 2026-12-31",
        when: { allDay: true, startDate: "2026-09-30", endDate: "2026-10-01" },
        path: `/insurance/${policy.id}`,
      });
      expect((await items(["task_due"]))[0]!.kind).toBe("task_due");
    });

    it("leave out policies without a deadline, archived ones and deadlines that have passed", async () => {
      const make = (title: string, over: Record<string, unknown>) =>
        createPolicy(
          ctx(),
          createInsurancePolicyRequestSchema.parse({
            title,
            premiumMinor: 1000,
            startDate: "2025-01-01",
            ...over,
          }),
        );
      await make("Fix", {
        endDate: "2026-12-31",
        renewal: "fixed",
        cancellationNoticeMonths: 3,
      });
      await make("Offen", { cancellationNoticeMonths: 3 });
      await make("Vorbei", {
        endDate: "2026-07-31",
        cancellationNoticeMonths: 3,
      });
      const archived = await make("Archiv", {
        endDate: "2026-12-31",
        cancellationNoticeMonths: 3,
      });
      test.db
        .update(insurancePolicies)
        .set({ archivedAt: new Date(NOW) })
        .where(eq(insurancePolicies.id, archived.id))
        .run();
      expect(await items(["insurance_deadlines"])).toEqual([]);
    });

    it("carry warranty ends within a year, the extended date wins", async () => {
      const make = (name: string, over: Record<string, unknown>) =>
        createAsset(ctx(), createAssetRequestSchema.parse({ name, ...over }));
      make("Geschirrspüler", {
        warrantyUntil: "2026-09-01",
        warrantyExtendedUntil: "2026-12-01",
      });
      make("Altgerät", { warrantyUntil: "2026-06-14" });
      const archived = make("Archiv", { warrantyUntil: "2026-09-01" });
      test.db
        .update(assets)
        .set({ archivedAt: new Date(NOW) })
        .where(eq(assets.id, archived.id))
        .run();
      const list = await items(["warranty_ends"]);
      expect(list.map((i) => [i.summary, i.when])).toEqual([
        [
          "Garantie läuft ab: Geschirrspüler",
          { allDay: true, startDate: "2026-12-01", endDate: "2026-12-02" },
        ],
      ]);
    });
  });

  describe("kinds, reminders and the horizon", () => {
    it("carries only the kinds the target asks for", async () => {
      await makeTask(ctx(), { trigger: everyDays(30, "2026-06-20") });
      book();
      createAsset(
        ctx(),
        createAssetRequestSchema.parse({
          name: "Gerät",
          warrantyUntil: "2026-09-01",
        }),
      );
      const kindsOf = async (kinds: CalendarItemKind[]) =>
        (await items(kinds)).map((i) => i.kind).sort();
      expect(await kindsOf(["appointments"])).toEqual(["appointments"]);
      expect(await kindsOf(["task_due"])).toEqual(["task_due"]);
      expect(await kindsOf(["warranty_ends"])).toEqual(["warranty_ends"]);
      expect(await kindsOf(["appointments", "warranty_ends"])).toEqual([
        "appointments",
        "warranty_ends",
      ]);
    });

    it("asks for a reminder on everything that can have one, and on none that is over", async () => {
      await makeTask(ctx(), {
        title: "Aufgabe",
        trigger: everyDays(30, "2026-06-20"),
      });
      const planned = book({ title: "Geplant" });
      const done = book({ title: "Erledigt" });
      updateAppointment(ctx(), done.id, { status: "done" });
      const list = await items(["task_due", "appointments"], {
        alarmMinutes: 60,
      });
      expect(
        Object.fromEntries(list.map((i) => [i.summary, i.alarmMinutes])),
      ).toEqual({ Aufgabe: 60, Geplant: 60, Erledigt: null });
      expect(planned.id).not.toBe(done.id);
    });

    it("keeps only what lies within the horizon: a month back and 400 days ahead", async () => {
      await makeTask(ctx(), {
        title: "Heute",
        trigger: everyDays(30, "2026-06-20"),
      });
      await makeTask(ctx(), {
        title: "Lange her",
        trigger: everyDays(30, "2026-04-20"),
      });
      await makeTask(ctx(), {
        title: "Vor 30 Tagen",
        trigger: everyDays(30, "2026-05-16"),
      });
      await makeTask(ctx(), {
        title: "Weit weg",
        trigger: everyDays(30, "2028-01-01"),
      });
      await makeTask(ctx(), {
        title: "Gerade noch",
        trigger: everyDays(30, "2027-07-20"),
      });
      expect(summaries(await items(["task_due"]))).toEqual([
        "Vor 30 Tagen",
        "Heute",
        "Gerade noch",
      ]);
      const { from, to } = horizon(NOW);
      expect(from).toBe(at("2026-05-15", "00:00"));
      expect(to).toBe(at("2027-07-21", "00:00"));
      expect(readRange(NOW)).toEqual({
        from: from - 2 * 86_400_000,
        to: to + 2 * 86_400_000,
      });
    });
  });

  describe("what never reaches a calendar", () => {
    it("keeps notes, task descriptions, defect descriptions and policy numbers out of every item", async () => {
      const task = await makeTask(ctx(), {
        title: "Sichtbar",
        descriptionMd: `:::secret\n${HIDDEN}\n:::`,
        trigger: everyDays(30, "2026-06-20"),
      });
      await createPreparation(ctx(), task.id, {
        title: "Vorher",
        kind: "generic",
        leadDays: 5,
        qty: 1,
      });
      book({ notes: `:::secret\n${HIDDEN}\n:::` });
      await createDefect(
        ctx(),
        createDefectRequestSchema.parse({
          title: "Riss",
          descriptionMd: `:::secret\n${HIDDEN}\n:::`,
          locationDetail: HIDDEN,
          deadlineDate: "2026-07-01",
        }),
        null,
      );
      await createPolicy(
        ctx(),
        createInsurancePolicyRequestSchema.parse({
          title: "Hausrat",
          premiumMinor: 45_000,
          startDate: "2025-01-01",
          endDate: "2026-12-31",
          cancellationNoticeMonths: 3,
          policyNumber: HIDDEN,
          assistancePhone: HIDDEN,
          notes: HIDDEN,
        }),
      );
      createAsset(
        ctx(),
        createAssetRequestSchema.parse({
          name: "Gerät",
          warrantyUntil: "2026-09-01",
          notes: HIDDEN,
        }),
      );
      const list = await items([
        "appointments",
        "task_due",
        "preparations",
        "defect_deadlines",
        "insurance_deadlines",
        "warranty_ends",
      ]);
      expect(new Set(list.map((i) => i.kind)).size).toBe(6);
      expect(JSON.stringify(list)).not.toContain(HIDDEN);
    });
  });

  describe("the fingerprint", () => {
    it("is the same for the same content, and changes with anything the calendar shows", async () => {
      const task = await makeTask(ctx(), {
        title: "Filter wechseln",
        trigger: everyDays(30, "2026-06-20"),
      });
      const [first] = await items(["task_due"]);
      const [again] = await items(["task_due"], {}, null, NOW + 3_600_000);
      expect(again!.hash).toBe(first!.hash);
      expect(first!.hash).toMatch(/^[0-9a-f]{32}$/);

      test.db
        .update(tasks)
        .set({ title: "Filter tauschen" })
        .where(eq(tasks.id, task.id))
        .run();
      const [renamed] = await items(["task_due"]);
      expect(renamed!.hash).not.toBe(first!.hash);

      const [prefixed] = await items(["task_due"], { titlePrefix: "H: " });
      const [reminder] = await items(["task_due"], { alarmMinutes: 30 });
      const [timed] = await items(["task_due"], { timedMode: "timed" });
      expect(
        new Set([renamed!.hash, prefixed!.hash, reminder!.hash, timed!.hash])
          .size,
      ).toBe(4);
    });

    it("does not depend on when the item was last touched", async () => {
      const a = book();
      const [before] = await items(["appointments"]);
      test.db
        .update(appointments)
        .set({ updatedAt: new Date(NOW + 86_400_000) })
        .where(eq(appointments.id, a.id))
        .run();
      const [after] = await items(["appointments"]);
      expect(after!.hash).toBe(before!.hash);
    });

    it("tells all-day from timed and a moved end from a moved start", () => {
      const base = {
        ref: "task-x",
        summary: "S",
        description: "",
        location: null,
        path: "/tasks/x",
        alarmMinutes: null,
      };
      const hashes = [
        {
          allDay: true as const,
          startDate: "2026-06-20",
          endDate: "2026-06-21",
        },
        {
          allDay: true as const,
          startDate: "2026-06-20",
          endDate: "2026-06-22",
        },
        { allDay: false as const, startsAt: 1, endsAt: 2 },
        { allDay: false as const, startsAt: 1, endsAt: 3 },
        { allDay: false as const, startsAt: 2, endsAt: 3 },
      ].map((when) => itemHash({ ...base, when }));
      expect(new Set(hashes).size).toBe(5);
    });
  });

  it("returns the items sorted by start", async () => {
    await makeTask(ctx(), { title: "B", trigger: everyDays(30, "2026-06-25") });
    await makeTask(ctx(), { title: "A", trigger: everyDays(30, "2026-06-25") });
    book({
      title: "Früh",
      startsAt: at("2026-06-25", "07:00"),
      endsAt: at("2026-06-25", "08:00"),
    });
    book({
      title: "Vorher",
      startsAt: at("2026-06-18", "07:00"),
      endsAt: at("2026-06-18", "08:00"),
    });
    const list = await items(["task_due", "appointments"]);
    expect(list).toHaveLength(4);
    const starts = list.map((i) =>
      i.when.allDay ? at(i.when.startDate, "00:00") : i.when.startsAt,
    );
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(list[0]!.summary).toBe("Vorher");
    expect(list[3]!.summary).toBe("Früh");
  });
});
