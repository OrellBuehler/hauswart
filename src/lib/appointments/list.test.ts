import { describe, expect, it } from "vitest";
import { allDayDto, appointmentDto } from "$lib/testing/appointments";
import {
  type AppointmentFilters,
  compareByStart,
  countSections,
  defaultStatuses,
  filterQuery,
  groupByDay,
  isDefaultFilter,
  isOver,
  needsClosing,
  olderRange,
  parseFilters,
  parseStatuses,
  parseView,
  sectionsFor,
  toggleStatus,
  viewRange,
} from "./list";

const timeZone = "Europe/Zurich";
const today = "2026-10-11";

/** A timed appointment on `day` from `from` to `to` (Zurich, UTC+2 in October). */
function at(id: string, day: string, from: string, to: string, over = {}) {
  const utc = (time: string) => {
    const [h, m] = time.split(":").map(Number);
    return `${day}T${String(h! - 2).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;
  };
  return appointmentDto({
    id,
    title: id,
    startsAt: utc(from),
    endsAt: utc(to),
    ...over,
  });
}

describe("filters in the address", () => {
  it("shows planned appointments to come by default and everything in the past view", () => {
    expect(parseFilters(new URLSearchParams(""))).toEqual({
      view: "upcoming",
      statuses: ["planned"],
    });
    expect(parseFilters(new URLSearchParams("view=past"))).toEqual({
      view: "past",
      statuses: ["planned", "done", "cancelled"],
    });
  });

  it("reads the view and the statuses and falls back to the defaults for nonsense", () => {
    expect(parseView("past")).toBe("past");
    expect(parseView("soon")).toBe("upcoming");
    expect(parseView(null)).toBe("upcoming");
    expect(parseStatuses("done,cancelled", "upcoming")).toEqual([
      "done",
      "cancelled",
    ]);
    expect(parseStatuses("cancelled,planned", "upcoming")).toEqual([
      "planned",
      "cancelled",
    ]);
    expect(parseStatuses("bogus", "past")).toEqual(defaultStatuses("past"));
    expect(parseStatuses("", "upcoming")).toEqual(["planned"]);
    expect(parseStatuses(null, "upcoming")).toEqual(["planned"]);
  });

  it("writes only what differs from the defaults", () => {
    expect(filterQuery({ view: "upcoming", statuses: ["planned"] })).toBe("");
    expect(
      filterQuery({ view: "past", statuses: ["planned", "done", "cancelled"] }),
    ).toBe("?view=past");
    expect(filterQuery({ view: "upcoming", statuses: ["done"] })).toBe(
      "?status=done",
    );
    expect(filterQuery({ view: "past", statuses: ["done", "cancelled"] })).toBe(
      "?view=past&status=done%2Ccancelled",
    );
  });

  it("round-trips what it writes", () => {
    const cases: AppointmentFilters[] = [
      { view: "upcoming", statuses: ["planned", "done"] },
      { view: "past", statuses: ["cancelled"] },
      { view: "past", statuses: ["planned", "done", "cancelled"] },
    ];
    for (const filters of cases) {
      const query = filterQuery(filters);
      expect(parseFilters(new URLSearchParams(query))).toEqual(filters);
    }
  });

  it("knows the default of each view", () => {
    expect(isDefaultFilter({ view: "upcoming", statuses: ["planned"] })).toBe(
      true,
    );
    expect(isDefaultFilter({ view: "upcoming", statuses: ["done"] })).toBe(
      false,
    );
    expect(
      isDefaultFilter({
        view: "past",
        statuses: ["cancelled", "done", "planned"],
      }),
    ).toBe(true);
  });
});

describe("toggleStatus", () => {
  it("switches a status on in the order of the statuses and off again", () => {
    expect(toggleStatus(["planned"], "cancelled")).toEqual([
      "planned",
      "cancelled",
    ]);
    expect(toggleStatus(["cancelled"], "planned")).toEqual([
      "planned",
      "cancelled",
    ]);
    expect(toggleStatus(["planned", "done"], "planned")).toEqual(["done"]);
  });

  it("keeps at least one status on", () => {
    expect(toggleStatus(["planned"], "planned")).toEqual(["planned"]);
  });
});

describe("ranges", () => {
  it("looks 30 days back for upcoming appointments that were never closed", () => {
    expect(viewRange("upcoming", today)).toEqual({ from: "2026-09-11" });
  });

  it("covers the year before today for the past view, and asks for the older ones apart", () => {
    expect(viewRange("past", today)).toEqual({
      from: "2025-10-11",
      to: "2026-10-10",
    });
    expect(olderRange(today)).toEqual({ to: "2025-10-10" });
  });
});

describe("isOver", () => {
  it("is over when its last day is before today", () => {
    expect(
      isOver(at("a", "2026-10-10", "09:00", "10:00"), today, timeZone),
    ).toBe(true);
    expect(
      isOver(at("a", "2026-10-11", "09:00", "10:00"), today, timeZone),
    ).toBe(false);
    expect(
      isOver(at("a", "2026-10-12", "09:00", "10:00"), today, timeZone),
    ).toBe(false);
  });

  it("is not over while a longer one still has a day to go", () => {
    expect(isOver(allDayDto("2026-10-09", "2026-10-11"), today, timeZone)).toBe(
      false,
    );
    expect(isOver(allDayDto("2026-10-08", "2026-10-10"), today, timeZone)).toBe(
      true,
    );
  });

  it("is over on the day after an end at midnight, not the day it ends on", () => {
    const toMidnight = appointmentDto({
      startsAt: "2026-10-10T20:00:00.000Z",
      endsAt: "2026-10-10T22:00:00.000Z",
    });
    expect(isOver(toMidnight, "2026-10-11", timeZone)).toBe(true);
    expect(isOver(toMidnight, "2026-10-10", timeZone)).toBe(false);
  });

  it("needs closing only while it is planned", () => {
    const gone = at("a", "2026-10-09", "09:00", "10:00");
    expect(needsClosing(gone, today, timeZone)).toBe(true);
    expect(needsClosing({ ...gone, status: "done" }, today, timeZone)).toBe(
      false,
    );
    expect(
      needsClosing({ ...gone, status: "cancelled" }, today, timeZone),
    ).toBe(false);
    expect(
      needsClosing(at("a", "2026-10-12", "09:00", "10:00"), today, timeZone),
    ).toBe(false);
  });
});

describe("compareByStart", () => {
  it("puts an all-day appointment before the timed ones of its first day, then orders by time", () => {
    const list = [
      at("late", "2026-10-14", "15:00", "16:00"),
      allDayDto("2026-10-14", "2026-10-14", { id: "day", title: "day" }),
      at("early", "2026-10-14", "08:00", "09:00"),
    ];
    expect(
      [...list].sort((a, b) => compareByStart(a, b, timeZone)).map((a) => a.id),
    ).toEqual(["day", "early", "late"]);
  });

  it("puts the longer one first when two start together, then the title", () => {
    const list = [
      at("b-short", "2026-10-14", "09:00", "10:00"),
      at("a-short", "2026-10-14", "09:00", "10:00"),
      at("long", "2026-10-14", "09:00", "12:00"),
    ];
    expect(
      [...list].sort((a, b) => compareByStart(a, b, timeZone)).map((a) => a.id),
    ).toEqual(["long", "a-short", "b-short"]);
  });
});

describe("groupByDay", () => {
  const list = [
    at("c", "2026-10-14", "15:00", "16:00"),
    at("a", "2026-10-12", "09:00", "10:00"),
    at("b", "2026-10-14", "08:00", "09:00"),
  ];

  it("groups by the day the appointment starts, soonest first", () => {
    expect(
      groupByDay(list, { timeZone }).map((g) => [
        g.date,
        g.items.map((a) => a.id),
      ]),
    ).toEqual([
      ["2026-10-12", ["a"]],
      ["2026-10-14", ["b", "c"]],
    ]);
  });

  it("can order the other way round for the past", () => {
    expect(
      groupByDay(list, { timeZone, newestFirst: true }).map((g) => [
        g.date,
        g.items.map((a) => a.id),
      ]),
    ).toEqual([
      ["2026-10-14", ["c", "b"]],
      ["2026-10-12", ["a"]],
    ]);
  });

  it("uses the day on the household's clock, not UTC's", () => {
    const late = appointmentDto({
      id: "late",
      startsAt: "2026-10-14T21:30:00.000Z",
      endsAt: "2026-10-14T22:30:00.000Z",
    });
    expect(groupByDay([late], { timeZone })[0]?.date).toBe("2026-10-14");
    expect(groupByDay([late], { timeZone: "Asia/Tokyo" })[0]?.date).toBe(
      "2026-10-15",
    );
  });

  it("files one that started earlier but still goes on under the clamp day", () => {
    const ongoing = allDayDto("2026-10-09", "2026-10-12", { id: "ongoing" });
    const groups = groupByDay([ongoing, ...list], { timeZone, clampTo: today });
    expect(groups.map((g) => g.date)).toEqual([
      "2026-10-11",
      "2026-10-12",
      "2026-10-14",
    ]);
    expect(groups[0]?.items.map((a) => a.id)).toEqual(["ongoing"]);
  });

  it("is empty for nothing", () => {
    expect(groupByDay([], { timeZone })).toEqual([]);
  });
});

describe("sectionsFor", () => {
  const items = [
    at("gone-planned", "2026-10-05", "09:00", "10:00"),
    at("gone-done", "2026-10-06", "09:00", "10:00", { status: "done" }),
    at("gone-cancelled", "2026-10-07", "09:00", "10:00", {
      status: "cancelled",
    }),
    at("today", "2026-10-11", "09:00", "10:00"),
    at("later", "2026-10-14", "09:00", "10:00"),
    at("later-done", "2026-10-15", "09:00", "10:00", { status: "done" }),
    allDayDto("2026-10-10", "2026-10-12", { id: "running" }),
  ];
  const context = { today, timeZone };
  const ids = (list: { id: string }[]) => list.map((a) => a.id);
  const dayIds = (s: ReturnType<typeof sectionsFor>) =>
    s.days.map((g) => [g.date, ids(g.items)]);

  it("shows what is to come by day and what was never closed apart, for planned ones", () => {
    const sections = sectionsFor(
      items,
      { view: "upcoming", statuses: ["planned"] },
      context,
    );
    expect(ids(sections.open)).toEqual(["gone-planned"]);
    expect(dayIds(sections)).toEqual([
      ["2026-10-11", ["running", "today"]],
      ["2026-10-14", ["later"]],
    ]);
    expect(countSections(sections)).toBe(4);
  });

  it("keeps done and cancelled appointments that are over out of the upcoming view", () => {
    const sections = sectionsFor(
      items,
      { view: "upcoming", statuses: ["planned", "done", "cancelled"] },
      context,
    );
    expect(ids(sections.open)).toEqual(["gone-planned"]);
    expect(sections.days.flatMap((g) => ids(g.items))).toEqual([
      "running",
      "today",
      "later",
      "later-done",
    ]);
  });

  it("lists nothing as open when planned ones are switched off", () => {
    const sections = sectionsFor(
      items,
      { view: "upcoming", statuses: ["done"] },
      context,
    );
    expect(sections.open).toEqual([]);
    expect(dayIds(sections)).toEqual([["2026-10-15", ["later-done"]]]);
  });

  it("shows everything that is over in the past view, newest first, and nothing is open", () => {
    const sections = sectionsFor(
      items,
      { view: "past", statuses: ["planned", "done", "cancelled"] },
      context,
    );
    expect(sections.open).toEqual([]);
    expect(dayIds(sections)).toEqual([
      ["2026-10-07", ["gone-cancelled"]],
      ["2026-10-06", ["gone-done"]],
      ["2026-10-05", ["gone-planned"]],
    ]);
  });

  it("narrows the past view to the statuses switched on", () => {
    const sections = sectionsFor(
      items,
      { view: "past", statuses: ["planned"] },
      context,
    );
    expect(sections.days.flatMap((g) => ids(g.items))).toEqual([
      "gone-planned",
    ]);
  });
});
