import { describe, expect, it } from "vitest";
import { allDayDto, appointmentDto } from "$lib/testing/appointments";
import { formatWhen } from "./format";
import {
  buildCreateBody,
  buildUpdateBody,
  draftFromAppointment,
  draftWhen,
  fieldsOfWhen,
  mapFieldErrors,
  newDraft,
  type AppointmentDraft,
} from "./form";

const timeZone = "Europe/Zurich";
const today = "2026-10-11";

function draft(over: Partial<AppointmentDraft> = {}): AppointmentDraft {
  return {
    ...newDraft({ today, title: "Heizungsservice" }),
    startDate: "2026-10-14",
    startTime: "09:00",
    ...over,
  };
}

const iso = (value: string) => new Date(value).toISOString();

describe("newDraft", () => {
  it("starts today without a time and takes what it is given", () => {
    expect(newDraft({ today })).toMatchObject({
      title: "",
      allDay: false,
      startDate: today,
      startTime: "",
      endDate: "",
      endTime: "",
      taskId: null,
      assetId: null,
      contactId: null,
      occurrenceKey: null,
    });
    expect(
      newDraft({
        today,
        title: "Kontrolle",
        taskId: "t1",
        assetId: "a1",
        contactId: "c1",
        occurrenceKey: "c:1",
      }),
    ).toMatchObject({
      title: "Kontrolle",
      taskId: "t1",
      assetId: "a1",
      contactId: "c1",
      occurrenceKey: "c:1",
    });
  });

  it("drops an occurrence that has no task", () => {
    expect(newDraft({ today, occurrenceKey: "c:1" }).occurrenceKey).toBeNull();
  });

  it("drops the placeholder of a task that shows no occurrence", () => {
    for (const occurrenceKey of ["none", "s:none"]) {
      expect(newDraft({ today, taskId: "t1", occurrenceKey })).toMatchObject({
        taskId: "t1",
        occurrenceKey: null,
      });
    }
  });
});

describe("draftFromAppointment", () => {
  it("shows the wall-clock times of the household and leaves the end day empty on the same day", () => {
    expect(
      draftFromAppointment(
        appointmentDto({
          title: "Service",
          location: "Keller",
          notes: "Schlüssel beim Nachbarn",
          taskId: "t1",
          assetId: "a1",
          contactId: "c1",
          occurrenceKey: "c:3",
        }),
        timeZone,
      ),
    ).toEqual({
      title: "Service",
      allDay: false,
      startDate: "2026-10-14",
      startTime: "09:00",
      endDate: "",
      endTime: "10:00",
      location: "Keller",
      notes: "Schlüssel beim Nachbarn",
      taskId: "t1",
      assetId: "a1",
      contactId: "c1",
      occurrenceKey: "c:3",
    });
  });

  it("keeps the end day of an appointment across midnight", () => {
    const overnight = appointmentDto({
      startsAt: "2026-10-14T21:00:00.000Z",
      endsAt: "2026-10-14T23:30:00.000Z",
    });
    expect(draftFromAppointment(overnight, timeZone)).toMatchObject({
      startDate: "2026-10-14",
      startTime: "23:00",
      endDate: "2026-10-15",
      endTime: "01:30",
    });
  });

  it("reads an all-day appointment by its dates", () => {
    expect(
      draftFromAppointment(allDayDto("2026-10-14"), timeZone),
    ).toMatchObject({
      allDay: true,
      startDate: "2026-10-14",
      startTime: "",
      endDate: "",
    });
    expect(
      draftFromAppointment(allDayDto("2026-10-14", "2026-10-16"), timeZone),
    ).toMatchObject({ allDay: true, endDate: "2026-10-16" });
  });
});

describe("draftWhen", () => {
  it("defaults the end of a timed appointment to an hour after the start", () => {
    const result = draftWhen(draft(), timeZone);
    expect(result.endIsDefault).toBe(true);
    expect(result.errors).toEqual({});
    expect(result.when).toEqual({
      allDay: false,
      startsAt: Date.parse("2026-10-14T07:00:00.000Z"),
      endsAt: Date.parse("2026-10-14T08:00:00.000Z"),
    });
  });

  it("takes the end time on the day of the start unless it has a day of its own", () => {
    expect(draftWhen(draft({ endTime: "11:30" }), timeZone).when).toMatchObject(
      {
        endsAt: Date.parse("2026-10-14T09:30:00.000Z"),
      },
    );
    expect(
      draftWhen(
        draft({ startTime: "23:00", endDate: "2026-10-15", endTime: "01:00" }),
        timeZone,
      ).when,
    ).toMatchObject({
      startsAt: Date.parse("2026-10-14T21:00:00.000Z"),
      endsAt: Date.parse("2026-10-14T23:00:00.000Z"),
    });
  });

  it("makes an all-day appointment of one day when no end is given", () => {
    const result = draftWhen(draft({ allDay: true }), timeZone);
    expect(result.endIsDefault).toBe(true);
    expect(result.when).toEqual({
      allDay: true,
      startDate: "2026-10-14",
      endDate: "2026-10-14",
    });
  });

  it("measures the default hour in real time across the night the clocks go forward", () => {
    // 01:30 plus one hour is 03:30 on the wall clock: 02:00 to 03:00 does not exist.
    const result = draftWhen(
      draft({ startDate: "2026-03-29", startTime: "01:30" }),
      timeZone,
    );
    expect(result.when).toMatchObject({
      startsAt: Date.parse("2026-03-29T00:30:00.000Z"),
      endsAt: Date.parse("2026-03-29T01:30:00.000Z"),
    });
  });

  it("moves a time that does not exist to the one after the gap", () => {
    const result = draftWhen(
      draft({ startDate: "2026-03-29", startTime: "02:30", endTime: "04:00" }),
      timeZone,
    );
    expect(result.when).toMatchObject({
      startsAt: Date.parse("2026-03-29T01:30:00.000Z"),
    });
  });

  it("asks for the date and the start, and for a valid time", () => {
    expect(
      draftWhen(draft({ startDate: "" }), timeZone).errors.startDate,
    ).toBeTruthy();
    expect(
      draftWhen(draft({ startDate: "14.10.2026" }), timeZone).errors.startDate,
    ).toBeTruthy();
    expect(
      draftWhen(draft({ startTime: "" }), timeZone).errors.startTime,
    ).toBeTruthy();
    expect(
      draftWhen(draft({ startTime: "25:00" }), timeZone).errors.startTime,
    ).toBeTruthy();
    expect(
      draftWhen(draft({ endTime: "9am" }), timeZone).errors.endTime,
    ).toBeTruthy();
    expect(draftWhen(draft({ startTime: "" }), timeZone).when).toBeNull();
  });

  it("asks for the time of the end when its day is given", () => {
    const result = draftWhen(draft({ endDate: "2026-10-15" }), timeZone);
    expect(result.errors.endTime).toBeTruthy();
    expect(result.when).toBeNull();
  });

  it("refuses an end that does not come after the start", () => {
    for (const endTime of ["09:00", "08:00"]) {
      const result = draftWhen(draft({ endTime }), timeZone);
      expect(result.when).toBeNull();
      expect(result.errors.endTime).toBeTruthy();
    }
    const before = draftWhen(
      draft({ allDay: true, endDate: "2026-10-13" }),
      timeZone,
    );
    expect(before.when).toBeNull();
    expect(before.errors.endDate).toBeTruthy();
  });

  it("refuses an appointment longer than 14 days and allows exactly 14", () => {
    expect(
      draftWhen(draft({ allDay: true, endDate: "2026-10-27" }), timeZone).when,
    ).not.toBeNull();
    const tooLong = draftWhen(
      draft({ allDay: true, endDate: "2026-10-28" }),
      timeZone,
    );
    expect(tooLong.when).toBeNull();
    expect(tooLong.errors.endDate).toMatch(/14/);
    expect(
      draftWhen(draft({ endDate: "2026-10-29", endTime: "09:00" }), timeZone)
        .errors.endTime,
    ).toMatch(/14/);
  });
});

describe("fieldsOfWhen", () => {
  it("words a draft the way the list words the appointment it will become", () => {
    const { when } = draftWhen(draft({ endTime: "10:30" }), timeZone);
    expect(when).not.toBeNull();
    expect(
      formatWhen(fieldsOfWhen(when!), { timeZone, today, locale: "en" }),
    ).toMatch(/^Wed,? 14 Oct · 09:00–10:30$/);
    const days = draftWhen(
      draft({ allDay: true, endDate: "2026-10-16" }),
      timeZone,
    ).when;
    expect(
      formatWhen(fieldsOfWhen(days!), { timeZone, today, locale: "de" }),
    ).toMatch(/^Mi\.?,? 14\. Okt\.? – Fr\.?,? 16\. Okt\.? · ganztägig$/);
  });
});

describe("buildCreateBody", () => {
  it("sends the start and leaves the end to the server when it is the default", () => {
    const { body, errors } = buildCreateBody(
      draft({ title: "  Heizungsservice  " }),
      timeZone,
    );
    expect(errors).toEqual({});
    expect(body).toEqual({
      title: "Heizungsservice",
      startsAt: iso("2026-10-14T07:00:00.000Z"),
    });
  });

  it("sends both ends of a timed appointment with an end, and the text fields that are not empty", () => {
    const { body } = buildCreateBody(
      draft({
        endTime: "10:30",
        location: " Keller ",
        notes: "Schlüssel beim Nachbarn",
      }),
      timeZone,
    );
    expect(body).toEqual({
      title: "Heizungsservice",
      startsAt: iso("2026-10-14T07:00:00.000Z"),
      endsAt: iso("2026-10-14T08:30:00.000Z"),
      location: "Keller",
      notes: "Schlüssel beim Nachbarn",
    });
  });

  it("sends the end of an appointment across midnight", () => {
    const { body } = buildCreateBody(
      draft({ startTime: "23:00", endDate: "2026-10-15", endTime: "01:00" }),
      timeZone,
    );
    expect(body).toMatchObject({
      startsAt: iso("2026-10-14T21:00:00.000Z"),
      endsAt: iso("2026-10-14T23:00:00.000Z"),
    });
  });

  it("sends the dates of an all-day appointment and no times", () => {
    expect(
      buildCreateBody(draft({ allDay: true, startTime: "09:00" }), timeZone)
        .body,
    ).toEqual({
      title: "Heizungsservice",
      allDay: true,
      startDate: "2026-10-14",
    });
    expect(
      buildCreateBody(
        draft({ allDay: true, endDate: "2026-10-16", endTime: "11:00" }),
        timeZone,
      ).body,
    ).toEqual({
      title: "Heizungsservice",
      allDay: true,
      startDate: "2026-10-14",
      endDate: "2026-10-16",
    });
  });

  it("sends the task with the occurrence it is for, the device and the contact", () => {
    const { body } = buildCreateBody(
      draft({
        taskId: "t1",
        occurrenceKey: "c:7",
        assetId: "a1",
        contactId: "c1",
      }),
      timeZone,
    );
    expect(body).toMatchObject({
      taskId: "t1",
      occurrenceKey: "c:7",
      assetId: "a1",
      contactId: "c1",
    });
  });

  it("says so when a task's device was cleared, so the server does not put it back", () => {
    expect(
      buildCreateBody(draft({ taskId: "t1", assetId: null }), timeZone).body,
    ).toMatchObject({ taskId: "t1", assetId: null });
    expect(
      buildCreateBody(draft({ assetId: null }), timeZone).body,
    ).not.toHaveProperty("assetId");
  });

  it("does not send an occurrence without a task", () => {
    const { body } = buildCreateBody(draft({ occurrenceKey: "c:7" }), timeZone);
    expect(body).not.toHaveProperty("occurrenceKey");
  });

  it("reports what is wrong by field and sends nothing", () => {
    const empty = buildCreateBody(
      draft({ title: "  ", startTime: "" }),
      timeZone,
    );
    expect(empty.body).toBeUndefined();
    expect(Object.keys(empty.errors).sort()).toEqual(["startTime", "title"]);

    const backwards = buildCreateBody(draft({ endTime: "08:00" }), timeZone);
    expect(backwards.body).toBeUndefined();
    expect(backwards.errors).toHaveProperty("endTime");
  });

  it("refuses text that is too long", () => {
    const { body, errors } = buildCreateBody(
      draft({
        title: "x".repeat(201),
        location: "y".repeat(301),
        notes: "z".repeat(5001),
      }),
      timeZone,
    );
    expect(body).toBeUndefined();
    expect(Object.keys(errors).sort()).toEqual(["location", "notes", "title"]);
  });
});

describe("buildUpdateBody", () => {
  const original = appointmentDto({
    location: "Keller",
    notes: "Notiz",
    taskId: "t1",
    taskTitle: "Heizung warten",
    occurrenceKey: "c:3",
    assetId: "a1",
    contactId: "c1",
  });
  const same = () => draftFromAppointment(original, timeZone);

  it("sends nothing when nothing changed", () => {
    expect(buildUpdateBody(same(), original, timeZone)).toEqual({
      body: {},
      errors: {},
    });
  });

  it("sends only what changed", () => {
    expect(
      buildUpdateBody(
        { ...same(), title: " Kesselservice " },
        original,
        timeZone,
      ).body,
    ).toEqual({ title: "Kesselservice" });
    expect(
      buildUpdateBody({ ...same(), notes: "  " }, original, timeZone).body,
    ).toEqual({ notes: null });
    expect(
      buildUpdateBody({ ...same(), location: "" }, original, timeZone).body,
    ).toEqual({ location: null });
  });

  it("sends both ends when the start moves, so the server never has to guess the end", () => {
    expect(
      buildUpdateBody(
        { ...same(), startTime: "14:00", endTime: "15:00" },
        original,
        timeZone,
      ).body,
    ).toEqual({
      startsAt: iso("2026-10-14T12:00:00.000Z"),
      endsAt: iso("2026-10-14T13:00:00.000Z"),
    });
    expect(
      buildUpdateBody(
        { ...same(), startDate: "2026-10-15", endDate: "" },
        original,
        timeZone,
      ).body,
    ).toEqual({
      startsAt: iso("2026-10-15T07:00:00.000Z"),
      endsAt: iso("2026-10-15T08:00:00.000Z"),
    });
  });

  it("gives an end an hour after the start when the end is cleared", () => {
    expect(
      buildUpdateBody(
        { ...same(), startTime: "10:00", endTime: "" },
        original,
        timeZone,
      ).body,
    ).toEqual({
      startsAt: iso("2026-10-14T08:00:00.000Z"),
      endsAt: iso("2026-10-14T09:00:00.000Z"),
    });
  });

  it("switches the kind with the start of the new one", () => {
    expect(
      buildUpdateBody({ ...same(), allDay: true }, original, timeZone).body,
    ).toEqual({ allDay: true, startDate: "2026-10-14", endDate: "2026-10-14" });
    const days = allDayDto("2026-10-14", "2026-10-15");
    expect(
      buildUpdateBody(
        {
          ...draftFromAppointment(days, timeZone),
          allDay: false,
          startTime: "08:00",
          endTime: "10:00",
        },
        days,
        timeZone,
      ).body,
    ).toEqual({
      allDay: false,
      startsAt: iso("2026-10-14T06:00:00.000Z"),
      endsAt: iso("2026-10-15T08:00:00.000Z"),
    });
  });

  it("sends the dates of an all-day appointment only when they changed", () => {
    const days = allDayDto("2026-10-14", "2026-10-15");
    const base = draftFromAppointment(days, timeZone);
    expect(
      buildUpdateBody({ ...base, title: "Umzug" }, days, timeZone).body,
    ).toEqual({
      title: "Umzug",
    });
    expect(
      buildUpdateBody({ ...base, endDate: "2026-10-17" }, days, timeZone).body,
    ).toEqual({
      startDate: "2026-10-14",
      endDate: "2026-10-17",
    });
  });

  it("links and unlinks, and leaves the occurrence to the server", () => {
    expect(
      buildUpdateBody({ ...same(), taskId: "t2" }, original, timeZone).body,
    ).toEqual({ taskId: "t2" });
    expect(
      buildUpdateBody(
        { ...same(), taskId: null, assetId: null, contactId: null },
        original,
        timeZone,
      ).body,
    ).toEqual({ taskId: null, assetId: null, contactId: null });
  });

  it("does not move an appointment whose end the clock repeats when only the title changes", () => {
    // 25 October 2026: 02:30 happens twice. This one ends at the second 02:30 (UTC+1).
    const fold = appointmentDto({
      startsAt: "2026-10-25T00:00:00.000Z",
      endsAt: "2026-10-25T01:30:00.000Z",
    });
    const base = draftFromAppointment(fold, timeZone);
    expect(base).toMatchObject({ startTime: "02:00", endTime: "02:30" });
    expect(
      buildUpdateBody({ ...base, title: "Umbau" }, fold, timeZone).body,
    ).toEqual({
      title: "Umbau",
    });
  });

  it("reports an end before the start and sends nothing", () => {
    const result = buildUpdateBody(
      { ...same(), startTime: "11:00" },
      original,
      timeZone,
    );
    expect(result.body).toBeUndefined();
    expect(result.errors).toHaveProperty("endTime");
  });

  it("does not hold an unchanged time against the person", () => {
    const stored = appointmentDto({
      startsAt: "2026-10-14T07:00:00.000Z",
      endsAt: "2026-10-14T07:00:00.000Z",
    });
    const result = buildUpdateBody(
      { ...draftFromAppointment(stored, timeZone), title: "Neu" },
      stored,
      timeZone,
    );
    expect(result.body).toEqual({ title: "Neu" });
  });

  it("refuses an empty title", () => {
    const result = buildUpdateBody(
      { ...same(), title: " " },
      original,
      timeZone,
    );
    expect(result.body).toBeUndefined();
    expect(result.errors).toHaveProperty("title");
  });
});

describe("mapFieldErrors", () => {
  it("names the form's fields for the request's", () => {
    expect(
      mapFieldErrors({ startsAt: "a", endsAt: "b", title: "c", endDate: "d" }),
    ).toEqual({ startTime: "a", endTime: "b", title: "c", endDate: "d" });
  });
});
