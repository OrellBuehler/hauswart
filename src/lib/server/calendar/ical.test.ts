import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildIcs,
  escapeText,
  etagFor,
  foldLine,
  IcsError,
  type BuildIcsOptions,
  type IcsEvent,
} from "./ical";

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);
const PRODID = "-//hauswart//calendar feed//DE";
const TZ = "Europe/Zurich";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

function build(
  events: IcsEvent[],
  extra: Partial<BuildIcsOptions> = {},
): string {
  return buildIcs({
    calendarName: "Wohnung",
    events,
    prodId: PRODID,
    now: NOW,
    ...extra,
  });
}

function unfold(ics: string): string[] {
  return ics
    .replace(/\r\n[ \t]/g, "")
    .split("\r\n")
    .slice(0, -1);
}

function propertyOf(ics: string, name: string): string[] {
  return unfold(ics).filter(
    (line) => line.startsWith(`${name}:`) || line.startsWith(`${name};`),
  );
}

const basicEvents: IcsEvent[] = [
  {
    uid: "task-1@example.org",
    date: "2026-03-14",
    summary: "Filter reinigen",
    description: "Lüftungsfilter ausbauen und auswaschen.",
    url: "https://hauswart.example.org/tasks/1",
    lastModified: Date.UTC(2026, 1, 20, 8, 30, 15),
    sequence: 2,
    categories: ["Lüftung", "Wartung"],
    alarm: { time: "18:00", tz: TZ, daysBefore: 1 },
  },
  {
    uid: "task-2@example.org",
    date: "2026-03-20",
    summary: "Rauchmelder testen",
    status: "TENTATIVE",
    alarm: { daysBefore: 2 },
  },
  {
    uid: "trip-1@example.org",
    date: { start: "2026-07-18", end: "2026-08-02" },
    summary: "Ferien: Abwesenheit",
    description: "Pflanzen giessen lassen.",
  },
];

const edgeEvents: IcsEvent[] = [
  {
    uid: "edge-1@example.org",
    date: "2026-12-31",
    summary: "Silvester; Feuerwerk, Raketen \\ Böller",
    description:
      "Zeile eins\nZeile zwei; mit Semikolon, Komma und Backslash \\ am Ende\r\nWindows-Zeilenumbruch",
  },
  {
    uid: "edge-2@example.org",
    date: "2026-02-28",
    summary:
      "Ein sehr langer Titel mit Umlauten äöüÄÖÜß und Emoji 🔧🏠🚿 der über mehrere gefaltete Zeilen läuft ohne ein Zeichen zu zerteilen",
    description:
      "Lange Beschreibung: " +
      "Küche, Bad & Keller prüfen 🧹 ".repeat(8) +
      "Ende.",
    categories: ["Küche, Bad", "Übergabe; Abnahme"],
    status: "TENTATIVE",
    sequence: 0,
  },
  {
    uid: "edge-3@example.org",
    date: "2028-02-29",
    summary: "Schalttag",
    alarm: { time: "08:30", tz: TZ },
  },
  {
    uid: "edge-4@example.org",
    date: { start: "2026-03-29", end: "2026-03-30" },
    summary: "Zeitumstellung",
    alarm: { time: "07:00", tz: TZ, daysBefore: 0 },
  },
];

describe("golden files", () => {
  it("matches basic.ics", () => {
    expect(build(basicEvents)).toBe(fixture("basic.ics"));
  });

  it("matches edge-cases.ics", () => {
    expect(
      build(edgeEvents, {
        calendarName: "Küche, Bad; Keller 🏠",
        refreshIntervalHours: 6,
      }),
    ).toBe(fixture("edge-cases.ics"));
  });

  it("matches empty.ics", () => {
    expect(build([])).toBe(fixture("empty.ics"));
  });
});

describe("structure", () => {
  const ics = build(basicEvents);

  it("uses CRLF line endings only and ends with a CRLF", () => {
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("has the calendar header properties", () => {
    const lines = unfold(ics);
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("VERSION:2.0");
    expect(lines).toContain(`PRODID:${PRODID}`);
    expect(lines).toContain("METHOD:PUBLISH");
    expect(lines).toContain("CALSCALE:GREGORIAN");
    expect(lines).toContain("X-WR-CALNAME:Wohnung");
    expect(lines).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT12H");
    expect(lines).toContain("X-PUBLISHED-TTL:PT12H");
    expect(lines.at(-1)).toBe("END:VCALENDAR");
  });

  it("balances BEGIN and END", () => {
    const lines = unfold(ics);
    for (const component of ["VCALENDAR", "VEVENT", "VALARM"]) {
      expect(lines.filter((l) => l === `BEGIN:${component}`).length).toBe(
        lines.filter((l) => l === `END:${component}`).length,
      );
    }
    expect(lines.filter((l) => l === "BEGIN:VEVENT").length).toBe(3);
  });

  it("emits all-day events with VALUE=DATE and an exclusive DTEND", () => {
    expect(propertyOf(ics, "DTSTART")).toEqual([
      "DTSTART;VALUE=DATE:20260314",
      "DTSTART;VALUE=DATE:20260320",
      "DTSTART;VALUE=DATE:20260718",
    ]);
    expect(propertyOf(ics, "DTEND")).toEqual([
      "DTEND;VALUE=DATE:20260315",
      "DTEND;VALUE=DATE:20260321",
      "DTEND;VALUE=DATE:20260802",
    ]);
  });

  it("handles month and year boundaries for DTEND", () => {
    const out = build([
      { uid: "a", date: "2026-12-31", summary: "x" },
      { uid: "b", date: "2026-01-31", summary: "x" },
      { uid: "c", date: "2028-02-29", summary: "x" },
      { uid: "d", date: "2027-02-28", summary: "x" },
    ]);
    expect(propertyOf(out, "DTEND")).toEqual([
      "DTEND;VALUE=DATE:20270101",
      "DTEND;VALUE=DATE:20260201",
      "DTEND;VALUE=DATE:20280301",
      "DTEND;VALUE=DATE:20270301",
    ]);
  });

  it("uses lastModified for DTSTAMP and LAST-MODIFIED, otherwise the supplied now", () => {
    expect(propertyOf(ics, "DTSTAMP")).toEqual([
      "DTSTAMP:20260220T083015Z",
      "DTSTAMP:20260101T120000Z",
      "DTSTAMP:20260101T120000Z",
    ]);
    expect(propertyOf(ics, "LAST-MODIFIED")).toEqual([
      "LAST-MODIFIED:20260220T083015Z",
    ]);
  });

  it("falls back to the current time for DTSTAMP when now is omitted", () => {
    const out = buildIcs({
      calendarName: "x",
      prodId: PRODID,
      events: [{ uid: "a", date: "2026-01-01", summary: "x" }],
    });
    expect(propertyOf(out, "DTSTAMP")[0]).toMatch(/^DTSTAMP:\d{8}T\d{6}Z$/);
  });

  it("defaults status to CONFIRMED and supports TENTATIVE", () => {
    expect(propertyOf(ics, "STATUS")).toEqual([
      "STATUS:CONFIRMED",
      "STATUS:TENTATIVE",
      "STATUS:CONFIRMED",
    ]);
  });

  it("marks events as transparent so they do not block time", () => {
    expect(propertyOf(ics, "TRANSP").length).toBe(3);
  });

  it("emits sequence only when given, including zero", () => {
    expect(propertyOf(ics, "SEQUENCE")).toEqual(["SEQUENCE:2"]);
    expect(
      propertyOf(
        build([{ uid: "a", date: "2026-01-01", summary: "x", sequence: 0 }]),
        "SEQUENCE",
      ),
    ).toEqual(["SEQUENCE:0"]);
  });

  it("emits url, categories and description", () => {
    expect(propertyOf(ics, "URL")).toEqual([
      "URL:https://hauswart.example.org/tasks/1",
    ]);
    expect(propertyOf(ics, "CATEGORIES")).toEqual([
      "CATEGORIES:Lüftung,Wartung",
    ]);
    expect(propertyOf(ics, "DESCRIPTION")).toContain(
      "DESCRIPTION:Pflanzen giessen lassen.",
    );
  });

  it("omits empty description and categories", () => {
    const out = build([
      {
        uid: "a",
        date: "2026-01-01",
        summary: "x",
        description: "",
        categories: [],
      },
    ]);
    expect(out).not.toContain("DESCRIPTION");
    expect(out).not.toContain("CATEGORIES");
  });

  it("produces the same output for the same input (stable etag)", () => {
    expect(build(basicEvents)).toBe(build(basicEvents));
    expect(etagFor(build(basicEvents))).toBe(etagFor(build(basicEvents)));
  });

  it("serializes events in the given order", () => {
    expect(propertyOf(build([...basicEvents].reverse()), "UID")).toEqual([
      "UID:trip-1@example.org",
      "UID:task-2@example.org",
      "UID:task-1@example.org",
    ]);
  });

  it("supports refresh intervals in fractions of hours", () => {
    expect(
      propertyOf(build([], { refreshIntervalHours: 1.5 }), "REFRESH-INTERVAL"),
    ).toEqual(["REFRESH-INTERVAL;VALUE=DURATION:PT1H30M"]);
    expect(
      propertyOf(build([], { refreshIntervalHours: 24 }), "X-PUBLISHED-TTL"),
    ).toEqual(["X-PUBLISHED-TTL:PT24H"]);
  });
});

describe("alarms", () => {
  function trigger(alarm: IcsEvent["alarm"], date = "2026-06-10"): string {
    const out = build([{ uid: "a", date, summary: "Tonne", alarm }]);
    return propertyOf(out, "TRIGGER")[0]!;
  }

  it("emits a complete VALARM", () => {
    const out = unfold(
      build([
        {
          uid: "a",
          date: "2026-06-10",
          summary: "Tonne; raus",
          alarm: { daysBefore: 1 },
        },
      ]),
    );
    const start = out.indexOf("BEGIN:VALARM");
    expect(out.slice(start, start + 5)).toEqual([
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:Tonne\\; raus",
      "TRIGGER:-P1D",
      "END:VALARM",
    ]);
  });

  it("uses a relative trigger for daysBefore", () => {
    expect(trigger({ daysBefore: 1 })).toBe("TRIGGER:-P1D");
    expect(trigger({ daysBefore: 7 })).toBe("TRIGGER:-P7D");
    expect(trigger({ daysBefore: 0 })).toBe("TRIGGER:PT0S");
  });

  it("computes the trigger from midnight for a fixed local time", () => {
    expect(trigger({ time: "18:00", tz: TZ, daysBefore: 1 })).toBe(
      "TRIGGER:-PT6H",
    );
    expect(trigger({ time: "08:00", tz: TZ })).toBe("TRIGGER:PT8H");
    expect(trigger({ time: "08:30", tz: TZ, daysBefore: 1 })).toBe(
      "TRIGGER:-PT15H30M",
    );
    expect(trigger({ time: "00:00", tz: TZ })).toBe("TRIGGER:PT0S");
    expect(trigger({ time: "09:00", tz: TZ, daysBefore: 3 })).toBe(
      "TRIGGER:-PT63H",
    );
    expect(trigger({ time: "23:59", tz: TZ, daysBefore: 1 })).toBe(
      "TRIGGER:-PT1M",
    );
  });

  it("accounts for DST between the alarm and midnight of the event day", () => {
    // Zurich switches to summer time on 2026-03-29 02:00 -> the Saturday 18:00 alarm is 29 real hours
    // before midnight of Monday 2026-03-30 (30 wall-clock hours).
    expect(
      trigger({ time: "18:00", tz: TZ, daysBefore: 2 }, "2026-03-30"),
    ).toBe("TRIGGER:-PT29H");
    // autumn: 2026-10-25 03:00 -> 02:00 adds an hour
    expect(
      trigger({ time: "18:00", tz: TZ, daysBefore: 2 }, "2026-10-26"),
    ).toBe("TRIGGER:-PT31H");
    // no DST change in between
    expect(
      trigger({ time: "18:00", tz: TZ, daysBefore: 1 }, "2026-03-29"),
    ).toBe("TRIGGER:-PT6H");
    expect(
      trigger({ time: "18:00", tz: "UTC", daysBefore: 2 }, "2026-03-30"),
    ).toBe("TRIGGER:-PT30H");
  });

  it("omits the alarm when none is given", () => {
    expect(
      build([{ uid: "a", date: "2026-06-10", summary: "x" }]),
    ).not.toContain("VALARM");
  });

  it("rejects invalid alarms", () => {
    const bad: NonNullable<IcsEvent["alarm"]>[] = [
      { daysBefore: -1 },
      { daysBefore: 1.5 },
      { daysBefore: 366 },
      { daysBefore: Number.NaN },
      { time: "24:00", tz: TZ },
      { time: "8:00", tz: TZ },
      { time: "18:60", tz: TZ },
      { time: "18:00", tz: "Mars/Olympus" },
      { time: "18:00", tz: TZ, daysBefore: -2 },
    ];
    for (const alarm of bad) {
      expect(
        () => build([{ uid: "a", date: "2026-06-10", summary: "x", alarm }]),
        JSON.stringify(alarm),
      ).toThrow(IcsError);
    }
  });
});

describe("text escaping", () => {
  it("escapes backslash, semicolon, comma and newlines", () => {
    expect(escapeText("a\\b;c,d\ne\r\nf\rg")).toBe(
      "a\\\\b\\;c\\,d\\ne\\nf\\ng",
    );
    expect(escapeText("plain äöü 🏠")).toBe("plain äöü 🏠");
  });

  it("escapes backslash before the other characters (no double escaping)", () => {
    expect(escapeText("\\;")).toBe("\\\\\\;");
  });

  it("strips control characters but keeps tabs", () => {
    expect(escapeText("a\u0000b\u0007c\u001bd\te\u007f")).toBe("abcd\te");
  });

  it("escapes summary, description and calendar name in the feed", () => {
    const out = build(
      [
        {
          uid: "a",
          date: "2026-01-01",
          summary: "A;B,C\\D",
          description: "x\ny",
        },
      ],
      { calendarName: "N;M,O" },
    );
    expect(propertyOf(out, "SUMMARY")).toEqual(["SUMMARY:A\\;B\\,C\\\\D"]);
    expect(propertyOf(out, "DESCRIPTION")).toEqual(["DESCRIPTION:x\\ny"]);
    expect(propertyOf(out, "X-WR-CALNAME")).toEqual(["X-WR-CALNAME:N\\;M\\,O"]);
  });

  it("cannot inject properties through newlines", () => {
    const out = build([
      {
        uid: "a",
        date: "2026-01-01",
        summary: "x\r\nBEGIN:VEVENT\r\nUID:evil",
        description: "y\nEND:VCALENDAR\nATTACH:http://evil.example.org",
        categories: ["c\r\nX-EVIL:1"],
      },
    ]);
    const lines = unfold(out);
    expect(lines.filter((l) => l === "BEGIN:VEVENT").length).toBe(1);
    expect(lines.filter((l) => l === "END:VCALENDAR").length).toBe(1);
    expect(
      lines.some(
        (l) =>
          l.startsWith("ATTACH") || l.startsWith("X-EVIL") || l === "UID:evil",
      ),
    ).toBe(false);
  });

  it("does not escape the url value", () => {
    const out = build([
      {
        uid: "a",
        date: "2026-01-01",
        summary: "x",
        url: "https://example.org/a,b;c?x=1&y=2",
      },
    ]);
    expect(propertyOf(out, "URL")).toEqual([
      "URL:https://example.org/a,b;c?x=1&y=2",
    ]);
  });

  it("normalizes non-ascii urls to ascii", () => {
    const out = build([
      {
        uid: "a",
        date: "2026-01-01",
        summary: "x",
        url: "https://example.org/küche",
      },
    ]);
    expect(propertyOf(out, "URL")).toEqual([
      "URL:https://example.org/k%C3%BCche",
    ]);
  });
});

describe("line folding", () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });

  function physicalLines(folded: string): string[] {
    return folded.split("\r\n");
  }

  it("leaves short lines untouched", () => {
    expect(foldLine("SUMMARY:kurz")).toBe("SUMMARY:kurz");
    const exactly75 = "S:" + "a".repeat(73);
    expect(encoder.encode(exactly75).length).toBe(75);
    expect(foldLine(exactly75)).toBe(exactly75);
  });

  it("folds at 75 octets with a leading space on continuation lines", () => {
    const line = "DESCRIPTION:" + "a".repeat(200);
    const lines = physicalLines(foldLine(line));
    expect(encoder.encode(lines[0]!).length).toBe(75);
    for (const next of lines.slice(1)) {
      expect(next.startsWith(" ")).toBe(true);
      expect(encoder.encode(next).length).toBeLessThanOrEqual(75);
    }
    expect(lines.map((l, i) => (i === 0 ? l : l.slice(1))).join("")).toBe(line);
  });

  it("never splits multibyte characters, surrogate pairs or emoji sequences into invalid bytes", () => {
    for (const fill of ["ä", "€", "🔧", "日本語", "a🏠", "é", "👨‍👩‍👧"]) {
      for (let offset = 0; offset < 6; offset++) {
        const line = "SUMMARY:" + "x".repeat(offset) + fill.repeat(80);
        const folded = foldLine(line);
        const lines = physicalLines(folded);
        for (const l of lines) {
          expect(encoder.encode(l).length).toBeLessThanOrEqual(75);
          expect(() => decoder.decode(encoder.encode(l))).not.toThrow();
          expect(l).not.toMatch(/[\ud800-\udbff]$/);
          expect(l).not.toMatch(/^ ?[\udc00-\udfff]/);
        }
        expect(lines.map((l, i) => (i === 0 ? l : l.slice(1))).join("")).toBe(
          line,
        );
      }
    }
  });

  it("folds long lines in a full feed and unfolding restores the content", () => {
    const summary =
      "Überprüfung der Lüftungsanlage 🔧 im Untergeschoss mit Äpfeln, Öl und Weißwein ".repeat(
        4,
      );
    const out = build([{ uid: "a", date: "2026-01-01", summary }]);
    for (const line of out.split("\r\n")) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(out).toContain("\r\n ");
    expect(propertyOf(out, "SUMMARY")).toEqual([
      `SUMMARY:${escapeText(summary)}`,
    ]);
  });

  it("is idempotent in effect: unfolded output equals the unfolded logical lines", () => {
    const out = build(edgeEvents);
    const logical = unfold(out);
    expect(logical.every((l) => !l.startsWith(" "))).toBe(true);
  });
});

describe("validation", () => {
  const ok: IcsEvent = { uid: "a", date: "2026-01-01", summary: "x" };

  it("rejects invalid dates", () => {
    for (const date of [
      "2026-02-30",
      "2026-13-01",
      "2026-1-1",
      "26-01-01",
      "2026/01/01",
      "",
      "2026-01-01T00:00",
      "2027-02-29",
    ]) {
      expect(() => build([{ ...ok, date }]), date).toThrow(IcsError);
    }
  });

  it("rejects spans whose end is not after the start", () => {
    expect(() =>
      build([{ ...ok, date: { start: "2026-01-05", end: "2026-01-05" } }]),
    ).toThrow(IcsError);
    expect(() =>
      build([{ ...ok, date: { start: "2026-01-05", end: "2026-01-04" } }]),
    ).toThrow(IcsError);
    expect(() =>
      build([{ ...ok, date: { start: "2026-01-05", end: "nope" } }]),
    ).toThrow(IcsError);
  });

  it("accepts a one-day span", () => {
    const out = build([
      { ...ok, date: { start: "2026-01-05", end: "2026-01-06" } },
    ]);
    expect(propertyOf(out, "DTEND")).toEqual(["DTEND;VALUE=DATE:20260106"]);
  });

  it("rejects empty or control-character uids and empty summaries", () => {
    expect(() => build([{ ...ok, uid: "" }])).toThrow(IcsError);
    expect(() => build([{ ...ok, uid: "a\r\nb" }])).toThrow(IcsError);
    expect(() => build([{ ...ok, summary: "  " }])).toThrow(IcsError);
  });

  it("rejects duplicate uids", () => {
    expect(() => build([ok, ok])).toThrow(IcsError);
  });

  it("rejects bad urls, sequences and timestamps", () => {
    expect(() => build([{ ...ok, url: "not a url" }])).toThrow(IcsError);
    expect(() => build([{ ...ok, url: "/relative" }])).toThrow(IcsError);
    expect(() => build([{ ...ok, sequence: -1 }])).toThrow(IcsError);
    expect(() => build([{ ...ok, sequence: 1.5 }])).toThrow(IcsError);
    expect(() => build([{ ...ok, lastModified: Number.NaN }])).toThrow(
      IcsError,
    );
    expect(() => build([{ ...ok, lastModified: 8.64e15 + 1 }])).toThrow(
      IcsError,
    );
  });

  it("rejects bad calendar options", () => {
    expect(() => build([], { calendarName: " " })).toThrow(IcsError);
    expect(() => build([], { prodId: "" })).toThrow(IcsError);
    expect(() => build([], { prodId: "a\nb" })).toThrow(IcsError);
    expect(() => build([], { refreshIntervalHours: 0 })).toThrow(IcsError);
    expect(() => build([], { refreshIntervalHours: -1 })).toThrow(IcsError);
    expect(() => build([], { refreshIntervalHours: Number.NaN })).toThrow(
      IcsError,
    );
  });
});

describe("etagFor", () => {
  it("returns a quoted sha256 hex digest", () => {
    expect(etagFor("")).toBe(
      '"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"',
    );
    expect(etagFor("abc")).toMatch(/^"[0-9a-f]{64}"$/);
  });

  it("changes when the content changes", () => {
    expect(etagFor(build(basicEvents))).not.toBe(
      etagFor(build(basicEvents.slice(1))),
    );
    expect(etagFor("a")).not.toBe(etagFor("b"));
  });

  it("hashes the utf-8 bytes", () => {
    expect(etagFor("ä")).toBe(
      '"33e6d73fee82904c8d7afb78de1154d1e8dc2a0edb08120e63df5b9385c2d9cc"',
    );
  });
});
