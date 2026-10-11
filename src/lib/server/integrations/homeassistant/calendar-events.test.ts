import { describe, expect, it } from "vitest";
import { zonedTimeToInstant } from "$lib/dates";
import type { CalendarItem } from "$lib/server/calendar-sync/provider";
import {
  capabilitiesOf,
  eventDescription,
  featuresOf,
  localDateTime,
  toHaEvent,
  toRemoteEvent,
} from "./calendar-events";

const ZURICH = "Europe/Zurich";
const NEW_YORK = "America/New_York";
const at = (date: string, time: string, zone = ZURICH) =>
  zonedTimeToInstant(date, time, zone);

function item(over: Partial<CalendarItem> = {}): CalendarItem {
  return {
    ref: "task-example-1",
    summary: "Filter wechseln",
    description: "Gerät: Dampfabzug",
    location: null,
    when: { allDay: true, startDate: "2026-06-20", endDate: "2026-06-21" },
    path: "/tasks/example-1",
    alarmMinutes: null,
    ...over,
  };
}

describe("localDateTime", () => {
  it("is the wall-clock time in the zone, without an offset", () => {
    expect(localDateTime(ZURICH, at("2026-06-20", "09:30"))).toBe(
      "2026-06-20T09:30:00",
    );
    expect(localDateTime(NEW_YORK, at("2026-06-20", "09:30"))).toBe(
      "2026-06-20T03:30:00",
    );
    expect(localDateTime("UTC", Date.UTC(2026, 0, 5, 23, 59, 7))).toBe(
      "2026-01-05T23:59:07",
    );
  });

  it("moves to the other date when the zones are on different sides of midnight", () => {
    expect(localDateTime("Pacific/Auckland", at("2026-06-20", "22:00"))).toBe(
      "2026-06-21T08:00:00",
    );
    expect(localDateTime(NEW_YORK, at("2026-06-20", "01:00"))).toBe(
      "2026-06-19T19:00:00",
    );
  });

  it("follows the clocks of the zone", () => {
    // Zurich goes forward on 2026-03-29 02:00 -> 03:00.
    expect(localDateTime(ZURICH, Date.UTC(2026, 2, 29, 0, 59))).toBe(
      "2026-03-29T01:59:00",
    );
    expect(localDateTime(ZURICH, Date.UTC(2026, 2, 29, 1, 0))).toBe(
      "2026-03-29T03:00:00",
    );
  });
});

describe("eventDescription", () => {
  it("ends with the marker line, after the text and the link", () => {
    expect(eventDescription(item(), "https://hauswart.example.org")).toBe(
      "Gerät: Dampfabzug\nhttps://hauswart.example.org/tasks/example-1\n\nhw-ref: task-example-1@sync.hauswart",
    );
  });

  it("is only the marker for an item without text, and has no link without an address", () => {
    expect(eventDescription(item({ description: "" }), null)).toBe(
      "hw-ref: task-example-1@sync.hauswart",
    );
    expect(eventDescription(item(), null)).toBe(
      "Gerät: Dampfabzug\n\nhw-ref: task-example-1@sync.hauswart",
    );
  });
});

describe("toHaEvent", () => {
  it("keeps the dates of an all-day item, the end being the first day after it", () => {
    expect(toHaEvent(item(), NEW_YORK, null)).toEqual({
      summary: "Filter wechseln",
      description: "Gerät: Dampfabzug\n\nhw-ref: task-example-1@sync.hauswart",
      location: null,
      start: { date: "2026-06-20" },
      end: { date: "2026-06-21" },
    });
    const span = toHaEvent(
      item({
        when: { allDay: true, startDate: "2026-06-22", endDate: "2026-06-25" },
      }),
      ZURICH,
      null,
    );
    expect([span.start, span.end]).toEqual([
      { date: "2026-06-22" },
      { date: "2026-06-25" },
    ]);
  });

  it("writes a timed item as wall-clock time in the zone of the calendar system", () => {
    const when = {
      allDay: false as const,
      startsAt: at("2026-06-20", "09:00"),
      endsAt: at("2026-06-20", "10:30"),
    };
    const zurich = toHaEvent(item({ when, location: "Keller" }), ZURICH, null);
    expect([zurich.start, zurich.end, zurich.location]).toEqual([
      { dateTime: "2026-06-20T09:00:00" },
      { dateTime: "2026-06-20T10:30:00" },
      "Keller",
    ]);
    const newYork = toHaEvent(item({ when }), NEW_YORK, null);
    expect([newYork.start, newYork.end]).toEqual([
      { dateTime: "2026-06-20T03:00:00" },
      { dateTime: "2026-06-20T04:30:00" },
    ]);
  });

  it("writes both ends without an offset even across the night the clocks change", () => {
    const event = toHaEvent(
      item({
        when: {
          allDay: false,
          startsAt: at("2026-03-28", "23:00"),
          endsAt: at("2026-03-29", "08:00"),
        },
      }),
      ZURICH,
      null,
    );
    expect([event.start, event.end]).toEqual([
      { dateTime: "2026-03-28T23:00:00" },
      { dateTime: "2026-03-29T08:00:00" },
    ]);
  });

  it("never writes an event shorter than a second, which Home Assistant refuses", () => {
    const startsAt = at("2026-06-20", "09:00");
    const event = toHaEvent(
      item({ when: { allDay: false, startsAt, endsAt: startsAt + 400 } }),
      ZURICH,
      null,
    );
    expect(event.start).toEqual({ dateTime: "2026-06-20T09:00:00" });
    expect(event.end).toEqual({ dateTime: "2026-06-20T09:00:01" });
  });

  it("puts nothing but the item's own text into the description", () => {
    const event = toHaEvent(item(), ZURICH, "https://hauswart.example.org");
    expect(event.description).toBe(
      "Gerät: Dampfabzug\nhttps://hauswart.example.org/tasks/example-1\n\nhw-ref: task-example-1@sync.hauswart",
    );
  });
});

describe("toRemoteEvent", () => {
  const base = {
    summary: "x",
    start: { date: "2026-06-20" },
    end: { date: "2026-06-21" },
    location: null,
    uid: "abc",
  };
  it("reads our marker and the id", () => {
    expect(
      toRemoteEvent({
        ...base,
        description: "Text\n\nhw-ref: task-example-1@sync.hauswart",
      }),
    ).toEqual({ uid: "abc", ref: "task-example-1" });
  });

  it("gives foreign events no ref, and no id when there is none", () => {
    expect(
      toRemoteEvent({ ...base, description: "hw-ref: nope", uid: null }),
    ).toEqual({ uid: null, ref: null });
    expect(toRemoteEvent({ ...base, description: null, uid: "" })).toEqual({
      uid: null,
      ref: null,
    });
    // Text that merely mentions the marker is no marker.
    expect(
      toRemoteEvent({
        ...base,
        description: "see hw-ref: task-x@sync.hauswart for details",
      }).ref,
    ).toBeNull();
  });
});

describe("capabilities", () => {
  it.each([
    [0, { create: false, update: false, delete: false }],
    [1, { create: true, update: false, delete: false }],
    [3, { create: true, update: false, delete: true }],
    [7, { create: true, update: true, delete: true }],
    [4, { create: false, update: true, delete: false }],
    // other bits (a future feature) do not matter
    [9, { create: true, update: false, delete: false }],
  ])("features %i mean %j, and never reminders", (features, expected) => {
    expect(capabilitiesOf(features)).toEqual({ ...expected, alarms: false });
  });

  it("reads a whole number from the attributes and treats anything else as no features", () => {
    expect(featuresOf({ supported_features: 7 })).toBe(7);
    for (const value of [undefined, null, "7", 1.5, -1, NaN, {}]) {
      expect(featuresOf({ supported_features: value })).toBe(0);
    }
    expect(featuresOf({})).toBe(0);
  });
});
