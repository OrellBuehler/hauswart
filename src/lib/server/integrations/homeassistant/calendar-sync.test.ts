import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAppointment,
  deleteAppointment,
  updateAppointment,
} from "$lib/server/appointments/appointments";
import { calendarLinks } from "$lib/server/db";
import { calendarTargetConfigSchema } from "$lib/api/schemas/calendar-sync";
import { registerCalendarProvider } from "$lib/server/calendar-sync/provider";
import { listLinks } from "$lib/server/calendar-sync/links";
import { syncTarget } from "$lib/server/calendar-sync/sync";
import {
  createTarget,
  deleteTarget,
  type Caller,
} from "$lib/server/calendar-sync/targets";
import { getTargetRow } from "$lib/server/calendar-sync/store";
import { completeTask } from "$lib/server/tasks/completions";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt, everyDays, makeTask, NOW } from "$lib/testing/domain";
import { createCalendarProvider } from "./calendar-provider";
import {
  CREATE_DELETE_CALENDAR,
  CREATE_ONLY_CALENDAR,
  FULL_CALENDAR,
} from "./fake-server";
import { useFakeHomeAssistant } from "./testing";

const CAL = "calendar.example_household";
const ADMIN: Caller = { id: "admin-user", admin: true, locale: "de" };

describe("pushing items into a Home Assistant calendar", () => {
  const test = useTestDB();
  const { fake, connect } = useFakeHomeAssistant();
  const ctx = (now = NOW) => ctxAt(test.db, now);
  let off: () => void = () => {};
  beforeEach(() => {
    off = registerCalendarProvider(
      createCalendarProvider({ retry: { sleep: async () => {} } }),
    );
  });
  afterEach(() => {
    off();
    vi.restoreAllMocks();
  });

  async function setup(
    features = FULL_CALENDAR,
    config: Record<string, unknown> = {},
  ) {
    connect();
    fake.addCalendar(CAL, [], "Haushalt", features);
    return createTarget(ctx(), ADMIN, {
      provider: "homeassistant",
      remoteCalendarId: CAL,
      enabled: true,
      config: calendarTargetConfigSchema.parse({
        kinds: ["appointments", "task_due"],
        ...config,
      }),
    });
  }
  const book = (
    title = "Kaminfeger",
    day = "2026-06-20",
    over: Partial<Parameters<typeof createAppointment>[1]> = {},
  ) =>
    createAppointment(
      ctx(),
      {
        title,
        startsAt: at(day, "09:00"),
        endsAt: at(day, "10:30"),
        ...over,
      },
      null,
    );
  const sync = (id: string) => syncTarget(ctx(), id);
  const ours = () =>
    fake
      .calendarEvents(CAL)
      .filter((e) => e.description?.includes("@sync.hauswart"));
  const writes = () =>
    fake.requests.filter(
      (r) =>
        r.method === "POST" && r.path.startsWith("/api/services/calendar/"),
    ).length +
    fake.wsMessages.filter((m) =>
      /^calendar\/event\//.test((m as { type: string }).type),
    ).length;
  const calendarCommands = () =>
    fake.wsMessages
      .map((m) => (m as { type: string }).type)
      .filter((t) => t.startsWith("calendar/event/"));

  describe("a calendar like the Local Calendar (create, update, delete)", () => {
    it("writes appointments and due dates, finds the ids Home Assistant gave them, and then has nothing to do", async () => {
      const target = await setup();
      const a = book();
      const task = await makeTask(ctx(), {
        title: "Filter wechseln",
        trigger: everyDays(30, "2026-06-22"),
      });
      const result = await sync(target.id);
      expect(result).toMatchObject({
        ok: true,
        counts: { created: 2, failed: 0 },
      });
      expect(
        fake.calendarEvents(CAL).map((e) => [e.summary, e.start, e.end]),
      ).toEqual([
        [
          "Kaminfeger",
          { dateTime: "2026-06-20T09:00:00+02:00" },
          { dateTime: "2026-06-20T10:30:00+02:00" },
        ],
        ["Filter wechseln", { date: "2026-06-22" }, { date: "2026-06-23" }],
      ]);
      // Home Assistant does not say which id an event got: the run found them again by the marker.
      const links = listLinks(ctx(), target.id);
      expect(links.map((l) => l.remoteUid).sort()).toEqual(
        fake
          .calendarEvents(CAL)
          .map((e) => e.uid)
          .sort(),
      );
      expect(links.map((l) => l.ref).sort()).toEqual(
        [`appointment-${a.id}`, `task-${task.id}-2026-06-22`].sort(),
      );
      expect(getTargetRow(ctx(), target.id)).toMatchObject({
        status: "ok",
        capabilitiesJson: {
          create: true,
          update: true,
          delete: true,
          alarms: false,
        },
      });

      const before = writes();
      const again = await sync(target.id);
      expect(again).toMatchObject({
        ok: true,
        counts: { created: 0, updated: 0, deleted: 0, adopted: 0 },
      });
      expect(writes()).toBe(before);
    });

    it("writes times in the zone of Home Assistant when that is not the household's", async () => {
      fake.timeZone = "America/New_York";
      const target = await setup();
      book();
      await sync(target.id);
      const [event] = fake.calendarEvents(CAL);
      expect(
        (fake.serviceCalls.at(-1)!.data as Record<string, string>)
          .start_date_time,
      ).toBe("2026-06-20T03:00:00");
      expect(Date.parse((event!.start as { dateTime: string }).dateTime)).toBe(
        at("2026-06-20", "09:00"),
      );
      expect(Date.parse((event!.end as { dateTime: string }).dateTime)).toBe(
        at("2026-06-20", "10:30"),
      );
    });

    it("writes an all-day appointment over three days as dates with the exclusive end", async () => {
      const target = await setup();
      book("Maler", "2026-06-22", {
        allDay: true,
        startDate: "2026-06-22",
        endDate: "2026-06-24",
        startsAt: undefined,
        endsAt: undefined,
      });
      await sync(target.id);
      expect(fake.calendarEvents(CAL).map((e) => [e.start, e.end])).toEqual([
        [{ date: "2026-06-22" }, { date: "2026-06-25" }],
      ]);
    });

    it("puts due dates at the time the target asks for", async () => {
      const target = await setup(FULL_CALENDAR, {
        kinds: ["task_due"],
        timedMode: "timed",
        dueTime: "07:30",
        dueDurationMinutes: 20,
        titlePrefix: "[H] ",
      });
      await makeTask(ctx(), {
        title: "Filter wechseln",
        trigger: everyDays(30, "2026-06-22"),
      });
      await sync(target.id);
      expect(
        fake.calendarEvents(CAL).map((e) => [e.summary, e.start, e.end]),
      ).toEqual([
        [
          "[H] Filter wechseln",
          { dateTime: "2026-06-22T07:30:00+02:00" },
          { dateTime: "2026-06-22T07:50:00+02:00" },
        ],
      ]);
    });

    it("changes an event in place, and removes it when the item goes", async () => {
      const target = await setup();
      const a = book();
      const b = book("Maler", "2026-06-23");
      await sync(target.id);
      const uids = Object.fromEntries(
        fake.calendarEvents(CAL).map((e) => [e.summary, e.uid]),
      );

      updateAppointment(ctx(), a.id, { title: "Kaminfeger kommt" });
      deleteAppointment(ctx(), b.id);
      const result = await sync(target.id);
      expect(result.counts).toMatchObject({ updated: 1, deleted: 1 });
      expect(fake.calendarEvents(CAL).map((e) => [e.summary, e.uid])).toEqual([
        ["Kaminfeger kommt", uids["Kaminfeger"]],
      ]);
      expect(calendarCommands()).toEqual([
        "calendar/event/delete",
        "calendar/event/update",
      ]);
    });

    it("moves a recurring task to its next occurrence when it is done", async () => {
      const target = await setup(
        {}.constructor === Object ? FULL_CALENDAR : 0,
        {
          kinds: ["task_due"],
        },
      );
      const task = await makeTask(ctx(), {
        title: "Filter wechseln",
        trigger: everyDays(30, "2026-06-20"),
      });
      await sync(target.id);
      await completeTask(ctx(), task.id, {
        kind: "done",
        source: "manual",
        userId: null,
      });
      const result = await sync(target.id);
      expect(result.counts).toMatchObject({ created: 1, deleted: 1 });
      expect(fake.calendarEvents(CAL).map((e) => e.start)).toEqual([
        { date: "2026-07-15" },
      ]);
    });

    it("never touches events that are not its own", async () => {
      const target = await setup();
      fake.calendarEvents(CAL).push(
        {
          summary: "Zahnarzt",
          start: { date: "2026-06-20" },
          end: { date: "2026-06-21" },
          description: "Bei Dr. Beispiel",
          uid: "foreign-1",
        },
        {
          summary: "Kaminfeger",
          start: { date: "2026-06-20" },
          end: { date: "2026-06-21" },
          uid: "foreign-2",
        },
      );
      const a = book();
      await sync(target.id);
      deleteAppointment(ctx(), a.id);
      await sync(target.id);
      expect(fake.calendarEvents(CAL).map((e) => e.uid)).toEqual([
        "foreign-1",
        "foreign-2",
      ]);
      await deleteTarget(ctx(), ADMIN, target.id, { removeRemote: true });
      expect(fake.calendarEvents(CAL).map((e) => e.uid)).toEqual([
        "foreign-1",
        "foreign-2",
      ]);
    });

    it("takes over its own events after the links were lost, without writing them twice", async () => {
      const target = await setup();
      book();
      await sync(target.id);
      test.db.delete(calendarLinks).run();
      const result = await sync(target.id);
      expect(result.counts).toMatchObject({ created: 0, updated: 1 });
      expect(fake.calendarEvents(CAL)).toHaveLength(1);
    });

    it("removes everything it wrote when the target goes with removeRemote", async () => {
      const target = await setup();
      book();
      book("Maler", "2026-06-23");
      await sync(target.id);
      expect(ours()).toHaveLength(2);
      await deleteTarget(ctx(), ADMIN, target.id, { removeRemote: true });
      expect(fake.calendarEvents(CAL)).toEqual([]);
    });
  });

  describe("an event somebody deleted in Home Assistant", () => {
    it("is written again by default", async () => {
      const target = await setup();
      book();
      await sync(target.id);
      fake.calendarEvents(CAL).length = 0;
      const result = await sync(target.id);
      expect(result.counts.created).toBe(1);
      expect(ours()).toHaveLength(1);
    });

    it("stays deleted when the target says forget, and the target says so in its numbers", async () => {
      const target = await setup(FULL_CALENDAR, { onRemoteDelete: "forget" });
      book();
      await sync(target.id);
      fake.calendarEvents(CAL).length = 0;
      const result = await sync(target.id);
      expect(result.counts).toMatchObject({ created: 0, forgotten: 1 });
      await sync(target.id);
      expect(fake.calendarEvents(CAL)).toEqual([]);
      expect(listLinks(ctx(), target.id)).toMatchObject([
        { status: "forgotten" },
      ]);
    });
  });

  describe("a calendar that only takes new events (the CalDAV integration)", () => {
    it("writes what is new and leaves old events as they are, without failing or trying again", async () => {
      const target = await setup(CREATE_ONLY_CALENDAR);
      const a = book();
      const b = book("Maler", "2026-06-23");
      await sync(target.id);
      updateAppointment(ctx(), a.id, { title: "Kaminfeger kommt" });
      deleteAppointment(ctx(), b.id);
      const before = writes();
      const result = await sync(target.id);
      expect(result).toMatchObject({
        ok: true,
        counts: { updated: 0, deleted: 0, skipped: 1, forgotten: 1, failed: 0 },
      });
      expect(writes()).toBe(before);
      expect(
        fake
          .calendarEvents(CAL)
          .map((e) => e.summary)
          .sort(),
      ).toEqual(["Kaminfeger", "Maler"]);
      expect(calendarCommands()).toEqual([]);
      // Nothing more to do now, and a new item is still written.
      expect((await sync(target.id)).counts.skipped).toBe(0);
      book("Neu", "2026-06-25");
      expect((await sync(target.id)).counts.created).toBe(1);
    });

    it("cannot remove the events with the target, and says so before changing anything", async () => {
      const target = await setup(CREATE_ONLY_CALENDAR);
      book();
      await sync(target.id);
      await expect(
        deleteTarget(ctx(), ADMIN, target.id, { removeRemote: true }),
      ).rejects.toMatchObject({ code: "invalid_request" });
      expect(fake.calendarEvents(CAL)).toHaveLength(1);
    });
  });

  describe("a calendar that creates and deletes but cannot change an event (Google Calendar)", () => {
    it("deletes the event and writes it again", async () => {
      const target = await setup(CREATE_DELETE_CALENDAR);
      const a = book();
      await sync(target.id);
      const [first] = fake.calendarEvents(CAL);
      updateAppointment(ctx(), a.id, { title: "Kaminfeger kommt" });
      const result = await sync(target.id);
      expect(result.counts).toMatchObject({
        replaced: 1,
        updated: 0,
        failed: 0,
      });
      expect(calendarCommands()).toEqual(["calendar/event/delete"]);
      const events = fake.calendarEvents(CAL);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ summary: "Kaminfeger kommt" });
      expect(events[0]!.uid).not.toBe(first!.uid);
      expect(listLinks(ctx(), target.id)[0]!.remoteUid).toBe(events[0]!.uid);
    });
  });

  describe("a calendar that cannot be written to", () => {
    it("is not offered as a target", async () => {
      connect();
      fake.addCalendar(CAL, [], "Abfall");
      await expect(
        createTarget(ctx(), ADMIN, {
          provider: "homeassistant",
          remoteCalendarId: CAL,
          enabled: true,
          config: calendarTargetConfigSchema.parse({ kinds: ["appointments"] }),
        }),
      ).rejects.toMatchObject({ code: "invalid_request" });
    });

    it("is reported when it loses the ability later", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const target = await setup();
      book();
      fake.calendars.get(CAL)!.features = 0;
      const result = await sync(target.id);
      expect(result).toMatchObject({
        ok: false,
        error: { code: "unsupported" },
      });
      expect(fake.calendarEvents(CAL)).toEqual([]);
    });
  });

  describe("failures", () => {
    it("are recorded on the target with the code Home Assistant's answer maps to", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const target = await setup();
      book();
      fake.token = "another-token";
      const result = await sync(target.id);
      expect(result).toMatchObject({
        ok: false,
        error: { code: "unauthorized" },
      });
      expect(getTargetRow(ctx(), target.id)).toMatchObject({
        status: "error",
        lastError: "unauthorized",
        consecutiveFailures: 1,
      });
      fake.token = "test-token";
      expect((await sync(target.id)).ok).toBe(true);
      expect(getTargetRow(ctx(), target.id)).toMatchObject({
        status: "ok",
        lastError: null,
        consecutiveFailures: 0,
      });
    });

    it("name a calendar that was removed from Home Assistant", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const target = await setup();
      fake.calendars.delete(CAL);
      expect((await sync(target.id)).error?.code).toBe("calendar_missing");
    });

    it("stop after a server error without writing the rest, and go on later", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const target = await setup();
      book("A", "2026-06-20");
      book("B", "2026-06-21");
      fake.failNext("/api/services/calendar/create_event", 500, 1);
      const failed = await sync(target.id);
      expect(failed).toMatchObject({
        ok: false,
        error: { code: "server" },
        counts: { created: 0, failed: 1, remaining: 1 },
      });
      const ok = await sync(target.id);
      expect(ok).toMatchObject({ ok: true, counts: { created: 2 } });
      expect(ours()).toHaveLength(2);
    });

    it("never put the token, the address or the text of an event into the log", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const target = await setup();
      book("Geheimer Titel");
      fake.token = "another-token";
      await sync(target.id);
      const logged = error.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain("calendar_sync.failed");
      for (const secret of [
        "test-token",
        "another-token",
        "127.0.0.1",
        "Geheimer Titel",
        CAL,
      ]) {
        expect(logged).not.toContain(secret);
      }
    });
  });
});
