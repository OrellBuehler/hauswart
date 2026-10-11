import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createContactRequestSchema } from "$lib/api/schemas/contacts";
import { MAX_APPOINTMENT_DAYS } from "$lib/appointments/when";
import { createAsset, deleteAsset } from "$lib/server/assets/assets";
import { createAttachment } from "$lib/server/attachments/attachments";
import { createComment } from "$lib/server/comments/comments";
import { createContact, deleteContact } from "$lib/server/contacts/contacts";
import { attachments, comments, appointments } from "$lib/server/db";
import { search } from "$lib/server/search/search";
import { deleteTask } from "$lib/server/tasks/tasks";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt, everyDays, makeTask, NOW } from "$lib/testing/domain";
import { samplePdf, useTestFilesDir } from "$lib/testing/files";
import {
  createAppointment,
  deleteAppointment,
  getAppointment,
  listAppointments,
  updateAppointment,
  type CreateAppointmentInput,
} from "./appointments";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Triggers whose task shows no occurrence yet: the engine's placeholders `s:none` and `none`. */
const noOccurrence = {
  idle: {
    v: 1 as const,
    type: "state_condition" as const,
    entityId: "binary_sensor.example_filter",
    op: "eq" as const,
    value: "on",
  },
  empty: {
    v: 1 as const,
    type: "ha_calendar" as const,
    entityId: "calendar.example_waste",
    offsetDays: 0,
  },
};

describe("appointments", () => {
  const test = useTestDB();
  useTestFilesDir();
  const ctx = (now: number = NOW) => ctxAt(test.db, now);
  const page = { limit: 50 };

  const timed = (over: Partial<CreateAppointmentInput> = {}) => ({
    title: "Kaminfeger",
    startsAt: at("2026-06-20", "09:00"),
    endsAt: at("2026-06-20", "10:00"),
    ...over,
  });
  const allDay = (over: Partial<CreateAppointmentInput> = {}) => ({
    title: "Handwerker im Haus",
    allDay: true,
    startDate: "2026-06-22",
    ...over,
  });
  const make = (over: Partial<CreateAppointmentInput> = {}) =>
    createAppointment(ctx(), timed(over), null);
  const makeAllDay = (over: Partial<CreateAppointmentInput> = {}) =>
    createAppointment(ctx(), allDay(over), null);
  const titles = (items: { title: string }[]) => items.map((a) => a.title);
  const list = (
    filter: Parameters<typeof listAppointments>[1] = {},
    p: { cursor?: string; limit: number } = page,
  ) => listAppointments(ctx(), filter, p);
  const asset = (name = "Heizung") =>
    createAsset(ctx(), { kind: "device", name, showOnEmergency: false });
  const contact = (name = "Muster Haustechnik AG") =>
    createContact(ctx(), createContactRequestSchema.parse({ name }));

  describe("creating", () => {
    it("keeps a timed appointment with its instants, the creator and the clock of the request", async () => {
      const user = await createTestUser();
      const a = createAppointment(
        ctx(),
        timed({ notes: "Leiter bereitstellen", location: "Keller" }),
        user.id,
      );
      expect(a).toMatchObject({
        title: "Kaminfeger",
        notes: "Leiter bereitstellen",
        location: "Keller",
        allDay: false,
        startsAt: new Date(at("2026-06-20", "09:00")),
        endsAt: new Date(at("2026-06-20", "10:00")),
        startDate: null,
        endDate: null,
        status: "planned",
        taskId: null,
        taskTitle: null,
        occurrenceKey: null,
        assetId: null,
        assetName: null,
        contactId: null,
        contactName: null,
        commentCount: 0,
        createdByUserId: user.id,
        createdAt: new Date(NOW),
        updatedAt: new Date(NOW),
      });
      expect(getAppointment(ctx(), a.id)).toEqual(a);
    });

    it("gives a timed appointment without an end an hour", () => {
      const a = createAppointment(
        ctx(),
        { title: "Lieferung", startsAt: at("2026-06-20", "14:00") },
        null,
      );
      expect(a.endsAt).toEqual(new Date(at("2026-06-20", "15:00")));
    });

    it("keeps an all-day appointment as dates, of one day unless an end date is given", () => {
      const one = makeAllDay();
      expect(one).toMatchObject({
        allDay: true,
        startDate: "2026-06-22",
        endDate: "2026-06-22",
        startsAt: null,
        endsAt: null,
      });
      expect(makeAllDay({ endDate: "2026-06-24" }).endDate).toBe("2026-06-24");
    });

    it("allows exactly the longest span, in both kinds", () => {
      const start = at("2026-06-20", "09:00");
      expect(
        make({ endsAt: start + MAX_APPOINTMENT_DAYS * DAY }).endsAt,
      ).toEqual(new Date(start + MAX_APPOINTMENT_DAYS * DAY));
      expect(makeAllDay({ endDate: "2026-07-05" }).endDate).toBe("2026-07-05");
    });

    it("counts 14 calendar days across the nights the clocks change as 14 days", () => {
      // 25 October: the clocks go back, so these 14 days last an hour more; 29 March: forward, an hour less.
      const back = make({
        startsAt: at("2026-10-18", "09:00"),
        endsAt: at("2026-11-01", "09:00"),
      });
      expect(back.endsAt).toEqual(new Date(at("2026-11-01", "09:00")));
      expect(back.endsAt!.getTime() - back.startsAt!.getTime()).toBe(
        14 * DAY + HOUR,
      );
      const forward = make({
        startsAt: at("2026-03-22", "09:00"),
        endsAt: at("2026-04-05", "09:00"),
      });
      expect(forward.endsAt!.getTime() - forward.startsAt!.getTime()).toBe(
        14 * DAY - HOUR,
      );
      expect(() =>
        make({
          startsAt: at("2026-10-18", "09:00"),
          endsAt: at("2026-11-01", "10:01"),
        }),
      ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
    });

    it("links a task, a device and a contact and names them", async () => {
      const task = await makeTask(ctx(), { title: "Heizung warten" });
      const heater = asset();
      const technician = contact();
      const a = make({
        taskId: task.id,
        assetId: heater.id,
        contactId: technician.id,
        occurrenceKey: "2026-06-20",
      });
      expect(a).toMatchObject({
        taskId: task.id,
        taskTitle: "Heizung warten",
        occurrenceKey: "2026-06-20",
        assetId: heater.id,
        assetName: "Heizung",
        contactId: technician.id,
        contactName: "Muster Haustechnik AG",
      });
    });

    it("pins the occurrence the task shows unless one is given", async () => {
      const task = await makeTask(ctx());
      expect(task.state?.occurrenceKey).toBe("2026-06-20");
      expect(make({ taskId: task.id }).occurrenceKey).toBe("2026-06-20");
      expect(make({ taskId: task.id, occurrenceKey: null }).occurrenceKey).toBe(
        "2026-06-20",
      );
      expect(
        make({ taskId: task.id, occurrenceKey: "2026-05-01" }).occurrenceKey,
      ).toBe("2026-05-01");
      expect(make().occurrenceKey).toBeNull();
    });

    it("pins nothing for a task that shows no occurrence, and ignores a placeholder it is sent", async () => {
      const idle = await makeTask(ctx(), { trigger: noOccurrence.idle });
      const empty = await makeTask(ctx(), { trigger: noOccurrence.empty });
      expect(idle.state?.occurrenceKey).toBe("s:none");
      expect(empty.state?.occurrenceKey).toBe("none");
      expect(make({ taskId: idle.id }).occurrenceKey).toBeNull();
      expect(make({ taskId: empty.id }).occurrenceKey).toBeNull();
      expect(
        make({ taskId: idle.id, occurrenceKey: "s:none" }).occurrenceKey,
      ).toBeNull();
      const task = await makeTask(ctx());
      for (const stale of ["none", "s:none"]) {
        expect(
          make({ taskId: task.id, occurrenceKey: stale }).occurrenceKey,
        ).toBe("2026-06-20");
      }
    });

    it("takes the asset of the task unless another one or none is given", async () => {
      const heater = asset();
      const other = asset("Boiler");
      const task = await makeTask(ctx(), { assetId: heater.id });
      expect(make({ taskId: task.id }).assetId).toBe(heater.id);
      expect(make({ taskId: task.id, assetId: other.id }).assetId).toBe(
        other.id,
      );
      expect(make({ taskId: task.id, assetId: null }).assetId).toBeNull();
    });

    it.each<[string, Partial<CreateAppointmentInput>, string]>([
      [
        "a timed appointment without a start",
        { startsAt: undefined },
        "startsAt",
      ],
      [
        "a timed appointment with dates",
        { startDate: "2026-06-20" },
        "startDate",
      ],
      [
        "an end that is not after the start",
        { endsAt: at("2026-06-20", "09:00") },
        "endsAt",
      ],
      [
        "an end before the start",
        { endsAt: at("2026-06-20", "08:00") },
        "endsAt",
      ],
      [
        "more than 14 days and the hour a clock change adds",
        { endsAt: at("2026-06-20", "09:00") + 14 * DAY + HOUR + 1 },
        "endsAt",
      ],
      ["a task that does not exist", { taskId: "nope" }, "taskId"],
      ["an asset that does not exist", { assetId: "nope" }, "assetId"],
      ["a contact that does not exist", { contactId: "nope" }, "contactId"],
      [
        "an occurrence without a task",
        { occurrenceKey: "2026-06-20" },
        "occurrenceKey",
      ],
    ])("refuses %s", (_name, over, field) => {
      expect(() => make(over)).toThrowError(
        expect.objectContaining({
          code: "invalid_request",
          details: {
            body: {
              formErrors: [],
              fieldErrors: { [field]: [expect.any(String)] },
            },
          },
        }),
      );
      expect(test.db.select().from(appointments).all()).toEqual([]);
    });

    it.each<[string, Partial<CreateAppointmentInput>, string]>([
      [
        "an all-day appointment without a start date",
        { startDate: undefined },
        "startDate",
      ],
      [
        "an all-day appointment with instants",
        { startsAt: at("2026-06-22", "09:00") },
        "startsAt",
      ],
      [
        "an end date before the start date",
        { endDate: "2026-06-21" },
        "endDate",
      ],
      ["15 days", { endDate: "2026-07-06" }, "endDate"],
    ])("refuses %s", (_name, over, field) => {
      expect(() => makeAllDay(over)).toThrowError(
        expect.objectContaining({
          code: "invalid_request",
          details: {
            body: {
              formErrors: [],
              fieldErrors: { [field]: [expect.any(String)] },
            },
          },
        }),
      );
    });
  });

  describe("reading", () => {
    it("is a 404 for an appointment that does not exist", () => {
      expect(() => getAppointment(ctx(), "nope")).toThrowError(
        expect.objectContaining({ code: "not_found" }),
      );
    });

    it("counts the comments", async () => {
      const user = await createTestUser();
      const a = make();
      for (const bodyMd of ["Eins", "Zwei"]) {
        await createComment(
          ctx(),
          { id: user.id, role: user.role },
          { entityType: "appointment", entityId: a.id, bodyMd },
        );
      }
      expect(getAppointment(ctx(), a.id).commentCount).toBe(2);
    });

    it("names nothing once the task, device and contact are deleted, and forgets the occurrence", async () => {
      const task = await makeTask(ctx());
      const heater = asset();
      const technician = contact();
      const a = make({
        taskId: task.id,
        assetId: heater.id,
        contactId: technician.id,
        occurrenceKey: "2026-06-20",
      });
      deleteTask(ctx(), task.id);
      deleteAsset(ctx(), heater.id);
      deleteContact(ctx(), technician.id);
      expect(getAppointment(ctx(), a.id)).toMatchObject({
        taskId: null,
        taskTitle: null,
        occurrenceKey: null,
        assetId: null,
        assetName: null,
        contactId: null,
        contactName: null,
      });
    });
  });

  describe("listing", () => {
    it("is soonest first across both kinds, an all-day appointment from midnight of its first day", () => {
      make({
        title: "Nachmittag",
        startsAt: at("2026-06-20", "15:00"),
        endsAt: at("2026-06-20", "16:00"),
      });
      make({
        title: "Morgen",
        startsAt: at("2026-06-20", "08:00"),
        endsAt: at("2026-06-20", "09:00"),
      });
      makeAllDay({ title: "Ganztags am Samstag", startDate: "2026-06-20" });
      makeAllDay({ title: "Später", startDate: "2026-06-21" });
      make({
        title: "Früher",
        startsAt: at("2026-06-19", "23:30"),
        endsAt: at("2026-06-20", "00:30"),
      });
      expect(titles(list().items)).toEqual([
        "Früher",
        "Ganztags am Samstag",
        "Morgen",
        "Nachmittag",
        "Später",
      ]);
    });

    it("puts the longer one first when two start together, then by title", () => {
      const start = at("2026-06-20", "09:00");
      make({ title: "B kurz", startsAt: start, endsAt: start + HOUR });
      make({ title: "A kurz", startsAt: start, endsAt: start + HOUR });
      make({ title: "Z lang", startsAt: start, endsAt: start + 3 * HOUR });
      expect(titles(list().items)).toEqual(["Z lang", "A kurz", "B kurz"]);
    });

    it("lists the appointments that overlap the days from..to, both included", () => {
      makeAllDay({
        title: "vorher",
        startDate: "2026-06-08",
        endDate: "2026-06-09",
      });
      makeAllDay({
        title: "bis in den Bereich",
        startDate: "2026-06-09",
        endDate: "2026-06-10",
      });
      makeAllDay({ title: "mittendrin", startDate: "2026-06-12" });
      makeAllDay({
        title: "über den ganzen Bereich",
        startDate: "2026-06-05",
        endDate: "2026-06-16",
      });
      makeAllDay({ title: "letzter Tag", startDate: "2026-06-14" });
      makeAllDay({ title: "danach", startDate: "2026-06-15" });
      const inRange = (from?: string, to?: string) =>
        titles(list({ from, to }).items);
      expect(inRange("2026-06-10", "2026-06-14")).toEqual([
        "über den ganzen Bereich",
        "bis in den Bereich",
        "mittendrin",
        "letzter Tag",
      ]);
      expect(inRange("2026-06-12", "2026-06-12")).toEqual([
        "über den ganzen Bereich",
        "mittendrin",
      ]);
      expect(inRange("2026-06-15")).toEqual([
        "über den ganzen Bereich",
        "danach",
      ]);
      expect(inRange(undefined, "2026-06-08")).toEqual([
        "über den ganzen Bereich",
        "vorher",
      ]);
      expect(inRange()).toHaveLength(6);
    });

    it("counts a timed appointment on every day of the household zone it touches", () => {
      make({
        title: "über Mitternacht",
        startsAt: at("2026-06-20", "23:00"),
        endsAt: at("2026-06-21", "01:00"),
      });
      const on = (day: string) => titles(list({ from: day, to: day }).items);
      expect(on("2026-06-19")).toEqual([]);
      expect(on("2026-06-20")).toEqual(["über Mitternacht"]);
      expect(on("2026-06-21")).toEqual(["über Mitternacht"]);
      expect(on("2026-06-22")).toEqual([]);
    });

    it("does not count a timed appointment on the day it ends at midnight, nor before it starts at midnight", () => {
      make({
        title: "bis Mitternacht",
        startsAt: at("2026-06-20", "22:00"),
        endsAt: at("2026-06-21", "00:00"),
      });
      make({
        title: "ab Mitternacht",
        startsAt: at("2026-06-21", "00:00"),
        endsAt: at("2026-06-21", "01:00"),
      });
      const on = (day: string) => titles(list({ from: day, to: day }).items);
      expect(on("2026-06-20")).toEqual(["bis Mitternacht"]);
      expect(on("2026-06-21")).toEqual(["ab Mitternacht"]);
    });

    it("cuts the days at local midnight on the days the clocks change", () => {
      // 2026-03-29: Europe/Zurich springs forward, the day has 23 hours.
      make({
        title: "kurz vor Mitternacht",
        startsAt: Date.parse("2026-03-29T21:30:00Z"),
        endsAt: Date.parse("2026-03-29T21:59:00Z"),
      });
      make({
        title: "kurz nach Mitternacht",
        startsAt: Date.parse("2026-03-29T22:00:00Z"),
        endsAt: Date.parse("2026-03-29T22:30:00Z"),
      });
      make({
        title: "früh am Sonntag",
        startsAt: Date.parse("2026-03-28T23:00:00Z"),
        endsAt: Date.parse("2026-03-28T23:30:00Z"),
      });
      make({
        title: "spät am Samstag",
        startsAt: Date.parse("2026-03-28T22:30:00Z"),
        endsAt: Date.parse("2026-03-28T22:59:00Z"),
      });
      const on = (day: string) => titles(list({ from: day, to: day }).items);
      expect(on("2026-03-28")).toEqual(["spät am Samstag"]);
      expect(on("2026-03-29")).toEqual([
        "früh am Sonntag",
        "kurz vor Mitternacht",
      ]);
      expect(on("2026-03-30")).toEqual(["kurz nach Mitternacht"]);
      // 2026-10-25: it falls back, the day has 25 hours.
      make({
        title: "später Herbstabend",
        startsAt: Date.parse("2026-10-25T22:30:00Z"),
        endsAt: Date.parse("2026-10-25T22:45:00Z"),
      });
      make({
        title: "Montag früh",
        startsAt: Date.parse("2026-10-25T23:00:00Z"),
        endsAt: Date.parse("2026-10-25T23:30:00Z"),
      });
      expect(on("2026-10-25")).toEqual(["später Herbstabend"]);
      expect(on("2026-10-26")).toEqual(["Montag früh"]);
    });

    it("filters by status, device, task and contact", async () => {
      const heater = asset();
      const technician = contact();
      const task = await makeTask(ctx());
      make({ title: "geplant" });
      const done = make({ title: "erledigt" });
      updateAppointment(ctx(), done.id, { status: "done" });
      const cancelled = make({ title: "abgesagt" });
      updateAppointment(ctx(), cancelled.id, { status: "cancelled" });
      make({
        title: "mit allem",
        assetId: heater.id,
        taskId: task.id,
        contactId: technician.id,
      });
      const status = (s: "planned" | "done" | "cancelled") =>
        titles(list({ status: s }).items).sort();
      expect(status("planned")).toEqual(["geplant", "mit allem"]);
      expect(status("done")).toEqual(["erledigt"]);
      expect(status("cancelled")).toEqual(["abgesagt"]);
      expect(titles(list().items)).toHaveLength(4);
      expect(titles(list({ assetId: heater.id }).items)).toEqual(["mit allem"]);
      expect(titles(list({ taskId: task.id }).items)).toEqual(["mit allem"]);
      expect(titles(list({ contactId: technician.id }).items)).toEqual([
        "mit allem",
      ]);
      expect(list({ assetId: "nope" }).items).toEqual([]);
      expect(
        titles(list({ assetId: heater.id, status: "done" }).items),
      ).toEqual([]);
    });

    it("pages through the list without losing or repeating an appointment", () => {
      for (let day = 1; day <= 5; day++) {
        make({
          title: `Termin ${day}`,
          startsAt: at(`2026-07-0${day}`, "09:00"),
          endsAt: at(`2026-07-0${day}`, "10:00"),
        });
      }
      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const p = list({}, { cursor, limit: 2 });
        seen.push(...titles(p.items));
        cursor = p.nextCursor ?? undefined;
        pages++;
      } while (cursor);
      expect(pages).toBe(3);
      expect(seen).toEqual([1, 2, 3, 4, 5].map((n) => `Termin ${n}`));
    });
  });

  describe("updating", () => {
    const LATER = NOW + HOUR;

    it("changes the fields given and moves updatedAt, nothing else", () => {
      const a = make({ notes: "alt", location: "Keller" });
      const b = updateAppointment(ctx(LATER), a.id, {
        title: "Rauchmelder prüfen",
        notes: null,
      });
      expect(b).toMatchObject({
        title: "Rauchmelder prüfen",
        notes: null,
        location: "Keller",
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        status: "planned",
        createdAt: new Date(NOW),
        updatedAt: new Date(LATER),
      });
    });

    it("leaves updatedAt alone when nothing changes", () => {
      const a = make({ notes: "x" });
      const same = updateAppointment(ctx(LATER), a.id, {
        title: a.title,
        notes: "x",
        startsAt: a.startsAt!.getTime(),
        endsAt: a.endsAt!.getTime(),
        status: "planned",
      });
      expect(same.updatedAt).toEqual(new Date(NOW));
      expect(getAppointment(ctx(), a.id).updatedAt).toEqual(new Date(NOW));
    });

    it("moves updatedAt for a change of the status alone", () => {
      const a = make();
      for (const status of ["cancelled", "planned", "done"] as const) {
        const b = updateAppointment(ctx(LATER), a.id, { status });
        expect(b.status).toBe(status);
        expect(b.updatedAt).toEqual(new Date(LATER));
      }
    });

    it("moves a timed appointment, by both ends or by the end alone", () => {
      const a = make();
      const moved = updateAppointment(ctx(LATER), a.id, {
        startsAt: at("2026-06-21", "14:00"),
        endsAt: at("2026-06-21", "15:30"),
      });
      expect(moved.startsAt).toEqual(new Date(at("2026-06-21", "14:00")));
      expect(moved.endsAt).toEqual(new Date(at("2026-06-21", "15:30")));
      const longer = updateAppointment(ctx(LATER), a.id, {
        endsAt: at("2026-06-21", "16:00"),
      });
      expect(longer.startsAt).toEqual(moved.startsAt);
      expect(longer.endsAt).toEqual(new Date(at("2026-06-21", "16:00")));
    });

    it("refuses a start after the end and writes nothing", () => {
      const a = make();
      expect(() =>
        updateAppointment(ctx(LATER), a.id, {
          startsAt: at("2026-06-20", "11:00"),
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "invalid_request",
          details: {
            body: {
              formErrors: [],
              fieldErrors: { endsAt: [expect.any(String)] },
            },
          },
        }),
      );
      expect(getAppointment(ctx(), a.id)).toEqual(a);
    });

    it("refuses to stretch an appointment beyond 14 days", () => {
      const a = make();
      expect(() =>
        updateAppointment(ctx(), a.id, {
          endsAt: at("2026-07-10", "10:00"),
        }),
      ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
      const days = makeAllDay();
      expect(() =>
        updateAppointment(ctx(), days.id, { endDate: "2026-07-06" }),
      ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
      expect(
        updateAppointment(ctx(), days.id, { endDate: "2026-07-05" }).endDate,
      ).toBe("2026-07-05");
    });

    it("stretches a timed appointment to 14 calendar days across the night the clocks go back", () => {
      const a = make({
        startsAt: at("2026-10-18", "09:00"),
        endsAt: at("2026-10-18", "10:00"),
      });
      expect(
        updateAppointment(ctx(), a.id, { endsAt: at("2026-11-01", "09:00") })
          .endsAt,
      ).toEqual(new Date(at("2026-11-01", "09:00")));
      expect(() =>
        updateAppointment(ctx(), a.id, { endsAt: at("2026-11-01", "10:01") }),
      ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
    });

    it("changes the dates of an all-day appointment", () => {
      const a = makeAllDay({ endDate: "2026-06-23" });
      expect(
        updateAppointment(ctx(LATER), a.id, { endDate: "2026-06-25" }),
      ).toMatchObject({ startDate: "2026-06-22", endDate: "2026-06-25" });
      expect(() =>
        updateAppointment(ctx(LATER), a.id, { startDate: "2026-06-26" }),
      ).toThrowError(
        expect.objectContaining({
          details: {
            body: {
              formErrors: [],
              fieldErrors: { endDate: [expect.any(String)] },
            },
          },
        }),
      );
    });

    it("refuses the fields of the other kind unless allDay switches it", () => {
      const a = make();
      expect(() =>
        updateAppointment(ctx(), a.id, { startDate: "2026-06-22" }),
      ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
      const days = makeAllDay();
      expect(() =>
        updateAppointment(ctx(), days.id, {
          startsAt: at("2026-06-22", "09:00"),
        }),
      ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
    });

    it("turns a timed appointment into an all-day one when the dates are given", () => {
      const a = make();
      const b = updateAppointment(ctx(LATER), a.id, {
        allDay: true,
        startDate: "2026-06-20",
      });
      expect(b).toMatchObject({
        allDay: true,
        startDate: "2026-06-20",
        endDate: "2026-06-20",
        startsAt: null,
        endsAt: null,
      });
      expect(
        updateAppointment(ctx(LATER), a.id, {
          allDay: true,
          startDate: "2026-06-20",
          endDate: "2026-06-21",
        }).endDate,
      ).toBe("2026-06-21");
    });

    it("needs the dates, or the start, to switch the kind", () => {
      const a = make();
      expect(() =>
        updateAppointment(ctx(), a.id, { allDay: true }),
      ).toThrowError(
        expect.objectContaining({
          details: {
            body: {
              formErrors: [],
              fieldErrors: { startDate: [expect.any(String)] },
            },
          },
        }),
      );
      const days = makeAllDay();
      expect(() =>
        updateAppointment(ctx(), days.id, { allDay: false }),
      ).toThrowError(
        expect.objectContaining({
          details: {
            body: {
              formErrors: [],
              fieldErrors: { startsAt: [expect.any(String)] },
            },
          },
        }),
      );
      expect(getAppointment(ctx(), days.id).allDay).toBe(true);
    });

    it("turns an all-day appointment into a timed one with the default length", () => {
      const days = makeAllDay();
      const b = updateAppointment(ctx(LATER), days.id, {
        allDay: false,
        startsAt: at("2026-06-22", "09:00"),
      });
      expect(b).toMatchObject({
        allDay: false,
        startDate: null,
        endDate: null,
        startsAt: new Date(at("2026-06-22", "09:00")),
        endsAt: new Date(at("2026-06-22", "10:00")),
      });
    });

    it("restates the kind it already has without effect", () => {
      const a = make();
      const b = updateAppointment(ctx(LATER), a.id, {
        allDay: false,
        title: "Anders",
      });
      expect(b.startsAt).toEqual(a.startsAt);
      expect(b.title).toBe("Anders");
    });

    it("changes the links and checks them", async () => {
      const heater = asset();
      const technician = contact();
      const task = await makeTask(ctx());
      const a = make();
      expect(
        updateAppointment(ctx(LATER), a.id, {
          assetId: heater.id,
          contactId: technician.id,
          taskId: task.id,
        }),
      ).toMatchObject({
        assetId: heater.id,
        contactId: technician.id,
        taskId: task.id,
      });
      expect(
        updateAppointment(ctx(LATER), a.id, { assetId: null, contactId: null }),
      ).toMatchObject({ assetId: null, contactId: null, taskId: task.id });
      for (const [patch, field] of [
        [{ taskId: "nope" }, "taskId"],
        [{ assetId: "nope" }, "assetId"],
        [{ contactId: "nope" }, "contactId"],
      ] as const) {
        expect(() => updateAppointment(ctx(), a.id, patch)).toThrowError(
          expect.objectContaining({
            details: {
              body: {
                formErrors: [],
                fieldErrors: { [field]: [expect.any(String)] },
              },
            },
          }),
        );
      }
    });

    it("pins the occurrence of a new task and keeps it for the same one", async () => {
      const first = await makeTask(ctx(), { title: "Eins" });
      const second = await makeTask(ctx(), {
        title: "Zwei",
        trigger: everyDays(30, "2026-07-01"),
      });
      const a = make({ taskId: first.id, occurrenceKey: "2026-06-20" });
      expect(
        updateAppointment(ctx(LATER), a.id, {
          taskId: first.id,
          title: "Neu",
        }).occurrenceKey,
      ).toBe("2026-06-20");
      expect(
        updateAppointment(ctx(LATER), a.id, { taskId: second.id }),
      ).toMatchObject({ taskId: second.id, occurrenceKey: "2026-07-01" });
      expect(
        updateAppointment(ctx(LATER), a.id, {
          taskId: first.id,
          occurrenceKey: "2026-07-20",
        }).occurrenceKey,
      ).toBe("2026-07-20");
      expect(
        updateAppointment(ctx(LATER), a.id, {
          taskId: second.id,
          occurrenceKey: null,
        }).occurrenceKey,
      ).toBe("2026-07-01");
    });

    it("pins the task an appointment gets later, and nothing for a task that shows no occurrence", async () => {
      const task = await makeTask(ctx());
      const idle = await makeTask(ctx(), { trigger: noOccurrence.idle });
      const a = make();
      expect(
        updateAppointment(ctx(LATER), a.id, { taskId: task.id }),
      ).toMatchObject({ taskId: task.id, occurrenceKey: "2026-06-20" });
      expect(
        updateAppointment(ctx(LATER), a.id, { taskId: idle.id }),
      ).toMatchObject({ taskId: idle.id, occurrenceKey: null });
      expect(
        updateAppointment(ctx(LATER), a.id, {
          taskId: task.id,
          occurrenceKey: "s:none",
        }).occurrenceKey,
      ).toBe("2026-06-20");
    });

    it("leaves an appointment without an occurrence alone unless its task changes", async () => {
      const task = await makeTask(ctx());
      const a = make({ taskId: task.id });
      expect(
        updateAppointment(ctx(LATER), a.id, { occurrenceKey: null })
          .occurrenceKey,
      ).toBeNull();
      expect(
        updateAppointment(ctx(LATER), a.id, {
          taskId: task.id,
          title: "Neu",
        }).occurrenceKey,
      ).toBeNull();
      expect(
        updateAppointment(ctx(LATER), a.id, { notes: "x" }).occurrenceKey,
      ).toBeNull();
    });

    it("drops the occurrence with the task and refuses one without a task", async () => {
      const task = await makeTask(ctx());
      const a = make({ taskId: task.id, occurrenceKey: "2026-06-20" });
      expect(
        updateAppointment(ctx(LATER), a.id, { taskId: null }),
      ).toMatchObject({ taskId: null, occurrenceKey: null });
      expect(() =>
        updateAppointment(ctx(), a.id, { occurrenceKey: "2026-06-20" }),
      ).toThrowError(
        expect.objectContaining({
          details: {
            body: {
              formErrors: [],
              fieldErrors: { occurrenceKey: [expect.any(String)] },
            },
          },
        }),
      );
      expect(() =>
        updateAppointment(ctx(), a.id, {
          taskId: null,
          occurrenceKey: "2026-06-20",
        }),
      ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
    });

    it("is a 404 for an appointment that does not exist", () => {
      expect(() =>
        updateAppointment(ctx(), "nope", { title: "x" }),
      ).toThrowError(expect.objectContaining({ code: "not_found" }));
    });
  });

  describe("deleting", () => {
    it("removes the appointment with its comments, attachments and search entry", async () => {
      const user = await createTestUser();
      const a = make();
      const other = make({ title: "Bleibt" });
      await createComment(
        ctx(),
        { id: user.id, role: user.role },
        { entityType: "appointment", entityId: a.id, bodyMd: "Hallo" },
      );
      await createAttachment(ctx(), {
        bytes: samplePdf(),
        filename: "offerte.pdf",
        ownerType: "appointment",
        ownerId: a.id,
        uploadedBy: null,
      });
      expect(search(ctx(), { q: "kaminfeger", limit: 5 })).toHaveLength(1);
      deleteAppointment(ctx(), a.id);
      expect(() => getAppointment(ctx(), a.id)).toThrowError(
        expect.objectContaining({ code: "not_found" }),
      );
      expect(test.db.select().from(comments).all()).toEqual([]);
      expect(test.db.select().from(attachments).all()).toEqual([]);
      expect(search(ctx(), { q: "kaminfeger", limit: 5 })).toEqual([]);
      expect(getAppointment(ctx(), other.id).title).toBe("Bleibt");
      expect(() => deleteAppointment(ctx(), a.id)).toThrowError(
        expect.objectContaining({ code: "not_found" }),
      );
      expect(
        test.db
          .select()
          .from(appointments)
          .where(eq(appointments.id, other.id))
          .all(),
      ).toHaveLength(1);
    });
  });
});
