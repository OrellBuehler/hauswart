import { describe, expect, it } from "vitest";
import {
  HaInputError,
  buildActionableNotification,
  calendarEventsToDates,
  compileSummaryMatcher,
  isUnavailableState,
  notificationActionToken,
  parseNotificationActionToken,
  parseNumericState,
  toSignal,
} from "./helpers";
import type { HaCalendarEvent } from "./schemas";

const allDay = (summary: string, start: string, end?: string) => ({
  summary,
  start: { date: start },
  end: end ? { date: end } : null,
});
const timed = (summary: string, start: string, end?: string) => ({
  summary,
  start: { dateTime: start },
  end: end ? { dateTime: end } : null,
});

describe("parseNumericState", () => {
  it.each([
    ["42", 42],
    ["  3.5 ", 3.5],
    ["-0.25", -0.25],
    ["+7", 7],
    [".5", 0.5],
    ["5.", 5],
    ["1e3", 1000],
    ["0", 0],
  ])("parses %j as %j", (input, expected) => {
    expect(parseNumericState(input)).toBe(expected);
  });

  it.each([
    "unavailable",
    "Unavailable",
    "unknown",
    "none",
    "",
    "   ",
    "on",
    "12abc",
    "1,5",
    "1 000",
    "0x10",
    "Infinity",
    "NaN",
    "--1",
    "1e999",
    "2026-03-01T10:00:00+00:00",
  ])("returns null for %j", (input) => {
    expect(parseNumericState(input)).toBeNull();
  });

  it("accepts finite numbers and rejects null, undefined, NaN", () => {
    expect(parseNumericState(7)).toBe(7);
    expect(parseNumericState(NaN)).toBeNull();
    expect(parseNumericState(Infinity)).toBeNull();
    expect(parseNumericState(null)).toBeNull();
    expect(parseNumericState(undefined)).toBeNull();
  });

  it("knows unavailable states", () => {
    expect(isUnavailableState("unavailable")).toBe(true);
    expect(isUnavailableState(" Unknown ")).toBe(true);
    expect(isUnavailableState("")).toBe(true);
    expect(isUnavailableState("off")).toBe(false);
  });
});

describe("toSignal", () => {
  it("maps a numeric state with its change time", () => {
    expect(
      toSignal({ state: "17", lastChanged: "2026-03-01T10:00:00+00:00" }, 5000),
    ).toEqual({
      numeric: 17,
      text: "17",
      changedAt: Date.parse("2026-03-01T10:00:00Z"),
      seenAt: 5000,
    });
  });

  it("keeps text states and nulls out unavailable ones", () => {
    expect(
      toSignal({ state: "on", lastChanged: "2026-03-01T10:00:00Z" }, 1),
    ).toMatchObject({ numeric: null, text: "on" });
    for (const state of ["unavailable", "unknown", ""]) {
      expect(
        toSignal({ state, lastChanged: "2026-03-01T10:00:00Z" }, 1),
      ).toMatchObject({ numeric: null, text: null });
    }
  });

  it("returns null for an unusable change time", () => {
    expect(
      toSignal({ state: "1", lastChanged: "garbage" }, 9).changedAt,
    ).toBeNull();
  });
});

describe("calendarEventsToDates", () => {
  const TZ = "Europe/Zurich";

  it("returns sorted unique dates for all-day events", () => {
    expect(
      calendarEventsToDates(
        [
          allDay("Paper", "2026-05-20", "2026-05-21"),
          allDay("Bio", "2026-05-06"),
          allDay("Paper again", "2026-05-20", "2026-05-21"),
        ],
        TZ,
      ),
    ).toEqual(["2026-05-06", "2026-05-20"]);
  });

  it("expands multi-day all-day events up to the exclusive end", () => {
    expect(
      calendarEventsToDates([allDay("Away", "2026-02-27", "2026-03-02")], TZ),
    ).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
    expect(
      calendarEventsToDates([allDay("Away", "2026-03-28", "2026-03-31")], TZ),
    ).toEqual(["2026-03-28", "2026-03-29", "2026-03-30"]);
  });

  it("caps runaway all-day ranges and tolerates inverted ones", () => {
    expect(
      calendarEventsToDates(
        [allDay("Forever", "2026-01-01", "2099-01-01")],
        TZ,
      ),
    ).toHaveLength(366);
    expect(
      calendarEventsToDates([allDay("Odd", "2026-05-10", "2026-05-01")], TZ),
    ).toEqual(["2026-05-10"]);
  });

  it("converts timed events to the local date in the time zone", () => {
    expect(
      calendarEventsToDates(
        [
          timed("late", "2026-05-05T22:30:00Z"),
          timed("early", "2026-05-06T00:30:00+02:00"),
        ],
        TZ,
      ),
    ).toEqual(["2026-05-06"]);
    expect(
      calendarEventsToDates(
        [timed("x", "2026-05-06T03:00:00Z")],
        "America/Los_Angeles",
      ),
    ).toEqual(["2026-05-05"]);
  });

  it("treats a datetime without offset as local wall-clock time", () => {
    expect(
      calendarEventsToDates([timed("x", "2026-05-06T23:30:00")], TZ),
    ).toEqual(["2026-05-06"]);
  });

  it("gets spring-forward right (Zurich, 29 March 2026)", () => {
    const at = (utc: string) => calendarEventsToDates([timed("x", utc)], TZ)[0];
    expect(at("2026-03-28T22:59:00Z")).toBe("2026-03-28"); // 23:59 CET
    expect(at("2026-03-28T23:00:00Z")).toBe("2026-03-29"); // 00:00 CET
    expect(at("2026-03-29T01:30:00Z")).toBe("2026-03-29"); // 03:30 CEST
    expect(at("2026-03-29T21:59:00Z")).toBe("2026-03-29"); // 23:59 CEST
    expect(at("2026-03-29T22:00:00Z")).toBe("2026-03-30"); // 00:00 CEST
  });

  it("gets fall-back right (Zurich, 25 October 2026)", () => {
    const at = (utc: string) => calendarEventsToDates([timed("x", utc)], TZ)[0];
    expect(at("2026-10-24T21:59:00Z")).toBe("2026-10-24"); // 23:59 CEST
    expect(at("2026-10-24T22:00:00Z")).toBe("2026-10-25"); // 00:00 CEST
    expect(at("2026-10-25T00:30:00Z")).toBe("2026-10-25"); // 02:30 CEST
    expect(at("2026-10-25T01:30:00Z")).toBe("2026-10-25"); // 02:30 CET (repeated hour)
    expect(at("2026-10-25T22:59:00Z")).toBe("2026-10-25"); // 23:59 CET
    expect(at("2026-10-25T23:00:00Z")).toBe("2026-10-26"); // 00:00 CET
  });

  it("mixes all-day and timed events across a DST change", () => {
    expect(
      calendarEventsToDates(
        [
          allDay("Bio", "2026-03-29"),
          timed("Paper", "2026-03-29T22:30:00Z"),
          timed("Metal", "2026-03-28T23:30:00Z"),
        ],
        TZ,
      ),
    ).toEqual(["2026-03-29", "2026-03-30"]);
  });

  it("filters by case-insensitive substring", () => {
    const events = [
      allDay("Papiersammlung", "2026-05-20"),
      allDay("Bio-Abfall", "2026-05-06"),
      allDay("Sperrgut", "2026-05-13"),
    ];
    expect(calendarEventsToDates(events, TZ, "PAPIER")).toEqual(["2026-05-20"]);
    expect(calendarEventsToDates(events, TZ, "")).toHaveLength(3);
    expect(calendarEventsToDates(events, TZ, null)).toHaveLength(3);
    expect(calendarEventsToDates(events, TZ, "nothing")).toEqual([]);
  });

  it("filters by /regex/ and treats events without a summary as empty text", () => {
    const events: Array<Pick<HaCalendarEvent, "summary" | "start" | "end">> = [
      allDay("Papiersammlung", "2026-05-20"),
      allDay("Bio-Abfall", "2026-05-06"),
      allDay("", "2026-05-13"),
    ];
    expect(calendarEventsToDates(events, TZ, "/^(papier|bio)/")).toEqual([
      "2026-05-06",
      "2026-05-20",
    ]);
    expect(calendarEventsToDates(events, TZ, "/^$/")).toEqual(["2026-05-13"]);
  });

  it("rejects an unsafe pattern instead of running it", () => {
    expect(() =>
      calendarEventsToDates([allDay("a", "2026-05-20")], TZ, "/(a+)+$/"),
    ).toThrow(HaInputError);
  });

  it("returns an empty list for no events", () => {
    expect(calendarEventsToDates([], TZ)).toEqual([]);
  });
});

describe("compileSummaryMatcher", () => {
  it("matches substrings literally, including regex characters", () => {
    const m = compileSummaryMatcher("Müll (Bio)");
    expect(m("Heute: müll (bio) abholung")).toBe(true);
    expect(m("Müll Bio")).toBe(false);
    expect(compileSummaryMatcher("a.c")("abc")).toBe(false);
  });

  it.each([
    "/müll|abfall/",
    "/^(papier|karton)\\b/i",
    "/\\bbio\\b/",
    "/papier.*karton/",
    "/[a-z0-9]+-sammlung/",
    "/[^x]y/",
    "/\\d/",
    "/colou?r/",
    "/(?:a|b)c/",
    "/a\\.b/",
    "/(a(b(c)))/",
  ])("accepts %s", (pattern) => {
    expect(() => compileSummaryMatcher(pattern)).not.toThrow();
  });

  it.each([
    "/(a+)+$/",
    "/(a*)*/",
    "/(a|aa)+/",
    "/(.*)*b/",
    "/(a+)?/",
    "/a{1,5}/",
    "/a{2}/",
    "/(?=x)y/",
    "/(?!x)y/",
    "/(?<name>x)/",
    "/(a)\\1/",
    "/a+?/",
    "/a**/",
    "/a*a*a*a*/",
    "/.*.*.*.*x/",
    "/^*/",
    "/\\b+/",
    "/[/",
    "/[]/",
    "/(/",
    "/)/",
    "/a)/",
    "/(((((a)))))/",
    "/\\u0041/",
    "/\\p{L}/",
    "/\\x41/",
    "/\\k<a>/",
    "/[a-z[b]]/",
    "/a]/",
    "/{/",
    `/${"a".repeat(101)}/`,
  ])("rejects %s", (pattern) => {
    expect(() => compileSummaryMatcher(pattern)).toThrow(HaInputError);
  });

  it("treats other flags as part of a plain substring", () => {
    expect(compileSummaryMatcher("/x/g")("see /x/g here")).toBe(true);
    expect(compileSummaryMatcher("/x/g")("x")).toBe(false);
  });

  it("is fast on adversarial text with the allowed repetitions", () => {
    const m = compileSummaryMatcher("/a*a*a*b/");
    const started = performance.now();
    expect(m("a".repeat(100_000))).toBe(false);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("examines only the beginning of long summaries", () => {
    const m = compileSummaryMatcher("/needle/");
    expect(m(`${"x".repeat(300)}needle`)).toBe(false);
    expect(m(`needle${"x".repeat(300)}`)).toBe(true);
  });

  it("rejects absurdly long input without compiling it", () => {
    expect(() => compileSummaryMatcher("/" + "a".repeat(5000) + "/")).toThrow(
      HaInputError,
    );
  });
});

describe("buildActionableNotification", () => {
  const base = {
    title: "Filter due",
    message: "Replace the washer filter",
    url: "https://hauswart.example.org/tasks/42",
    tag: "task-42",
  };

  it("builds the companion app payload", () => {
    expect(
      buildActionableNotification({
        ...base,
        actions: [
          { action: "HW_DONE_abc123", title: "Done" },
          { action: "HW_SNOOZE_abc123", title: "Tomorrow" },
        ],
        interruptionLevel: "time-sensitive",
      }),
    ).toEqual({
      title: "Filter due",
      message: "Replace the washer filter",
      data: {
        url: "https://hauswart.example.org/tasks/42",
        clickAction: "https://hauswart.example.org/tasks/42",
        tag: "task-42",
        actions: [
          { action: "HW_DONE_abc123", title: "Done" },
          { action: "HW_SNOOZE_abc123", title: "Tomorrow" },
        ],
        push: { "interruption-level": "time-sensitive" },
      },
    });
  });

  it("omits actions and push when not asked for, and accepts a path as url", () => {
    const payload = buildActionableNotification({ ...base, url: "/tasks/42" });
    expect(payload.data).toEqual({
      url: "/tasks/42",
      clickAction: "/tasks/42",
      tag: "task-42",
    });
    expect(Object.keys(payload.data)).not.toContain("actions");
    expect(Object.keys(payload.data)).not.toContain("push");
  });

  it("shortens long text and trims", () => {
    const payload = buildActionableNotification({
      ...base,
      title: ` ${"t".repeat(300)} `,
      message: "m".repeat(2000),
      actions: [{ action: "A", title: "x".repeat(100) }],
    });
    expect(payload.title).toHaveLength(100);
    expect(payload.message).toHaveLength(600);
    expect(payload.data.actions![0]!.title).toHaveLength(40);
    expect(payload.title.endsWith("…")).toBe(true);
  });

  it("rejects unusable input", () => {
    const bad = (
      over: Partial<Parameters<typeof buildActionableNotification>[0]>,
    ) =>
      expect(() => buildActionableNotification({ ...base, ...over })).toThrow(
        HaInputError,
      );
    bad({ message: "  " });
    bad({ url: "" });
    bad({ url: "javascript:alert(1)" });
    bad({ url: "//evil.example.org/x" });
    bad({ url: "https://a.example.org/x y" });
    bad({ url: "ftp://a.example.org/" });
    bad({ url: "not a url" });
    bad({ tag: "" });
    bad({ tag: "has space" });
    bad({ tag: "x".repeat(65) });
    bad({ actions: [{ action: "bad action", title: "x" }] });
    bad({ actions: [{ action: "A", title: " " }] });
    bad({
      actions: [
        { action: "A", title: "1" },
        { action: "A", title: "2" },
      ],
    });
    bad({
      actions: [1, 2, 3, 4].map((n) => ({ action: `A${n}`, title: "x" })),
    });
    bad({ interruptionLevel: "loud" as never });
  });
});

describe("notification action tokens", () => {
  it("round-trips a token through the action id", () => {
    const action = notificationActionToken("HW_DONE_", "t0k-en_9");
    expect(action).toBe("HW_DONE_t0k-en_9");
    expect(parseNotificationActionToken("HW_DONE_", action)).toBe("t0k-en_9");
  });

  it("returns null for foreign prefixes, empty and malformed tokens, non-strings", () => {
    expect(
      parseNotificationActionToken("HW_DONE_", "HW_SNOOZE_abc"),
    ).toBeNull();
    expect(parseNotificationActionToken("HW_DONE_", "HW_DONE_")).toBeNull();
    expect(parseNotificationActionToken("HW_DONE_", "HW_DONE_a b")).toBeNull();
    expect(
      parseNotificationActionToken("HW_DONE_", `HW_DONE_${"a".repeat(65)}`),
    ).toBeNull();
    expect(parseNotificationActionToken("HW_DONE_", "HW_DONE_a\n")).toBeNull();
    expect(parseNotificationActionToken("HW_DONE_", undefined)).toBeNull();
    expect(parseNotificationActionToken("HW_DONE_", 42)).toBeNull();
    expect(
      parseNotificationActionToken("bad prefix", "bad prefixabc"),
    ).toBeNull();
  });

  it("refuses to build ids from bad parts", () => {
    expect(() => notificationActionToken("HW DONE", "x")).toThrow(HaInputError);
    expect(() => notificationActionToken("HW_DONE_", "")).toThrow(HaInputError);
    expect(() => notificationActionToken("HW_DONE_", "a/b")).toThrow(
      HaInputError,
    );
  });
});
