import { describe, expect, it } from "vitest";
import { haCalendarKey } from "./ha-calendar";
import { done, evaluate, skipped, trigger } from "./testing";
import type { Completion } from "./types";

const ha = trigger.haCalendar;
const ENTITY = "calendar.waste";
const events = ["2026-10-07", "2026-10-21", "2026-11-04"];

function run(
  offsetDays: number,
  today: string,
  dates: string[] = events,
  completions: Completion[] = [],
  extra: { summaryMatch?: string; graceDays?: number } = {},
) {
  const t = ha({
    entityId: ENTITY,
    offsetDays,
    ...(extra.summaryMatch ? { summaryMatch: extra.summaryMatch } : {}),
  });
  return evaluate(t, today, {
    completions,
    externalDates: { [haCalendarKey(t)]: dates },
    ...(extra.graceDays !== undefined ? { graceDays: extra.graceDays } : {}),
  });
}

describe("haCalendarKey", () => {
  it("combines entity and filter", () => {
    expect(haCalendarKey({ entityId: ENTITY })).toBe(`${ENTITY}#`);
    expect(haCalendarKey({ entityId: ENTITY, summaryMatch: "Paper" })).toBe(
      `${ENTITY}#Paper`,
    );
  });
});

describe("ha_calendar, offset -1", () => {
  it.each([
    ["well before", "2026-09-20", "2026-10-06", "2026-10-07", "ok"],
    [
      "a week before the offset day",
      "2026-09-29",
      "2026-10-06",
      "2026-10-07",
      "open",
    ],
    [
      "the day before the offset day",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "open",
    ],
    [
      "today is the offset day",
      "2026-10-06",
      "2026-10-06",
      "2026-10-07",
      "due",
    ],
    [
      "event day itself: still surfaced, overdue",
      "2026-10-07",
      "2026-10-06",
      "2026-10-07",
      "overdue",
    ],
    [
      "after the event the next one is shown",
      "2026-10-08",
      "2026-10-20",
      "2026-10-21",
      "ok",
    ],
    [
      "the day before the next offset day",
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "open",
    ],
    ["last event, offset day", "2026-11-03", "2026-11-03", "2026-11-04", "due"],
  ])("%s", (_name, today, dueDate, key, status) => {
    const result = run(-1, today);
    expect(result.dueDate).toBe(dueDate);
    expect(result.occurrenceKey).toBe(key);
    expect(result.status).toBe(status);
    expect(result.dueKind).toBe("exact");
  });

  it("grace days delay overdue on the event day", () => {
    expect(run(-1, "2026-10-07", events, [], { graceDays: 1 }).status).toBe(
      "due",
    );
  });
});

describe("ha_calendar, other offsets", () => {
  it.each([
    [
      "offset 0 on the event day",
      0,
      "2026-10-07",
      "2026-10-07",
      "2026-10-07",
      "due",
    ],
    [
      "offset 0 the day after moves on",
      0,
      "2026-10-08",
      "2026-10-21",
      "2026-10-21",
      "ok",
    ],
    ["offset -2", -2, "2026-10-05", "2026-10-05", "2026-10-07", "due"],
    [
      "offset -7 is already due a week ahead",
      -7,
      "2026-10-04",
      "2026-09-30",
      "2026-10-07",
      "overdue",
    ],
    [
      "offset +1 on the due day",
      1,
      "2026-10-08",
      "2026-10-08",
      "2026-10-07",
      "due",
    ],
    [
      "offset +1 on the event day is not yet due",
      1,
      "2026-10-07",
      "2026-10-08",
      "2026-10-07",
      "open",
    ],
    [
      "offset +1 after the due day moves on",
      1,
      "2026-10-09",
      "2026-10-22",
      "2026-10-21",
      "ok",
    ],
  ])("%s", (_name, offset, today, dueDate, key, status) => {
    const result = run(offset, today);
    expect(result.dueDate).toBe(dueDate);
    expect(result.occurrenceKey).toBe(key);
    expect(result.status).toBe(status);
  });

  it.each([
    ["month boundary", "2026-11-01", -1, "2026-10-31"],
    ["leap day", "2028-03-01", -1, "2028-02-29"],
    ["year boundary", "2027-01-01", -1, "2026-12-31"],
    ["year boundary forward", "2026-12-31", 1, "2027-01-01"],
  ])("date math across a %s", (_name, event, offset, expected) => {
    const today = "2026-10-01";
    const result = run(offset, today, [event]);
    expect(result.dueDate).toBe(expected);
    expect(result.occurrenceKey).toBe(event);
  });
});

describe("ha_calendar, completions", () => {
  it("a completion with the occurrence key moves to the next event", () => {
    const result = run(-1, "2026-10-06", events, [
      done("2026-10-06", { occurrenceKey: "2026-10-07" }),
    ]);
    expect(result.occurrenceKey).toBe("2026-10-21");
    expect(result.dueDate).toBe("2026-10-20");
    expect(result.status).toBe("ok");
  });

  it("a skipped completion also moves on", () => {
    const result = run(-1, "2026-10-06", events, [
      skipped("2026-10-06", { occurrenceKey: "2026-10-07" }),
    ]);
    expect(result.occurrenceKey).toBe("2026-10-21");
  });

  it("completing the surfaced overdue occurrence on the event day", () => {
    const result = run(-1, "2026-10-07", events, [
      done("2026-10-07", { occurrenceKey: "2026-10-07" }),
    ]);
    expect(result.occurrenceKey).toBe("2026-10-21");
  });

  it("a keyless completion on the due day counts for that occurrence", () => {
    const result = run(-1, "2026-10-06", events, [done("2026-10-06")]);
    expect(result.occurrenceKey).toBe("2026-10-21");
  });

  it("a keyless completion a few days early counts", () => {
    const result = run(-1, "2026-10-04", events, [done("2026-10-03")]);
    expect(result.occurrenceKey).toBe("2026-10-21");
  });

  it("a keyless completion long before does not count", () => {
    const result = run(-1, "2026-10-04", events, [done("2026-09-20")]);
    expect(result.occurrenceKey).toBe("2026-10-07");
  });

  it("a completion for an old event does not affect the next", () => {
    const result = run(-1, "2026-10-08", events, [
      done("2026-10-06", { occurrenceKey: "2026-10-07" }),
    ]);
    expect(result.occurrenceKey).toBe("2026-10-21");
    expect(result.status).toBe("ok");
  });

  it("two occurrences done in a row", () => {
    const result = run(-1, "2026-10-06", events, [
      done("2026-10-06", { occurrenceKey: "2026-10-07" }),
      done("2026-10-06", { occurrenceKey: "2026-10-21" }),
    ]);
    expect(result.occurrenceKey).toBe("2026-11-04");
  });

  it("when every known event is done the task is ok without a date", () => {
    const result = run(
      -1,
      "2026-10-06",
      ["2026-10-07"],
      [done("2026-10-06", { occurrenceKey: "2026-10-07" })],
    );
    expect(result.status).toBe("ok");
    expect(result.dueDate).toBeNull();
    expect(result.reasons).toEqual(["completed"]);
  });
});

describe("ha_calendar, event list handling", () => {
  it.each([
    ["no events", []],
    ["only past events", ["2026-09-01", "2026-10-05"]],
  ])("%s is unknown", (_name, dates) => {
    const result = run(-1, "2026-10-06", dates);
    expect(result.status).toBe("unknown");
    expect(result.dueDate).toBeNull();
    expect(result.dueKind).toBe("none");
    expect(result.reasons).toEqual(["no_upcoming_events"]);
    expect(result.occurrenceKey).toBe("none");
  });

  it("is unknown when the key has no entry at all", () => {
    const t = ha({ entityId: ENTITY, offsetDays: -1 });
    const result = evaluate(t, "2026-10-06", {
      externalDates: { other: events },
    });
    expect(result.status).toBe("unknown");
  });

  it("sorts, de-duplicates and drops invalid dates", () => {
    const result = run(-1, "2026-10-01", [
      "2026-10-21",
      "nope",
      "2026-10-07",
      "2026-10-07",
      "2026-02-30",
    ]);
    expect(result.occurrenceKey).toBe("2026-10-07");
  });

  it("the summary filter selects a separate list", () => {
    const t = ha({ entityId: ENTITY, offsetDays: -1, summaryMatch: "Paper" });
    const result = evaluate(t, "2026-10-01", {
      externalDates: {
        [`${ENTITY}#`]: ["2026-10-02"],
        [`${ENTITY}#Paper`]: ["2026-10-14"],
      },
    });
    expect(result.occurrenceKey).toBe("2026-10-14");
    expect(result.dueDate).toBe("2026-10-13");
  });

  it("accepts a reminder time", () => {
    const t = ha({ entityId: ENTITY, offsetDays: -1, time: "18:00" });
    const result = evaluate(t, "2026-10-06", {
      externalDates: { [haCalendarKey(t)]: events },
    });
    expect(result.dueDate).toBe("2026-10-06");
  });
});
