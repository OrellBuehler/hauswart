import { describe, expect, it } from "vitest";
import {
  completeAppointmentRequestSchema,
  createAppointmentRequestSchema,
  listAppointmentsQuerySchema,
  updateAppointmentRequestSchema,
} from "./appointments";

const START = "2030-03-12T08:00:00.000Z";
const END = "2030-03-12T09:30:00.000Z";

/** The fields a request is refused on, [] when it is accepted. */
function fieldsRefused(
  schema: {
    safeParse(v: unknown): {
      success: boolean;
      error?: { issues: { path: PropertyKey[] }[] };
    };
  },
  body: unknown,
): string[] {
  const result = schema.safeParse(body);
  if (result.success) return [];
  return [
    ...new Set(result.error!.issues.map((i) => String(i.path[0] ?? "(body)"))),
  ];
}

describe("createAppointmentRequestSchema", () => {
  const refused = (body: unknown) =>
    fieldsRefused(createAppointmentRequestSchema, body);

  it("accepts a timed appointment with and without an end", () => {
    expect(refused({ title: "Service", startsAt: START, endsAt: END })).toEqual(
      [],
    );
    expect(refused({ title: "Service", startsAt: START })).toEqual([]);
    expect(
      createAppointmentRequestSchema.parse({ title: "x", startsAt: START }),
    ).toMatchObject({ allDay: false });
  });

  it("accepts an all-day appointment of one or several days", () => {
    expect(
      refused({ title: "x", allDay: true, startDate: "2030-03-12" }),
    ).toEqual([]);
    expect(
      refused({
        title: "x",
        allDay: true,
        startDate: "2030-03-12",
        endDate: "2030-03-25",
      }),
    ).toEqual([]);
  });

  it("trims and bounds the texts and turns an empty text into null", () => {
    const parsed = createAppointmentRequestSchema.parse({
      title: "  Kaminfeger ",
      startsAt: START,
      location: "",
      notes: "  Leiter  ",
    });
    expect(parsed).toMatchObject({
      title: "Kaminfeger",
      location: null,
      notes: "Leiter",
    });
    expect(refused({ title: " ", startsAt: START })).toEqual(["title"]);
    expect(refused({ title: "x".repeat(201), startsAt: START })).toEqual([
      "title",
    ]);
    expect(
      refused({ title: "x", startsAt: START, location: "x".repeat(301) }),
    ).toEqual(["location"]);
    expect(
      refused({ title: "x", startsAt: START, notes: "x".repeat(5001) }),
    ).toEqual(["notes"]);
  });

  it.each<[string, Record<string, unknown>, string[]]>([
    ["no time at all", { title: "x" }, ["startsAt"]],
    [
      "an all-day appointment without a day",
      { title: "x", allDay: true },
      ["startDate"],
    ],
    [
      "dates on a timed appointment",
      { title: "x", startsAt: START, startDate: "2030-03-12" },
      ["startDate"],
    ],
    [
      "an end date on a timed appointment",
      { title: "x", startsAt: START, endDate: "2030-03-12" },
      ["endDate"],
    ],
    [
      "instants on an all-day appointment",
      { title: "x", allDay: true, startDate: "2030-03-12", startsAt: START },
      ["startsAt"],
    ],
    [
      "an end that is not after the start",
      { title: "x", startsAt: START, endsAt: START },
      ["endsAt"],
    ],
    [
      "an end before the start",
      { title: "x", startsAt: END, endsAt: START },
      ["endsAt"],
    ],
    [
      "a span of 14 days and a second",
      { title: "x", startsAt: START, endsAt: "2030-03-26T08:00:01.000Z" },
      ["endsAt"],
    ],
    [
      "an end date before the start date",
      {
        title: "x",
        allDay: true,
        startDate: "2030-03-12",
        endDate: "2030-03-11",
      },
      ["endDate"],
    ],
    [
      "15 days",
      {
        title: "x",
        allDay: true,
        startDate: "2030-03-12",
        endDate: "2030-03-26",
      },
      ["endDate"],
    ],
    [
      "an instant that is not UTC",
      { title: "x", startsAt: "2030-03-12T09:00:00+01:00" },
      ["startsAt"],
    ],
    [
      "a date that does not exist",
      { title: "x", allDay: true, startDate: "2030-02-30" },
      ["startDate"],
    ],
    [
      "an occurrence without a task",
      { title: "x", startsAt: START, occurrenceKey: "k" },
      ["occurrenceKey"],
    ],
    [
      "an occurrence with a task that is null",
      { title: "x", startsAt: START, taskId: null, occurrenceKey: "k" },
      ["occurrenceKey"],
    ],
    ["a status", { title: "x", startsAt: START, status: "done" }, ["(body)"]],
    [
      "unknown fields",
      { title: "x", startsAt: START, color: "red" },
      ["(body)"],
    ],
  ])("refuses %s", (_name, body, fields) => {
    expect(refused(body)).toEqual(fields);
  });

  it("accepts the span of exactly 14 days in both kinds", () => {
    expect(
      refused({
        title: "x",
        startsAt: START,
        endsAt: "2030-03-26T08:00:00.000Z",
      }),
    ).toEqual([]);
    expect(
      refused({
        title: "x",
        allDay: true,
        startDate: "2030-03-12",
        endDate: "2030-03-25",
      }),
    ).toEqual([]);
  });

  it("accepts a task with its occurrence and null links", () => {
    expect(
      refused({
        title: "x",
        startsAt: START,
        taskId: "t1",
        occurrenceKey: "2030-03-12",
        assetId: null,
        contactId: null,
      }),
    ).toEqual([]);
  });
});

describe("updateAppointmentRequestSchema", () => {
  const refused = (body: unknown) =>
    fieldsRefused(updateAppointmentRequestSchema, body);

  it("accepts any single field", () => {
    for (const body of [
      { title: "Neu" },
      { notes: null },
      { location: "" },
      { startsAt: START },
      { endsAt: END },
      { startDate: "2030-03-12" },
      { allDay: true },
      { allDay: false },
      { taskId: null },
      { assetId: "a1" },
      { contactId: null },
      { occurrenceKey: null },
      { status: "cancelled" },
    ]) {
      expect(refused(body), JSON.stringify(body)).toEqual([]);
    }
  });

  it.each<[string, Record<string, unknown>, string[]]>([
    ["an empty body", {}, ["(body)"]],
    [
      "a start and a date",
      { startsAt: START, startDate: "2030-03-12" },
      ["startDate"],
    ],
    [
      "instants on allDay true",
      { allDay: true, startsAt: START },
      ["startsAt"],
    ],
    [
      "dates on allDay false",
      { allDay: false, startDate: "2030-03-12" },
      ["startDate"],
    ],
    ["an end before the start", { startsAt: END, endsAt: START }, ["endsAt"]],
    [
      "more than 14 days",
      { startDate: "2030-03-12", endDate: "2030-04-12" },
      ["endDate"],
    ],
    [
      "an occurrence with the task removed",
      { taskId: null, occurrenceKey: "k" },
      ["occurrenceKey"],
    ],
    ["an unknown status", { status: "open" }, ["status"]],
    ["unknown fields", { color: "red" }, ["(body)"]],
    ["an empty title", { title: "" }, ["title"]],
  ])("refuses %s", (_name, body, fields) => {
    expect(refused(body)).toEqual(fields);
  });

  it("leaves the checks that need the stored appointment to the service", () => {
    expect(refused({ startsAt: START })).toEqual([]);
    expect(refused({ endDate: "2030-03-12" })).toEqual([]);
    expect(refused({ occurrenceKey: "k" })).toEqual([]);
    expect(refused({ allDay: true, startDate: "2030-03-12" })).toEqual([]);
  });
});

describe("listAppointmentsQuerySchema", () => {
  it("coerces the paging and keeps the filters", () => {
    expect(
      listAppointmentsQuerySchema.parse({
        limit: "10",
        from: "2030-03-01",
        to: "2030-03-31",
        status: "planned",
        taskId: "t1",
      }),
    ).toEqual({
      limit: 10,
      from: "2030-03-01",
      to: "2030-03-31",
      status: "planned",
      taskId: "t1",
    });
    expect(listAppointmentsQuerySchema.parse({})).toEqual({ limit: 50 });
  });

  it("accepts a one-day range and refuses an upside-down one", () => {
    const refused = (q: unknown) =>
      fieldsRefused(listAppointmentsQuerySchema, q);
    expect(refused({ from: "2030-03-01", to: "2030-03-01" })).toEqual([]);
    expect(refused({ from: "2030-03-02", to: "2030-03-01" })).toEqual(["to"]);
    expect(refused({ from: "01.03.2030" })).toEqual(["from"]);
    expect(refused({ status: "all" })).toEqual(["status"]);
  });
});

describe("completeAppointmentRequestSchema", () => {
  it("takes an optional note and instant", () => {
    expect(completeAppointmentRequestSchema.parse({})).toEqual({});
    expect(
      completeAppointmentRequestSchema.parse({
        note: " ok ",
        completedAt: START,
      }),
    ).toEqual({ note: "ok", completedAt: START });
    expect(
      completeAppointmentRequestSchema.safeParse({ note: "x".repeat(2001) })
        .success,
    ).toBe(false);
    expect(
      completeAppointmentRequestSchema.safeParse({ source: "qr" }).success,
    ).toBe(false);
  });
});
