import { describe, expect, it } from "vitest";
import { createApiClient } from "../../src/lib/api/client";
import { endpoints } from "../../src/lib/api/registry";
import { zonedTimeToInstant } from "../../src/lib/dates";
import { createInProcessFetch } from "../../src/lib/testing/api";
import { everyDays, useMcp, type Json } from "./test-harness";

describe("appointment tools", () => {
  const mcp = useMcp();

  async function world(scopes: ("read" | "write")[] = ["read", "write"]) {
    const connected = await mcp.connect({ scopes });
    const zone = connected.server.context.household.timezone;
    const api = createApiClient(
      createInProcessFetch({ bearer: connected.token }),
      "http://localhost",
      { token: connected.token },
    );
    const iso = (day: string, time: string) =>
      new Date(zonedTimeToInstant(day, time, zone)).toISOString();
    const book = (args: Record<string, unknown> = {}) =>
      connected.ok("create_appointment", {
        title: "Kaminfeger",
        date: connected.day(10),
        startTime: "09:00",
        endTime: "10:30",
        ...args,
      });
    const stored = async (id: string) =>
      (
        await connected.ok("list_appointments", {
          from: connected.day(-30),
          status: "all",
        })
      ).appointments.find((a: { id: string }) => a.id === id) as Json;
    return { ...connected, zone, api, iso, book, stored };
  }

  describe("create_appointment", () => {
    it("books a timed appointment in the household time zone", async () => {
      const { ok, api, book, day, iso } = await world();
      const a = await book({
        location: "Keller",
        notes: "Leiter bereitstellen",
      });
      expect(a).toMatchObject({
        title: "Kaminfeger",
        when: `${day(10)} 09:00-10:30`,
        location: "Keller",
      });
      const stored = await api.call(endpoints.appointmentsGet, {
        params: { id: a.id },
      });
      expect(stored).toMatchObject({
        allDay: false,
        startsAt: iso(day(10), "09:00"),
        endsAt: iso(day(10), "10:30"),
        notes: "Leiter bereitstellen",
        status: "planned",
      });
      expect(
        (await ok("list_appointments", { from: day(10), to: day(10) }))
          .appointments,
      ).toHaveLength(1);
    });

    it("gives an appointment without an end an hour", async () => {
      const { book, day } = await world();
      const a = await book({ endTime: undefined });
      expect(a.when).toBe(`${day(10)} 09:00-10:00`);
    });

    it("ends on another day when endDate says so", async () => {
      const { book, day } = await world();
      const a = await book({
        startTime: "22:00",
        endTime: "01:00",
        endDate: day(11),
      });
      expect(a.when).toBe(`${day(10)} 22:00-${day(11)} 01:00`);
    });

    it("books an all-day appointment without a start time, of several days with endDate", async () => {
      const { book, day } = await world();
      const one = await book({ startTime: undefined, endTime: undefined });
      expect(one.when).toBe(`${day(10)}, all day`);
      const many = await book({
        title: "Maler",
        startTime: undefined,
        endTime: undefined,
        endDate: day(12),
      });
      expect(many.when).toBe(`${day(10)} to ${day(12)}, all day`);
    });

    it("links a task by title, a device and a contact by name, and takes the asset of the task", async () => {
      const { ok, api, book } = await world();
      await ok("create_asset", { name: "Heizung" });
      await ok("create_asset", { name: "Boiler" });
      await api.call(endpoints.contactsCreate, {
        body: { name: "Muster Haustechnik AG" },
      });
      await ok("create_task", {
        title: "Heizung warten",
        asset: "Heizung",
        trigger: everyDays(30, "2030-01-01"),
      });
      const a = await book({
        task: "heizung warten",
        contact: "Muster Haustechnik",
      });
      expect(a).toMatchObject({
        task: "Heizung warten",
        asset: "Heizung",
        contact: "Muster Haustechnik AG",
      });
      const other = await book({ task: "Heizung warten", asset: "Boiler" });
      expect(other.asset).toBe("Boiler");
      expect((await ok("list_tasks")).tasks[0].appointment).toMatchObject({
        id: expect.any(String),
      });
    });

    it("refuses an end time without a start time, a bad time and an end before the start", async () => {
      const { call, day } = await world();
      const noStart = await call("create_appointment", {
        title: "x",
        date: day(10),
        endTime: "10:00",
      });
      expect(noStart.isError).toBe(true);
      expect(noStart.text).toContain("[invalid_request]");
      const bad = await call("create_appointment", {
        title: "x",
        date: day(10),
        startTime: "25:00",
      });
      expect(bad.isError).toBe(true);
      const before = await call("create_appointment", {
        title: "x",
        date: day(10),
        startTime: "10:00",
        endTime: "09:00",
      });
      expect(before.isError).toBe(true);
      expect(before.text).toContain("[invalid_request]");
      const long = await call("create_appointment", {
        title: "x",
        date: day(10),
        endDate: day(40),
      });
      expect(long.isError).toBe(true);
    });

    it("says what is unknown or ambiguous", async () => {
      const { ok, call, day } = await world();
      await ok("create_task", {
        title: "Filter Küche",
        trigger: everyDays(30, "2030-01-01"),
      });
      await ok("create_task", {
        title: "Filter Bad",
        trigger: everyDays(30, "2030-01-01"),
      });
      const ambiguous = await call("create_appointment", {
        title: "x",
        date: day(10),
        task: "Filter",
      });
      expect(ambiguous.isError).toBe(true);
      expect(ambiguous.text).toContain("ambiguous");
      expect(ambiguous.text).toContain("Filter Bad");
      const missing = await call("create_appointment", {
        title: "x",
        date: day(10),
        task: "Nope",
      });
      expect(missing.text).toContain("[not_found]");
      const asset = await call("create_appointment", {
        title: "x",
        date: day(10),
        asset: "Nope",
      });
      expect(asset.text).toContain("[not_found]");
      const contact = await call("create_appointment", {
        title: "x",
        date: day(10),
        contact: "Nope",
      });
      expect(contact.text).toContain("[not_found]");
    });
  });

  describe("list_appointments", () => {
    it("lists planned appointments from today on, soonest first, and hides the rest", async () => {
      const { ok, book, day } = await world();
      const later = await book({ title: "Später", date: day(20) });
      const sooner = await book({ title: "Früher", date: day(2) });
      const cancelled = await book({ title: "Abgesagt", date: day(5) });
      await ok("update_appointment", { id: cancelled.id, status: "cancelled" });
      const done = await book({ title: "Erledigt", date: day(3) });
      await ok("update_appointment", { id: done.id, status: "done" });
      const titles = async (args: Record<string, unknown> = {}) =>
        (await ok("list_appointments", args)).appointments.map(
          (a: Json) => a.title,
        );
      const list = await ok("list_appointments");
      expect(list.appointments.map((a: Json) => a.id)).toEqual([
        sooner.id,
        later.id,
      ]);
      expect(await titles({ status: "all" })).toEqual([
        "Früher",
        "Erledigt",
        "Abgesagt",
        "Später",
      ]);
      expect(
        await titles({ from: day(3), to: day(10), status: "all" }),
      ).toEqual(["Erledigt", "Abgesagt"]);
      expect(await titles({ from: day(2), to: day(5) })).toEqual(["Früher"]);
      expect(await titles({ status: "cancelled" })).toEqual(["Abgesagt"]);
      expect(await titles({ status: "done" })).toEqual(["Erledigt"]);
      const all = await ok("list_appointments", { status: "all" });
      expect(all.appointments[2].status).toBe("cancelled");
      expect(all.appointments[0].status).toBeUndefined();
    });

    it("shows a planned appointment that is over but was never closed, up to 30 days back", async () => {
      const { ok, book, day } = await world();
      await book({ title: "Bald", date: day(2) });
      await book({ title: "Gestern", date: day(-1) });
      await book({ title: "Vor 30 Tagen", date: day(-30) });
      await book({ title: "Vor 31 Tagen", date: day(-31) });
      const closed = await book({
        title: "Vor 5 Tagen, erledigt",
        date: day(-5),
      });
      await ok("update_appointment", { id: closed.id, status: "done" });
      const listed = async (args: Record<string, unknown> = {}) =>
        (await ok("list_appointments", args)).appointments as Json[];

      const planned = await listed();
      expect(planned.map((a) => a.title)).toEqual([
        "Vor 30 Tagen",
        "Gestern",
        "Bald",
      ]);
      expect(planned.map((a) => a.overdue)).toEqual([true, true, undefined]);

      expect((await listed({ status: "done" })).map((a) => a.title)).toEqual(
        [],
      );
      expect((await listed({ status: "all" })).map((a) => a.title)).toEqual([
        "Bald",
      ]);
      expect(
        (await listed({ from: day(-60), status: "all" })).map((a) => a.title),
      ).toEqual([
        "Vor 31 Tagen",
        "Vor 30 Tagen",
        "Vor 5 Tagen, erledigt",
        "Gestern",
        "Bald",
      ]);
      expect(
        (await listed({ from: day(-60), status: "all" })).map((a) => a.overdue),
      ).toEqual([true, true, undefined, true, undefined]);
      expect((await listed({ from: day(0) })).map((a) => a.title)).toEqual([
        "Bald",
      ]);
    });

    it("says from which day it looked", async () => {
      const { call, day } = await world();
      expect((await call("list_appointments")).summary).toBe(
        `0 appointments from ${day(-30)}.`,
      );
      expect((await call("list_appointments", { status: "all" })).summary).toBe(
        `0 appointments from ${day(0)}.`,
      );
      expect(
        (await call("list_appointments", { from: day(3), to: day(9) })).summary,
      ).toBe(`0 appointments from ${day(3)} to ${day(9)}.`);
    });

    it("filters by task, device and contact given by name", async () => {
      const { ok, book, day } = await world();
      await ok("create_asset", { name: "Heizung" });
      await ok("create_asset", { name: "Boiler" });
      await ok("create_task", {
        title: "Heizung warten",
        trigger: everyDays(30, "2030-01-01"),
      });
      await book({ title: "Mit Aufgabe", task: "Heizung warten" });
      await book({ title: "Mit Gerät", asset: "Boiler", date: day(11) });
      await book({ title: "Ohne alles", date: day(12) });
      const titles = async (args: Record<string, unknown>) =>
        (await ok("list_appointments", args)).appointments.map(
          (a: Json) => a.title,
        );
      expect(await titles({ task: "Heizung warten" })).toEqual(["Mit Aufgabe"]);
      expect(await titles({ asset: "boiler" })).toEqual(["Mit Gerät"]);
      expect(await titles({})).toHaveLength(3);
    });

    it("pages through a long list", async () => {
      const { ok, book, day } = await world();
      for (let n = 1; n <= 3; n++) {
        await book({ title: `Termin ${n}`, date: day(n) });
      }
      const first = await ok("list_appointments", { limit: 2 });
      expect(first.appointments).toHaveLength(2);
      expect(first.nextCursor).toEqual(expect.any(String));
      const rest = await ok("list_appointments", {
        limit: 2,
        cursor: first.nextCursor,
      });
      expect(rest.appointments.map((a: Json) => a.title)).toEqual(["Termin 3"]);
      expect(rest.nextCursor).toBeUndefined();
    });
  });

  describe("update_appointment", () => {
    it("changes title, place and notes", async () => {
      const { ok, book, stored } = await world();
      const a = await book({ location: "Keller" });
      const u = await ok("update_appointment", {
        id: a.id,
        title: "Rauchmelder prüfen",
        location: "",
      });
      expect(u).toMatchObject({ title: "Rauchmelder prüfen" });
      expect(u.location).toBeUndefined();
      expect((await stored(a.id)).title).toBe("Rauchmelder prüfen");
    });

    it("moves a timed appointment and keeps its length", async () => {
      const { ok, book, day } = await world();
      const a = await book();
      expect(
        (await ok("update_appointment", { id: a.id, date: day(12) })).when,
      ).toBe(`${day(12)} 09:00-10:30`);
      expect(
        (await ok("update_appointment", { id: a.id, startTime: "14:00" })).when,
      ).toBe(`${day(12)} 14:00-15:30`);
      expect(
        (
          await ok("update_appointment", {
            id: a.id,
            date: day(13),
            startTime: "08:15",
          })
        ).when,
      ).toBe(`${day(13)} 08:15-09:45`);
    });

    it("sets another end when one is given", async () => {
      const { ok, book, day } = await world();
      const a = await book();
      expect(
        (await ok("update_appointment", { id: a.id, endTime: "12:00" })).when,
      ).toBe(`${day(10)} 09:00-12:00`);
      expect(
        (
          await ok("update_appointment", {
            id: a.id,
            date: day(11),
            endTime: "11:00",
          })
        ).when,
      ).toBe(`${day(11)} 09:00-11:00`);
      expect(
        (
          await ok("update_appointment", {
            id: a.id,
            startTime: "23:00",
            endDate: day(12),
            endTime: "01:00",
          })
        ).when,
      ).toBe(`${day(11)} 23:00-${day(12)} 01:00`);
    });

    it("keeps the real length of an appointment moved across the night the clocks change", async () => {
      const { ok } = await world();
      // Europe/Zurich springs forward on Sunday 2030-03-31 at 02:00.
      const a = await ok("create_appointment", {
        title: "Nachtschicht",
        date: "2030-03-30",
        startTime: "01:00",
        endTime: "04:00",
      });
      const moved = await ok("update_appointment", {
        id: a.id,
        date: "2030-03-31",
      });
      expect(moved.when).toBe("2030-03-31 01:00-05:00");
      const after = await ok("update_appointment", {
        id: a.id,
        date: "2030-04-02",
      });
      expect(after.when).toBe("2030-04-02 01:00-04:00");
    });

    it("moves an all-day appointment and keeps its span", async () => {
      const { ok, book, day } = await world();
      const a = await book({
        startTime: undefined,
        endTime: undefined,
        endDate: day(12),
      });
      expect(
        (await ok("update_appointment", { id: a.id, date: day(20) })).when,
      ).toBe(`${day(20)} to ${day(22)}, all day`);
      expect(
        (await ok("update_appointment", { id: a.id, endDate: day(21) })).when,
      ).toBe(`${day(20)} to ${day(21)}, all day`);
    });

    it("turns a timed appointment into an all-day one and back", async () => {
      const { ok, book, day } = await world();
      const a = await book();
      expect(
        (await ok("update_appointment", { id: a.id, allDay: true })).when,
      ).toBe(`${day(10)}, all day`);
      expect(
        (await ok("update_appointment", { id: a.id, startTime: "15:00" })).when,
      ).toBe(`${day(10)} 15:00-16:00`);
      const b = await book({
        title: "Zwei",
        startTime: undefined,
        endTime: undefined,
      });
      expect(
        (
          await ok("update_appointment", {
            id: b.id,
            startTime: "08:00",
            endTime: "09:30",
            date: day(11),
          })
        ).when,
      ).toBe(`${day(11)} 08:00-09:30`);
    });

    it("refuses what does not fit", async () => {
      const { call, book } = await world();
      const timed = await book();
      const allDay = await book({ startTime: undefined, endTime: undefined });
      const times = await call("update_appointment", {
        id: allDay.id,
        allDay: true,
        startTime: "10:00",
      });
      expect(times.isError).toBe(true);
      expect(times.text).toContain("[invalid_request]");
      const noStart = await call("update_appointment", {
        id: allDay.id,
        allDay: false,
      });
      expect(noStart.isError).toBe(true);
      expect(noStart.text).toContain("startTime");
      const backwards = await call("update_appointment", {
        id: timed.id,
        endTime: "08:00",
      });
      expect(backwards.isError).toBe(true);
      const nothing = await call("update_appointment", { id: timed.id });
      expect(nothing.isError).toBe(true);
      expect(nothing.text).toContain("at least one");
      const missing = await call("update_appointment", {
        id: "nope",
        title: "x",
      });
      expect(missing.text).toContain("[not_found]");
    });

    it("cancels, reopens and links or unlinks a task", async () => {
      const { ok, book, stored } = await world();
      await ok("create_task", {
        title: "Heizung warten",
        trigger: everyDays(30, "2030-01-01"),
      });
      const a = await book();
      expect(
        await ok("update_appointment", { id: a.id, task: "Heizung warten" }),
      ).toMatchObject({ task: "Heizung warten" });
      const cancelled = await ok("update_appointment", {
        id: a.id,
        status: "cancelled",
      });
      expect(cancelled.status).toBe("cancelled");
      expect((await stored(a.id)).status).toBe("cancelled");
      const reopened = await ok("update_appointment", {
        id: a.id,
        status: "planned",
        task: null,
      });
      expect(reopened.status).toBeUndefined();
      expect(reopened.task).toBeUndefined();
    });
  });

  describe("complete_appointment", () => {
    it("marks the appointment and its task done, and repeating it changes nothing", async () => {
      const { ok, book, call, day } = await world();
      await ok("create_task", {
        title: "Heizung warten",
        trigger: everyDays(30, "2030-01-01"),
      });
      const a = await book({ task: "Heizung warten", date: day(2) });
      const done = await ok("complete_appointment", {
        id: a.id,
        note: "Alles gut",
      });
      expect(done.appointment).toMatchObject({ id: a.id, status: "done" });
      expect(done.completion).toMatchObject({ kind: "done", source: "mcp" });
      expect(done.task).toMatchObject({ title: "Heizung warten" });
      expect(done.task.appointment).toBeUndefined();
      const again = await call("complete_appointment", { id: a.id });
      expect(again.isError).toBe(false);
      expect(again.summary).toContain("already done");
      expect(again.json.replayed).toBe(true);
      const task = await ok("get_task", { id: done.task.id });
      expect(task.recentCompletions).toHaveLength(1);
      expect(task.recentCompletions[0].note).toBe("Alles gut");
    });

    it("backdates the task's completion", async () => {
      const { ok, book, day } = await world();
      await ok("create_task", {
        title: "Heizung warten",
        trigger: everyDays(30, "2030-01-01"),
      });
      const a = await book({ task: "Heizung warten" });
      const done = await ok("complete_appointment", {
        id: a.id,
        completedDate: day(-2),
      });
      expect(done.completion.date).toBe(day(-2));
    });

    it("refuses a completion dated in the future", async () => {
      const { call, book, day } = await world();
      const a = await book();
      const r = await call("complete_appointment", {
        id: a.id,
        completedDate: day(3),
      });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("future");
    });

    it("marks an appointment without a task done", async () => {
      const { ok, book } = await world();
      const a = await book();
      const done = await ok("complete_appointment", { id: a.id });
      expect(done.appointment.status).toBe("done");
      expect(done.completion).toBeUndefined();
      expect(done.task).toBeUndefined();
    });

    it("reports a cancelled appointment and an unknown one", async () => {
      const { ok, call, book } = await world();
      const a = await book();
      await ok("update_appointment", { id: a.id, status: "cancelled" });
      const cancelled = await call("complete_appointment", { id: a.id });
      expect(cancelled.isError).toBe(true);
      expect(cancelled.text).toContain("[conflict]");
      const missing = await call("complete_appointment", { id: "nope" });
      expect(missing.text).toContain("[not_found]");
    });
  });

  describe("on tasks", () => {
    it("shows the next appointment on the rows of get_task, list_tasks and list_upcoming", async () => {
      const { ok, book, day } = await world();
      const task = await ok("create_task", {
        title: "Heizung warten",
        trigger: everyDays(30, day(6)),
      });
      const a = await book({
        task: "Heizung warten",
        date: day(4),
        startTime: undefined,
        endTime: undefined,
      });
      expect((await ok("get_task", { id: task.id })).appointment).toEqual({
        id: a.id,
        at: day(4),
      });
      expect((await ok("list_tasks")).tasks[0].appointment).toEqual({
        id: a.id,
        at: day(4),
      });
      const upcoming = await ok("list_upcoming", { horizon: "all" });
      const rows = [
        ...upcoming.overdue,
        ...upcoming.today,
        ...upcoming.thisWeek,
        ...upcoming.later,
      ] as Json[];
      expect(rows.find((r) => r.id === task.id)?.appointment).toEqual({
        id: a.id,
        at: day(4),
      });
    });
  });

  describe("scopes", () => {
    it("offers only the listing to a read-only token", async () => {
      const { client } = await mcp.connect({ scopes: ["read"] });
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toContain("list_appointments");
      for (const name of [
        "create_appointment",
        "update_appointment",
        "complete_appointment",
      ]) {
        expect(names).not.toContain(name);
      }
    });
  });
});
