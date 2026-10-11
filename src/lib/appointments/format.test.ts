import { describe, expect, it } from "vitest";
import { allDayDto, appointmentDto } from "$lib/testing/appointments";
import {
  formatDayHeading,
  formatDayLabel,
  formatStart,
  formatWhen,
  spanOf,
  startDayOf,
  timeColumn,
  whenOf,
} from "./format";

const timeZone = "Europe/Zurich";
const today = "2026-10-11";
const de = { timeZone, today, locale: "de" } as const;
const en = { timeZone, today, locale: "en" } as const;

/** 14 October 2026, 09:00 to 10:30 in Zurich (UTC+2). */
const morning = appointmentDto({ endsAt: "2026-10-14T08:30:00.000Z" });
/** 14 October 23:00 to 15 October 01:30 in Zurich. */
const overnight = appointmentDto({
  startsAt: "2026-10-14T21:00:00.000Z",
  endsAt: "2026-10-14T23:30:00.000Z",
});

describe("whenOf", () => {
  it("takes instants of a timed appointment and dates of an all-day one", () => {
    expect(whenOf(morning)).toEqual({
      allDay: false,
      startsAt: Date.parse("2026-10-14T07:00:00.000Z"),
      endsAt: Date.parse("2026-10-14T08:30:00.000Z"),
    });
    expect(whenOf(allDayDto("2026-10-14", "2026-10-16"))).toEqual({
      allDay: true,
      startDate: "2026-10-14",
      endDate: "2026-10-16",
    });
  });

  it("refuses an appointment that lacks what its kind needs", () => {
    expect(() => whenOf(appointmentDto({ endsAt: null }))).toThrow();
    expect(() =>
      whenOf(allDayDto("2026-10-14", "2026-10-14", { endDate: null })),
    ).toThrow();
  });
});

describe("spanOf", () => {
  it("gives the days and the wall-clock times in the household zone", () => {
    expect(spanOf(morning, timeZone)).toEqual({
      first: "2026-10-14",
      last: "2026-10-14",
      startTime: "09:00",
      endTime: "10:30",
    });
  });

  it("puts the day on the household's calendar, not on UTC's", () => {
    const late = appointmentDto({
      startsAt: "2026-10-14T21:30:00.000Z",
      endsAt: "2026-10-14T22:30:00.000Z",
    });
    expect(spanOf(late, timeZone)).toMatchObject({
      first: "2026-10-14",
      last: "2026-10-15",
      startTime: "23:30",
      endTime: "00:30",
    });
    expect(spanOf(late, "UTC")).toMatchObject({
      first: "2026-10-14",
      last: "2026-10-14",
    });
  });

  it("does not count the next day for an end at midnight", () => {
    const toMidnight = appointmentDto({
      startsAt: "2026-10-14T20:00:00.000Z",
      endsAt: "2026-10-14T22:00:00.000Z",
    });
    expect(spanOf(toMidnight, timeZone)).toMatchObject({
      first: "2026-10-14",
      last: "2026-10-14",
      endTime: "00:00",
    });
  });

  it("keeps the dates of an all-day appointment, whatever the zone", () => {
    const days = allDayDto("2026-10-14", "2026-10-16");
    for (const zone of ["Europe/Zurich", "Pacific/Auckland", "UTC"]) {
      expect(spanOf(days, zone)).toEqual({
        first: "2026-10-14",
        last: "2026-10-16",
        startTime: null,
        endTime: null,
      });
    }
  });

  it("reads the wall clock across the night the clocks go forward", () => {
    // 28 March 23:00 (UTC+1) to 29 March 07:00 (UTC+2): the night lasts seven hours.
    const night = appointmentDto({
      startsAt: "2026-03-28T22:00:00.000Z",
      endsAt: "2026-03-29T05:00:00.000Z",
    });
    expect(spanOf(night, timeZone)).toEqual({
      first: "2026-03-28",
      last: "2026-03-29",
      startTime: "23:00",
      endTime: "07:00",
    });
  });

  it("shows the hour that does not exist on the day the clocks go forward as the one after it", () => {
    // 01:30 to 03:30 on the wall clock is one real hour: 02:00 to 03:00 does not exist.
    const gap = appointmentDto({
      startsAt: "2026-03-29T00:30:00.000Z",
      endsAt: "2026-03-29T01:30:00.000Z",
    });
    expect(spanOf(gap, timeZone)).toMatchObject({
      startTime: "01:30",
      endTime: "03:30",
    });
  });
});

describe("startDayOf", () => {
  it("is the first day of either kind, as the household lives it", () => {
    expect(startDayOf(morning, timeZone)).toBe("2026-10-14");
    expect(
      startDayOf(
        { allDay: true, startsAt: null, startDate: "2026-10-20" },
        timeZone,
      ),
    ).toBe("2026-10-20");
    expect(
      startDayOf(
        {
          allDay: false,
          startsAt: "2026-10-14T22:30:00.000Z",
          startDate: null,
        },
        timeZone,
      ),
    ).toBe("2026-10-15");
  });
});

describe("formatWhen", () => {
  it("words a timed appointment of one day with its times", () => {
    expect(formatWhen(morning, de)).toMatch(
      /^Mi\.?,? 14\. Okt\.? · 09:00–10:30$/,
    );
    expect(formatWhen(morning, en)).toMatch(/^Wed,? 14 Oct · 09:00–10:30$/);
  });

  it("names both days when the appointment goes across midnight", () => {
    expect(formatWhen(overnight, de)).toMatch(
      /^Mi\.?,? 14\. Okt\.?, 23:00 – Do\.?,? 15\. Okt\.?, 01:30$/,
    );
    expect(formatWhen(overnight, en)).toMatch(
      /^Wed,? 14 Oct, 23:00 – Thu,? 15 Oct, 01:30$/,
    );
  });

  it("words the days of an all-day appointment and says so", () => {
    expect(formatWhen(allDayDto("2026-10-14"), de)).toMatch(
      /^Mi\.?,? 14\. Okt\.? · ganztägig$/,
    );
    expect(formatWhen(allDayDto("2026-10-14", "2026-10-16"), de)).toMatch(
      /^Mi\.?,? 14\. Okt\.? – Fr\.?,? 16\. Okt\.? · ganztägig$/,
    );
    expect(formatWhen(allDayDto("2026-10-14", "2026-10-16"), en)).toMatch(
      /^Wed,? 14 Oct – Fri,? 16 Oct · all day$/,
    );
  });

  it("adds the year when it is not the current one", () => {
    expect(formatWhen(allDayDto("2027-01-14"), de)).toContain("2027");
    expect(formatWhen(allDayDto("2026-10-14"), de)).not.toContain("2026");
  });

  it("shows an hour across the spring change as it reads on the clock face", () => {
    const gap = appointmentDto({
      startsAt: "2026-03-29T00:30:00.000Z",
      endsAt: "2026-03-29T01:30:00.000Z",
    });
    expect(formatWhen(gap, { ...de, today: "2026-03-20" })).toMatch(
      /^So\.?,? 29\. März · 01:30–03:30$/,
    );
  });
});

describe("timeColumn", () => {
  it("stacks the start over the end", () => {
    expect(timeColumn(morning, de)).toEqual({
      primary: "09:00",
      secondary: "–10:30",
    });
  });

  it("says when an appointment across midnight ends, on its first day", () => {
    const column = timeColumn(overnight, de);
    expect(column.primary).toBe("23:00");
    expect(column.secondary).toMatch(/^bis 15\. Okt\.?$/);
  });

  it("says an appointment is going on under a later day, and until when", () => {
    expect(timeColumn(overnight, { ...de, day: "2026-10-15" })).toEqual({
      primary: "Läuft",
      secondary: "bis 01:30",
    });
    const longer = appointmentDto({
      startsAt: "2026-10-12T07:00:00.000Z",
      endsAt: "2026-10-16T15:00:00.000Z",
    });
    const column = timeColumn(longer, { ...de, day: "2026-10-14" });
    expect(column.primary).toBe("Läuft");
    expect(column.secondary).toMatch(/^bis 16\. Okt\.?$/);
  });

  it("calls an all-day appointment all day, and says how long a longer one goes", () => {
    expect(timeColumn(allDayDto("2026-10-14"), de)).toEqual({
      primary: "ganztägig",
      secondary: null,
    });
    const column = timeColumn(allDayDto("2026-10-14", "2026-10-16"), en);
    expect(column.primary).toBe("all day");
    expect(column.secondary).toBe("until 16 Oct");
  });
});

describe("day labels", () => {
  it("names the days around today in words, the rest by date", () => {
    expect(formatDayLabel("2026-10-11", de)).toBe("Heute");
    expect(formatDayLabel("2026-10-12", de)).toBe("Morgen");
    expect(formatDayLabel("2026-10-10", de)).toBe("Gestern");
    expect(formatDayLabel("2026-10-11", en)).toBe("Today");
    expect(formatDayLabel("2026-10-20", de)).toMatch(/^Di\.?,? 20\. Okt\.?$/);
  });

  it("puts the date next to the word in a heading", () => {
    expect(formatDayHeading("2026-10-11", de)).toMatch(
      /^Heute · So\.?,? 11\. Okt\.?$/,
    );
    expect(formatDayHeading("2026-10-20", de)).toMatch(/^Di\.?,? 20\. Okt\.?$/);
  });
});

describe("formatStart", () => {
  it("is short: the day by word or date, and the time of a timed appointment", () => {
    const todayMorning = appointmentDto({
      startsAt: "2026-10-11T07:00:00.000Z",
      endsAt: "2026-10-11T08:00:00.000Z",
    });
    expect(formatStart(todayMorning, de)).toBe("Heute, 09:00");
    expect(formatStart(morning, de)).toMatch(/^Mi\.?,? 14\. Okt\.?, 09:00$/);
    expect(formatStart(allDayDto("2026-10-12"), de)).toBe("Morgen");
    expect(formatStart(allDayDto("2026-10-12"), en)).toBe("Tomorrow");
  });

  it("reads the next appointment of a task the same way", () => {
    expect(
      formatStart(
        {
          allDay: false,
          startsAt: "2026-10-12T05:30:00.000Z",
          startDate: null,
        },
        de,
      ),
    ).toBe("Morgen, 07:30");
  });
});
