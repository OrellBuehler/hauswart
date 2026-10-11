import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalendarItemKind } from "$lib/api/enums";
import {
  createAppointment,
  deleteAppointment,
  updateAppointment,
  type CreateAppointmentInput,
} from "$lib/server/appointments/appointments";
import { calendarLinks, calendarTargets, connections } from "$lib/server/db";
import { completeTask } from "$lib/server/tasks/completions";
import { updateTask } from "$lib/server/tasks/tasks";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt, everyDays, makeTask, NOW } from "$lib/testing/domain";
import { buildDesiredItems } from "./items";
import { listLinks } from "./links";
import type { CalendarCapabilities } from "./provider";
import { hasPendingChanges } from "./reconcile";
import { configOf, getTargetRow } from "./store";
import { syncTarget } from "./sync";
import {
  addTarget,
  CALENDAR_ID,
  connectCalendarSystem,
  FULL_CAPABILITIES,
  useFakeCalendars,
} from "./testing";

const CREATE_DELETE: CalendarCapabilities = {
  ...FULL_CAPABILITIES,
  update: false,
};
const CREATE_ONLY: CalendarCapabilities = {
  ...FULL_CAPABILITIES,
  update: false,
  delete: false,
};

describe("syncTarget", () => {
  const test = useTestDB();
  const fake = useFakeCalendars();
  const ctx = (now = NOW) => ctxAt(test.db, now);

  afterEach(() => vi.restoreAllMocks());

  async function setup(
    over: Parameters<typeof addTarget>[2] = {},
    connect = true,
  ) {
    if (connect) connectCalendarSystem(ctx());
    return addTarget(ctx(), fake, over);
  }
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
  const sync = (id: string, options = {}, now = NOW) =>
    syncTarget(ctx(now), id, options);
  const row = (id: string) => getTargetRow(ctx(), id)!;
  const writes = () =>
    fake.calls.filter((c) => ["create", "update", "delete"].includes(c.step));
  const pending = async (id: string) => {
    const target = row(id);
    return hasPendingChanges(
      await buildDesiredItems(ctx(), {
        config: configOf(target),
        userId: target.userId,
      }),
      listLinks(ctx(), id),
    );
  };

  describe("the first and the following runs", () => {
    it("writes every wanted item once, with its marker, and then has nothing to do", async () => {
      const target = await setup();
      const a = book();
      const task = await makeTask(ctx(), {
        title: "Filter wechseln",
        trigger: everyDays(30, "2026-06-22"),
      });

      const first = await sync(target.id);
      expect(first).toMatchObject({
        ok: true,
        error: null,
        counts: { created: 2, failed: 0, remaining: 0, unconfirmed: 0 },
      });
      const events = fake.ours(CALENDAR_ID);
      expect([...events.keys()].sort()).toEqual(
        [`appointment-${a.id}`, `task-${task.id}-2026-06-22`].sort(),
      );
      const event = events.get(`appointment-${a.id}`)!;
      expect(event.description).toContain(
        `hw-ref: appointment-${a.id}@sync.hauswart`,
      );
      expect(event.item).toMatchObject({
        summary: "Kaminfeger",
        when: {
          allDay: false,
          startsAt: at("2026-06-20", "09:00"),
          endsAt: at("2026-06-20", "10:30"),
        },
      });
      expect(listLinks(ctx(), target.id)).toHaveLength(2);

      fake.calls = [];
      const second = await sync(target.id);
      expect(second).toMatchObject({
        ok: true,
        counts: { created: 0, updated: 0, deleted: 0, adopted: 0, failed: 0 },
      });
      expect(writes()).toEqual([]);
      expect(await pending(target.id)).toBe(false);
    });

    it("records the outcome on the target: health, counts and what the calendar allows", async () => {
      const target = await setup();
      book();
      await sync(target.id);
      expect(row(target.id)).toMatchObject({
        status: "ok",
        lastError: null,
        consecutiveFailures: 0,
        lastOkAt: new Date(NOW),
        lastCheckedAt: new Date(NOW),
        capabilitiesJson: FULL_CAPABILITIES,
        lastStatsJson: expect.objectContaining({ created: 1 }),
      });
    });

    it("changes an event in place when the item changed, and removes it when the item is gone", async () => {
      const target = await setup();
      const a = book();
      const b = book({
        title: "Maler",
        startsAt: at("2026-06-21", "08:00"),
        endsAt: at("2026-06-21", "09:00"),
      });
      await sync(target.id);
      fake.calls = [];

      updateAppointment(ctx(), a.id, { title: "Kaminfeger kommt" });
      deleteAppointment(ctx(), b.id);
      expect(await pending(target.id)).toBe(true);
      const result = await sync(target.id);
      expect(result.counts).toMatchObject({ updated: 1, deleted: 1 });
      const events = fake.ours(CALENDAR_ID);
      expect([...events.keys()]).toEqual([`appointment-${a.id}`]);
      expect(events.get(`appointment-${a.id}`)!.item!.summary).toBe(
        "Kaminfeger kommt",
      );
      expect(await pending(target.id)).toBe(false);
    });

    it("moves a recurring task to its next occurrence when it is done: the old event goes, the new one comes", async () => {
      const target = await setup({ kinds: ["task_due"] });
      const task = await makeTask(ctx(), {
        title: "Filter wechseln",
        trigger: everyDays(30, "2026-06-20"),
      });
      await sync(target.id);
      const [before] = [...fake.ours(CALENDAR_ID).keys()];

      await completeTask(ctx(), task.id, {
        kind: "done",
        source: "manual",
        userId: null,
      });
      const result = await sync(target.id);
      expect(result.counts).toMatchObject({ created: 1, deleted: 1 });
      const after = [...fake.ours(CALENDAR_ID).keys()];
      expect(after).toHaveLength(1);
      expect(after[0]).not.toBe(before);
    });

    it("applies a changed configuration: dropping a kind removes its events", async () => {
      const target = await setup({ kinds: ["appointments", "task_due"] });
      book();
      await makeTask(ctx(), { trigger: everyDays(30, "2026-06-22") });
      await sync(target.id);
      expect(fake.ours(CALENDAR_ID).size).toBe(2);

      test.db
        .update(calendarTargets)
        .set({
          configJson: { ...configOf(row(target.id)), kinds: ["appointments"] },
        })
        .where(eq(calendarTargets.id, target.id))
        .run();
      const result = await sync(target.id);
      expect(result.counts).toMatchObject({ deleted: 1, created: 0 });
      expect([...fake.ours(CALENDAR_ID).keys()]).toEqual([
        expect.stringMatching(/^appointment-/),
      ]);
    });

    it("writes the prefix, the time of day and the reminder the target asks for", async () => {
      const target = await setup({
        kinds: ["task_due"],
        config: {
          titlePrefix: "[H] ",
          timedMode: "timed",
          dueTime: "07:30",
          dueDurationMinutes: 20,
          alarmMinutes: 15,
        },
      });
      await makeTask(ctx(), {
        title: "Filter wechseln",
        trigger: everyDays(30, "2026-06-20"),
      });
      await sync(target.id);
      const [event] = [...fake.ours(CALENDAR_ID).values()];
      expect(event!.item).toMatchObject({
        summary: "[H] Filter wechseln",
        alarmMinutes: 15,
        when: {
          allDay: false,
          startsAt: at("2026-06-20", "07:30"),
          endsAt: at("2026-06-20", "07:50"),
        },
      });
    });
  });

  describe("events that are not ours", () => {
    it("are never changed or removed, whatever happens to the items", async () => {
      const target = await setup();
      const foreign = fake.addForeign(CALENDAR_ID, "Zahnarzt");
      const same = fake.addForeign(CALENDAR_ID, "Kaminfeger");
      const a = book();
      await sync(target.id);
      deleteAppointment(ctx(), a.id);
      await sync(target.id);
      const left = fake.get(CALENDAR_ID).events.map((e) => e.uid);
      expect(left).toEqual([foreign.uid, same.uid]);
      expect(
        fake.calls.filter((c) => c.step === "delete" && c.uid === foreign.uid),
      ).toEqual([]);
    });

    it("an event of ours that nothing remembers is taken over, not written twice", async () => {
      const target = await setup();
      book();
      await sync(target.id);
      test.db.delete(calendarLinks).run();
      fake.calls = [];
      const result = await sync(target.id);
      expect(result.counts).toMatchObject({ created: 0, updated: 1 });
      expect(fake.ours(CALENDAR_ID).size).toBe(1);
      expect(fake.get(CALENDAR_ID).events).toHaveLength(1);
      expect(listLinks(ctx(), target.id)).toHaveLength(1);
    });

    it("an event of ours whose item does not exist any more is removed", async () => {
      const target = await setup();
      const a = book();
      await sync(target.id);
      test.db.delete(calendarLinks).run();
      deleteAppointment(ctx(), a.id);
      const result = await sync(target.id);
      expect(result.counts.deleted).toBe(1);
      expect(fake.get(CALENDAR_ID).events).toEqual([]);
    });
  });

  describe("an event somebody deleted in the calendar", () => {
    async function deleteEvent() {
      const [event] = [...fake.ours(CALENDAR_ID).values()];
      fake.get(CALENDAR_ID).events = [];
      return event!;
    }

    it("is written again by default", async () => {
      const target = await setup();
      book();
      await sync(target.id);
      await deleteEvent();
      const result = await sync(target.id);
      expect(result.counts.created).toBe(1);
      expect(fake.ours(CALENDAR_ID).size).toBe(1);
    });

    it("stays deleted when the target says forget, even if the item changes, and the note goes with the item", async () => {
      const target = await setup({ config: { onRemoteDelete: "forget" } });
      const a = book();
      await sync(target.id);
      await deleteEvent();
      const result = await sync(target.id);
      expect(result.counts).toMatchObject({ created: 0, forgotten: 1 });
      expect(listLinks(ctx(), target.id)).toMatchObject([
        { status: "forgotten", remoteUid: null },
      ]);

      updateAppointment(ctx(), a.id, { title: "Anderer Titel" });
      fake.calls = [];
      expect((await sync(target.id)).counts).toMatchObject({
        created: 0,
        updated: 0,
      });
      expect(writes()).toEqual([]);
      expect(fake.get(CALENDAR_ID).events).toEqual([]);
      expect(await pending(target.id)).toBe(false);

      deleteAppointment(ctx(), a.id);
      await sync(target.id);
      expect(listLinks(ctx(), target.id)).toEqual([]);
    });
  });

  describe("calendars with fewer abilities", () => {
    it("a calendar that cannot change events gets the event deleted and written again", async () => {
      const target = await setup({ capabilities: CREATE_DELETE });
      const a = book();
      await sync(target.id);
      const [first] = [...fake.ours(CALENDAR_ID).values()];
      updateAppointment(ctx(), a.id, { title: "Neuer Titel" });
      fake.calls = [];
      const result = await sync(target.id);
      expect(result.counts).toMatchObject({ replaced: 1, updated: 0 });
      expect(writes().map((c) => c.step)).toEqual(["delete", "create"]);
      const [now] = [...fake.ours(CALENDAR_ID).values()];
      expect(now!.uid).not.toBe(first!.uid);
      expect(now!.item!.summary).toBe("Neuer Titel");
      expect(fake.get(CALENDAR_ID).events).toHaveLength(1);
    });

    it("a calendar that only creates keeps old events as they are and does not try again every time", async () => {
      const target = await setup({ capabilities: CREATE_ONLY });
      const a = book();
      const b = book({
        title: "Maler",
        startsAt: at("2026-06-21", "08:00"),
        endsAt: at("2026-06-21", "09:00"),
      });
      await sync(target.id);
      updateAppointment(ctx(), a.id, { title: "Neuer Titel" });
      deleteAppointment(ctx(), b.id);
      fake.calls = [];
      const result = await sync(target.id);
      expect(result).toMatchObject({
        ok: true,
        counts: {
          updated: 0,
          replaced: 0,
          deleted: 0,
          skipped: 1,
          forgotten: 1,
        },
      });
      expect(writes()).toEqual([]);
      expect(fake.get(CALENDAR_ID).events).toHaveLength(2);
      expect(await pending(target.id)).toBe(false);
      expect(listLinks(ctx(), target.id)).toHaveLength(1);

      // It still writes what is new.
      book({
        title: "Neu",
        startsAt: at("2026-06-23", "08:00"),
        endsAt: at("2026-06-23", "09:00"),
      });
      expect((await sync(target.id)).counts.created).toBe(1);
    });

    it("a calendar that does not tell the id of a new event has it found again by the marker", async () => {
      fake.reportsIds = false;
      const target = await setup();
      book();
      await sync(target.id);
      const [link] = listLinks(ctx(), target.id);
      const [event] = [...fake.ours(CALENDAR_ID).values()];
      expect(link!.remoteUid).toBe(event!.uid);
      fake.calls = [];
      await sync(target.id);
      expect(writes()).toEqual([]);
      expect(await pending(target.id)).toBe(false);
    });

    it("a calendar that gives its events no ids keeps what it has and does not try again every time", async () => {
      fake.hidesIds = true;
      fake.reportsIds = false;
      const target = await setup();
      const a = book();
      const b = book({
        title: "Maler",
        startsAt: at("2026-06-21", "08:00"),
        endsAt: at("2026-06-21", "09:00"),
      });
      expect((await sync(target.id)).ok).toBe(true);
      expect(await pending(target.id)).toBe(false);
      fake.calls = [];
      updateAppointment(ctx(), a.id, { title: "Kaminfeger kommt" });
      deleteAppointment(ctx(), b.id);
      const result = await sync(target.id);
      expect(result).toMatchObject({
        ok: true,
        counts: { updated: 0, deleted: 0, skipped: 1, forgotten: 1 },
      });
      expect(writes()).toEqual([]);
      expect(fake.get(CALENDAR_ID).events).toHaveLength(2);
      expect(await pending(target.id)).toBe(false);
      expect((await sync(target.id)).counts.skipped).toBe(0);
    });

    it("a calendar that drops the marker is noticed: nothing is written twice and the target says why", async () => {
      fake.dropsMarker = true;
      fake.reportsIds = false;
      vi.spyOn(console, "error").mockImplementation(() => {});
      const target = await setup();
      book();
      const first = await sync(target.id);
      expect(first).toMatchObject({
        ok: false,
        error: { code: "unconfirmed" },
        counts: { created: 1, unconfirmed: 1 },
      });
      expect(row(target.id)).toMatchObject({
        status: "error",
        lastError: "unconfirmed",
      });
      const second = await sync(target.id);
      expect(second.error?.code).toBe("unconfirmed");
      expect(second.counts.created).toBe(0);
      expect(fake.get(CALENDAR_ID).events).toHaveLength(1);
    });

    it("a calendar that drops the marker costs one stray event per run, not one per item", async () => {
      fake.dropsMarker = true;
      fake.reportsIds = false;
      vi.spyOn(console, "error").mockImplementation(() => {});
      const target = await setup();
      for (let i = 0; i < 3; i++) {
        book({
          title: `T${i}`,
          startsAt: at("2026-06-20", `0${i + 1}:00`),
          endsAt: at("2026-06-20", `0${i + 1}:30`),
        });
      }
      const first = await sync(target.id);
      expect(first).toMatchObject({
        ok: false,
        error: { code: "unconfirmed" },
        counts: { created: 1, unconfirmed: 1, remaining: 2 },
      });
      expect(fake.callsOf("create")).toHaveLength(1);
      expect(fake.get(CALENDAR_ID).events).toHaveLength(1);
      expect(row(target.id).lastError).toBe("unconfirmed");

      await sync(target.id);
      expect(fake.callsOf("create")).toHaveLength(2);
      expect(fake.get(CALENDAR_ID).events).toHaveLength(2);
    });

    it("looks the id of the first new event up at once and the others together, when the calendar keeps the marker", async () => {
      fake.reportsIds = false;
      const target = await setup();
      for (let i = 0; i < 3; i++) {
        book({
          title: `T${i}`,
          startsAt: at("2026-06-20", `0${i + 1}:00`),
          endsAt: at("2026-06-20", `0${i + 1}:30`),
        });
      }
      const result = await sync(target.id);
      expect(result).toMatchObject({ ok: true, counts: { created: 3 } });
      // One read for the plan, one to see that the first event kept its marker, one for the rest.
      expect(fake.callsOf("list")).toHaveLength(3);
      const uids = fake
        .get(CALENDAR_ID)
        .events.map((e) => e.uid)
        .sort();
      expect(
        listLinks(ctx(), target.id)
          .map((l) => l.remoteUid)
          .sort(),
      ).toEqual(uids);
      expect(await pending(target.id)).toBe(false);
    });

    it("needs no second look when the only new event was found at once", async () => {
      fake.reportsIds = false;
      const target = await setup();
      book();
      await sync(target.id);
      expect(fake.callsOf("list")).toHaveLength(2);
    });

    it("stops the run when the first new event cannot be looked up, and finds it again next time", async () => {
      fake.reportsIds = false;
      vi.spyOn(console, "error").mockImplementation(() => {});
      const target = await setup();
      for (let i = 0; i < 3; i++) {
        book({
          title: `T${i}`,
          startsAt: at("2026-06-20", `0${i + 1}:00`),
          endsAt: at("2026-06-20", `0${i + 1}:30`),
        });
      }
      fake.failNext("list", "timeout", 1, 1);
      const failed = await sync(target.id);
      expect(failed).toMatchObject({
        ok: false,
        error: { code: "timeout" },
        counts: { created: 1, failed: 1, remaining: 2 },
      });
      expect(fake.callsOf("create")).toHaveLength(1);
      const again = await sync(target.id);
      expect(again).toMatchObject({
        ok: true,
        counts: { created: 2, adopted: 1 },
      });
      expect(fake.get(CALENDAR_ID).events).toHaveLength(3);
      expect(await pending(target.id)).toBe(false);
    });

    it("an event that was never shown counts as deleted after half an hour, which is how a target recovers", async () => {
      fake.dropsMarker = true;
      fake.reportsIds = false;
      vi.spyOn(console, "error").mockImplementation(() => {});
      const target = await setup();
      book();
      const first = await sync(target.id);
      expect(first.error?.code).toBe("unconfirmed");

      // The calendar keeps the marker now. Within the wait nothing is written twice.
      fake.dropsMarker = false;
      const soon = await sync(target.id, {}, NOW + 20 * 60_000);
      expect(soon).toMatchObject({
        ok: false,
        error: { code: "unconfirmed" },
        counts: { created: 0, unconfirmed: 1 },
      });
      expect(fake.callsOf("create")).toHaveLength(1);

      const later = await sync(target.id, {}, NOW + 31 * 60_000);
      expect(later).toMatchObject({
        ok: true,
        counts: { created: 1, unconfirmed: 0 },
      });
      expect(fake.ours(CALENDAR_ID).size).toBe(1);
      expect(row(target.id)).toMatchObject({ status: "ok", lastError: null });
      const [link] = listLinks(ctx(), target.id);
      expect(link!.remoteUid).toBe(
        [...fake.ours(CALENDAR_ID).values()][0]!.uid,
      );
      expect(
        (await sync(target.id, {}, NOW + 32 * 60_000)).counts.created,
      ).toBe(0);
    });

    it("an event that was never shown stays deleted after half an hour when the target says forget", async () => {
      fake.dropsMarker = true;
      fake.reportsIds = false;
      vi.spyOn(console, "error").mockImplementation(() => {});
      const target = await setup({ config: { onRemoteDelete: "forget" } });
      book();
      await sync(target.id);
      const later = await sync(target.id, {}, NOW + 31 * 60_000);
      expect(later).toMatchObject({
        ok: true,
        counts: { created: 0, forgotten: 1, unconfirmed: 0 },
      });
      expect(listLinks(ctx(), target.id)).toMatchObject([
        { status: "forgotten" },
      ]);
      expect(fake.callsOf("create")).toHaveLength(1);
    });

    it("a calendar that cannot add events is not used", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const target = await setup();
      fake.get(CALENDAR_ID).capabilities = {
        ...FULL_CAPABILITIES,
        create: false,
      };
      book();
      const result = await sync(target.id);
      expect(result).toMatchObject({
        ok: false,
        error: { code: "unsupported" },
      });
      expect(row(target.id).lastError).toBe("unsupported");
      expect(writes()).toEqual([]);
    });
  });

  describe("failures", () => {
    it("are recorded with a code, counted in a row, and cleared by the next good run", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const target = await setup();
      book();
      fake.failNext("open", "unauthorized", 2);
      const first = await sync(target.id);
      expect(first).toMatchObject({
        ok: false,
        error: { code: "unauthorized" },
      });
      expect(row(target.id)).toMatchObject({
        status: "error",
        lastError: "unauthorized",
        consecutiveFailures: 1,
      });
      await sync(target.id);
      expect(row(target.id).consecutiveFailures).toBe(2);
      const ok = await sync(target.id);
      expect(ok.ok).toBe(true);
      expect(row(target.id)).toMatchObject({
        status: "ok",
        lastError: null,
        consecutiveFailures: 0,
      });
    });

    it("keep no counts of the run before when a run fails before it counted anything", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const target = await setup();
      book();
      await sync(target.id);
      expect(row(target.id).lastStatsJson).toMatchObject({ created: 1 });
      fake.failNext("open", "unauthorized");
      await sync(target.id);
      expect(row(target.id)).toMatchObject({
        status: "error",
        lastStatsJson: null,
      });
      book({
        title: "Maler",
        startsAt: at("2026-06-21", "08:00"),
        endsAt: at("2026-06-21", "09:00"),
      });
      fake.failNext("create", "bad_request", 1);
      await sync(target.id, {}, NOW + 120_000);
      // A run that did count keeps its counts, failures included.
      expect(row(target.id).lastStatsJson).toMatchObject({ failed: 1 });
    });

    it("name a calendar that is gone", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const target = await setup();
      fake.calendars.delete(CALENDAR_ID);
      const result = await sync(target.id);
      expect(result.error?.code).toBe("calendar_missing");
    });

    it("name a calendar whose events cannot be read", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const target = await setup();
      book();
      fake.failNext("list", "timeout");
      const result = await sync(target.id);
      expect(result).toMatchObject({ ok: false, error: { code: "timeout" } });
      expect(writes()).toEqual([]);
    });

    it("stop the run when the calendar system is out of reach, and say how much is left", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const target = await setup();
      for (let i = 0; i < 4; i++) {
        book({
          title: `T${i}`,
          startsAt: at("2026-06-20", `0${i + 1}:00`),
          endsAt: at("2026-06-20", `0${i + 1}:30`),
        });
      }
      fake.failNext("create", "network", 100);
      const result = await sync(target.id);
      expect(result).toMatchObject({
        ok: false,
        error: { code: "network" },
        counts: { created: 0, failed: 1, remaining: 3 },
      });
      expect(fake.callsOf("create")).toHaveLength(1);
      expect(row(target.id).lastError).toBe("network");
    });

    it("go on with the other events when one is refused", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const target = await setup();
      for (let i = 0; i < 3; i++) {
        book({
          title: `T${i}`,
          startsAt: at("2026-06-20", `0${i + 1}:00`),
          endsAt: at("2026-06-20", `0${i + 1}:30`),
        });
      }
      fake.failNext("create", "bad_request", 1);
      const result = await sync(target.id);
      expect(result).toMatchObject({
        ok: false,
        error: { code: "bad_request" },
        counts: { created: 2, failed: 1 },
      });
      expect(fake.ours(CALENDAR_ID).size).toBe(2);
      // The one that was refused is tried again, and only that one.
      fake.calls = [];
      const again = await sync(target.id);
      expect(again).toMatchObject({ ok: true, counts: { created: 1 } });
      expect(fake.ours(CALENDAR_ID).size).toBe(3);
    });

    it("keep the old event when deleting before writing again failed", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const target = await setup({ capabilities: CREATE_DELETE });
      const a = book();
      await sync(target.id);
      updateAppointment(ctx(), a.id, { title: "Neu" });
      fake.failNext("delete", "bad_request", 1);
      const failed = await sync(target.id);
      expect(failed.ok).toBe(false);
      expect(fake.get(CALENDAR_ID).events).toHaveLength(1);
      expect((await sync(target.id)).ok).toBe(true);
      expect([...fake.ours(CALENDAR_ID).values()][0]!.item!.summary).toBe(
        "Neu",
      );
    });

    it("write the event again when only the new event failed after the old one was deleted", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const target = await setup({
        capabilities: CREATE_DELETE,
        config: { onRemoteDelete: "forget" },
      });
      const a = book();
      await sync(target.id);
      updateAppointment(ctx(), a.id, { title: "Neu" });
      fake.failNext("create", "bad_request", 1);
      expect((await sync(target.id)).ok).toBe(false);
      expect(fake.get(CALENDAR_ID).events).toEqual([]);
      // Not mistaken for an event somebody deleted on purpose.
      const result = await sync(target.id);
      expect(result.ok).toBe(true);
      expect(fake.ours(CALENDAR_ID).size).toBe(1);
    });

    it("write an event again when it was deleted between the look and the change", async () => {
      const target = await setup();
      const a = book();
      await sync(target.id);
      updateAppointment(ctx(), a.id, { title: "Neu" });
      fake.onCall = (call) => {
        if (call.step === "update") fake.get(CALENDAR_ID).events = [];
      };
      const result = await sync(target.id);
      expect(result).toMatchObject({
        ok: true,
        counts: { updated: 0, created: 1, failed: 0 },
      });
      expect([...fake.ours(CALENDAR_ID).values()][0]!.item!.summary).toBe(
        "Neu",
      );
      fake.onCall = null;
      expect(await pending(target.id)).toBe(false);
    });

    it("leave an event deleted between the look and the change deleted when the target says forget", async () => {
      const target = await setup({ config: { onRemoteDelete: "forget" } });
      const a = book();
      await sync(target.id);
      updateAppointment(ctx(), a.id, { title: "Neu" });
      fake.onCall = (call) => {
        if (call.step === "update") fake.get(CALENDAR_ID).events = [];
      };
      const result = await sync(target.id);
      expect(result).toMatchObject({
        ok: true,
        counts: { updated: 0, created: 0, forgotten: 1, failed: 0 },
      });
      expect(fake.get(CALENDAR_ID).events).toEqual([]);
      expect(listLinks(ctx(), target.id)).toMatchObject([
        { status: "forgotten" },
      ]);
    });

    it("treat an event that is gone already as deleted", async () => {
      const target = await setup();
      const a = book();
      await sync(target.id);
      deleteAppointment(ctx(), a.id);
      fake.failNext("delete", "not_found", 1);
      const result = await sync(target.id);
      expect(result.ok).toBe(true);
      expect(listLinks(ctx(), target.id)).toEqual([]);
    });
  });

  describe("the size of a run", () => {
    it("is limited, and what is left is done by the next run", async () => {
      const target = await setup();
      for (let i = 0; i < 5; i++) {
        book({
          title: `T${i}`,
          startsAt: at("2026-06-20", `0${i + 1}:00`),
          endsAt: at("2026-06-20", `0${i + 1}:30`),
        });
      }
      const first = await sync(target.id, { maxOperations: 2 });
      expect(first).toMatchObject({
        ok: true,
        counts: { created: 2, remaining: 3 },
      });
      const second = await sync(target.id, { maxOperations: 2 });
      expect(second.counts).toMatchObject({ created: 2, remaining: 1 });
      const third = await sync(target.id, { maxOperations: 2 });
      expect(third.counts).toMatchObject({ created: 1, remaining: 0 });
      expect(fake.ours(CALENDAR_ID).size).toBe(5);
    });

    describe("with a calendar that can only delete and create", () => {
      async function three() {
        const target = await setup({ capabilities: CREATE_DELETE });
        const items = [0, 1, 2].map((i) =>
          book({
            title: `T${i}`,
            startsAt: at("2026-06-20", `0${i + 1}:00`),
            endsAt: at("2026-06-20", `0${i + 1}:30`),
          }),
        );
        await sync(target.id);
        for (const item of items) {
          updateAppointment(ctx(), item.id, { title: `Neu ${item.title}` });
        }
        fake.calls = [];
        return target;
      }

      it("counts a replace as the two calls it makes", async () => {
        const target = await three();
        const result = await sync(target.id, { maxOperations: 4 });
        expect(result.counts).toMatchObject({ replaced: 2, remaining: 1 });
        expect(writes()).toHaveLength(4);
        const rest = await sync(target.id, { maxOperations: 4 });
        expect(rest.counts).toMatchObject({ replaced: 1, remaining: 0 });
      });

      it("does one replace even when the limit is smaller than that", async () => {
        const target = await three();
        const result = await sync(target.id, { maxOperations: 1 });
        expect(result.counts).toMatchObject({ replaced: 1, remaining: 2 });
      });

      it("goes on to write the event when the old one is gone already", async () => {
        const target = await three();
        fake.failNext("delete", "not_found", 1);
        const result = await sync(target.id);
        expect(result).toMatchObject({
          ok: true,
          counts: { replaced: 3, failed: 0 },
        });
        expect(fake.ours(CALENDAR_ID).size).toBe(3);
      });
    });

    it("writes the nearest items first", async () => {
      const target = await setup();
      book({
        title: "Spät",
        startsAt: at("2026-09-01", "09:00"),
        endsAt: at("2026-09-01", "10:00"),
      });
      book({
        title: "Früh",
        startsAt: at("2026-06-16", "09:00"),
        endsAt: at("2026-06-16", "10:00"),
      });
      await sync(target.id, { maxOperations: 1 });
      expect(
        [...fake.ours(CALENDAR_ID).values()].map((e) => e.item!.summary),
      ).toEqual(["Früh"]);
    });
  });

  describe("what is not a run", () => {
    it("reports a target that is switched off, a connection that is switched off and a missing adapter without touching its health", async () => {
      const target = await setup();
      fake.calls = [];
      test.db
        .update(calendarTargets)
        .set({ enabled: false })
        .where(eq(calendarTargets.id, target.id))
        .run();
      expect((await sync(target.id)).error?.code).toBe("disabled");
      test.db
        .update(calendarTargets)
        .set({ enabled: true })
        .where(eq(calendarTargets.id, target.id))
        .run();
      test.db.update(connections).set({ enabled: false }).run();
      expect((await sync(target.id)).error?.code).toBe("no_connection");
      test.db.update(connections).set({ enabled: true }).run();
      fake.detach();
      expect((await sync(target.id)).error?.code).toBe("provider_unavailable");
      expect(row(target.id)).toMatchObject({
        status: "unknown",
        consecutiveFailures: 0,
        lastCheckedAt: null,
      });
      expect(fake.calls).toEqual([]);
    });

    it("does not run twice at once for one target", async () => {
      const target = await setup();
      book();
      const [one, two] = await Promise.all([sync(target.id), sync(target.id)]);
      const results = [one, two];
      expect(results.filter((r) => r.error?.code === "busy")).toHaveLength(1);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(fake.ours(CALENDAR_ID).size).toBe(1);
    });

    it("is a 404 for a target that does not exist", async () => {
      await expect(sync("missing")).rejects.toMatchObject({
        code: "not_found",
      });
    });
  });

  it("keeps working for each kind of item that can be carried", async () => {
    const kinds: CalendarItemKind[] = [
      "appointments",
      "task_due",
      "preparations",
      "defect_deadlines",
      "insurance_deadlines",
      "warranty_ends",
    ];
    const target = await setup({ kinds });
    await makeTask(ctx(), { trigger: everyDays(30, "2026-06-22") });
    book();
    expect((await sync(target.id)).ok).toBe(true);
    const task = await makeTask(ctx(), {
      trigger: everyDays(30, "2026-06-25"),
    });
    await updateTask(ctx(), task.id, { title: "Neu" });
    expect((await sync(target.id)).counts.created).toBe(1);
  });
});
