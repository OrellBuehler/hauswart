import { describe, expect, it } from "vitest";
import { zonedTimeToInstant } from "$lib/dates";
import {
  createPreparationRequestSchema,
  createTaskRequestSchema,
} from "$lib/api/schemas/tasks";
import { evaluateTask } from "$lib/tasks/engine";
import {
  VEHICLE_TEMPLATE_IDS,
  acService,
  brakeFluid,
  mfk,
  nextYearly,
  service,
  suggestMfkDate,
  tiresSummer,
  tiresWinter,
  vehicleTax,
  vehicleTemplates,
  vignette,
  type VehicleTemplateContext,
} from "./templates";

const TZ = "Europe/Zurich";
const ASSET = "6f1c2d3e-0000-4000-8000-000000000001";
const ctxOn = (
  today: string,
  over: Partial<VehicleTemplateContext> = {},
): VehicleTemplateContext => ({
  assetId: ASSET,
  firstRegistration: "2022-03-10",
  today,
  locale: "de",
  ...over,
});

/** What the engine says about a freshly created task, as of `today`. */
function evaluateNew(
  template: { task: { trigger: unknown } },
  today: string,
  startedOn = today,
) {
  const task = createTaskRequestSchema.parse({
    title: "x",
    ...template.task,
  });
  return evaluateTask({
    trigger: task.trigger,
    completions: [],
    today,
    now: zonedTimeToInstant(today, "12:00", TZ),
    tz: TZ,
    startedOn,
  });
}

describe("every template", () => {
  const templates = vehicleTemplates(ctxOn("2026-10-10"));

  it("covers each template once, in a stable order", () => {
    expect(templates.map((t) => t.id)).toEqual([
      "tires_winter",
      "tires_summer",
      "service",
      "mfk",
      "vignette",
      "vehicle_tax",
      "brake_fluid",
      "ac_service",
    ]);
    expect([...templates.map((t) => t.id)].sort()).toEqual(
      [...VEHICLE_TEMPLATE_IDS].sort(),
    );
  });

  it.each(VEHICLE_TEMPLATE_IDS)(
    "%s is a valid task and valid preparations, linked to the vehicle",
    (id) => {
      const template = templates.find((t) => t.id === id)!;
      const task = createTaskRequestSchema.safeParse(template.task);
      expect(task.error?.issues).toBeUndefined();
      expect(task.data?.assetId).toBe(ASSET);
      expect(task.data?.title.trim()).not.toBe("");
      expect(task.data?.roomId).toBeUndefined();
      for (const prep of template.preparations) {
        const parsed = createPreparationRequestSchema.safeParse(prep);
        expect(parsed.error?.issues).toBeUndefined();
      }
    },
  );

  it.each(VEHICLE_TEMPLATE_IDS)(
    "%s is understood by the engine and never unknown",
    (id) => {
      const template = templates.find((t) => t.id === id)!;
      const result = evaluateNew(template, "2026-10-10");
      expect(result.status).not.toBe("unknown");
      expect(result.dueDate ?? result.estimate?.date).not.toBeNull();
    },
  );

  it.each(VEHICLE_TEMPLATE_IDS)(
    "%s is titled in the locale asked for",
    (id) => {
      const german = vehicleTemplates(
        ctxOn("2026-10-10", { locale: "de" }),
      ).find((t) => t.id === id)!;
      const english = vehicleTemplates(
        ctxOn("2026-10-10", { locale: "en" }),
      ).find((t) => t.id === id)!;
      expect(german.task.title).not.toBe("");
      expect(english.task.title).not.toBe("");
      // Service is "Service" in both languages.
      if (id !== "service")
        expect(german.task.title).not.toBe(english.task.title);
    },
  );

  it("does not share objects between calls", () => {
    const a = vehicleTemplates(ctxOn("2026-10-10"));
    const b = vehicleTemplates(ctxOn("2026-10-10"));
    expect(a).toEqual(b);
    expect(a[0].task.trigger).not.toBe(b[0].task.trigger);
  });
});

describe("nextYearly", () => {
  it.each([
    ["before the day", "2026-10-10", 10, 15, "2026-10-15"],
    ["on the day", "2026-10-15", 10, 15, "2026-10-15"],
    ["the day after", "2026-10-16", 10, 15, "2027-10-15"],
    ["start of the year", "2026-01-01", 10, 15, "2026-10-15"],
    ["end of the year", "2026-12-31", 1, 31, "2027-01-31"],
    ["short month", "2026-04-01", 4, 31, "2026-04-30"],
    ["a leap day in a common year", "2027-01-01", 2, 29, "2027-02-28"],
    ["a leap day in a leap year", "2027-03-01", 2, 29, "2028-02-29"],
  ])("%s", (_name, today, month, day, expected) => {
    expect(nextYearly(today, month, day)).toBe(expected);
  });
});

describe("tire changes", () => {
  it.each([
    ["winter", tiresWinter, 10],
    ["summer", tiresSummer, 4],
  ] as const)(
    "%s: yearly in its month, 14 days early, with a garage appointment",
    (_name, make, month) => {
      const template = make(ctxOn("2026-01-01"));
      expect(template.task).toMatchObject({
        category: "maintenance",
        assetId: ASSET,
        trigger: {
          v: 1,
          type: "calendar",
          freq: "yearly",
          interval: 1,
          byMonth: [month],
          earlyDays: 14,
        },
      });
      expect(template.preparations).toEqual([
        { title: "Garagentermin buchen", kind: "generic", leadDays: 28 },
      ]);
    },
  );

  it("speaks English when asked to", () => {
    const template = tiresWinter(ctxOn("2026-01-01", { locale: "en" }));
    expect(template.task.title).toBe("Switch to winter tires");
    expect(template.preparations[0].title).toBe("Book a garage appointment");
  });

  it.each([
    ["2026-01-01", "2026-10-15"],
    ["2026-10-10", "2026-10-15"],
    ["2026-10-15", "2026-10-15"],
    ["2026-10-16", "2027-10-15"],
  ])("winter tires, today %s: first on %s", (today, start) => {
    const trigger = tiresWinter(ctxOn(today)).task.trigger;
    expect(trigger).toMatchObject({ startDate: start });
  });

  it("is due in a few days, and open for the preparation, when October is near", () => {
    const result = evaluateNew(tiresWinter(ctxOn("2026-10-10")), "2026-10-10");
    expect(result).toMatchObject({
      status: "open",
      dueDate: "2026-10-15",
      dueKind: "exact",
    });
  });

  it("summer tires wait for April", () => {
    const result = evaluateNew(tiresSummer(ctxOn("2026-10-10")), "2026-10-10");
    expect(result).toMatchObject({ status: "ok", dueDate: "2027-04-15" });
  });

  it("the day can be moved", () => {
    const template = tiresWinter(ctxOn("2026-01-01"), { day: 3 });
    expect(template.task.trigger).toMatchObject({
      byMonthDay: 3,
      startDate: "2026-10-03",
    });
  });
});

describe("service", () => {
  it("counts the vehicle's own odometer and falls due by time as well", () => {
    const template = service(ctxOn("2026-10-10"));
    expect(template.task).toMatchObject({
      category: "maintenance",
      assetId: ASSET,
      trigger: {
        v: 1,
        type: "counter_delta",
        entityId: `odometer:${ASSET}`,
        threshold: 15_000,
        unit: "km",
        orEvery: { every: 12, unit: "month" },
      },
    });
    expect(template.preparations).toEqual([]);
  });

  it("takes miles, another distance and another time", () => {
    expect(
      service(ctxOn("2026-10-10", { odometerUnit: "mi" })).task.trigger,
    ).toMatchObject({ threshold: 10_000, unit: "mi" });
    expect(
      service(ctxOn("2026-10-10"), { distance: 20_000, months: 24 }).task
        .trigger,
    ).toMatchObject({
      threshold: 20_000,
      orEvery: { every: 24, unit: "month" },
    });
  });

  it("shows the time limit before any odometer reading exists", () => {
    const result = evaluateNew(service(ctxOn("2026-10-10")), "2026-10-10");
    expect(result).toMatchObject({
      status: "ok",
      dueDate: "2027-10-10",
      dueKind: "exact",
      reasons: ["signal_missing"],
    });
  });
});

describe("MFK", () => {
  it.each([
    ["not yet 4 years", "2022-03-10", "2026-01-01", "2026-03-10"],
    ["exactly on the 4th year", "2022-03-10", "2026-03-10", "2026-03-10"],
    ["a day after the 4th year", "2022-03-10", "2026-03-11", "2029-03-10"],
    ["between the 7th and 9th year", "2022-03-10", "2029-03-11", "2031-03-10"],
    ["every two years after that", "2022-03-10", "2033-06-01", "2035-03-10"],
    ["a leap day", "2020-02-29", "2024-03-01", "2027-02-28"],
    ["a new vehicle", "2026-09-01", "2026-10-10", "2030-09-01"],
    ["no first registration", null, "2026-10-10", null],
    ["not given", undefined, "2026-10-10", null],
  ])("suggests a date: %s", (_name, registered, today, expected) => {
    expect(suggestMfkDate(registered, today)).toBe(expected);
  });

  it("is a one-off task on the given date", () => {
    const template = mfk(ctxOn("2026-10-10"), { date: "2027-02-15" });
    expect(template.task).toMatchObject({
      category: "inspection",
      priority: "high",
      assetId: ASSET,
      trigger: { v: 1, type: "one_off", date: "2027-02-15" },
    });
    expect(evaluateNew(template, "2026-10-10")).toMatchObject({
      status: "ok",
      dueDate: "2027-02-15",
    });
  });

  it("takes the suggestion from the first registration when no date is given", () => {
    const template = mfk(
      ctxOn("2026-10-10", { firstRegistration: "2022-03-10" }),
    );
    expect(template.task.trigger).toMatchObject({ date: "2029-03-10" });
  });

  it("cannot guess without a date or a first registration", () => {
    expect(() => mfk(ctxOn("2026-10-10", { firstRegistration: null }))).toThrow(
      RangeError,
    );
  });

  it("is left out of the full set when nothing is known, and added with a date", () => {
    const ids = (templates: { id: string }[]) => templates.map((t) => t.id);
    const bare = ctxOn("2026-10-10", { firstRegistration: null });
    expect(ids(vehicleTemplates(bare))).not.toContain("mfk");
    expect(ids(vehicleTemplates(bare, { mfkDate: "2027-05-01" }))).toContain(
      "mfk",
    );
  });
});

describe("yearly payments", () => {
  it("the vignette is due at the end of January and can be bought from mid December", () => {
    const template = vignette(ctxOn("2026-10-10"));
    expect(template.task).toMatchObject({
      category: "payment",
      assetId: ASSET,
      trigger: {
        type: "calendar",
        freq: "yearly",
        byMonth: [1],
        byMonthDay: 31,
        startDate: "2027-01-31",
        earlyDays: 45,
      },
    });
    expect(evaluateNew(template, "2027-01-25")).toMatchObject({
      status: "open",
      dueDate: "2027-01-31",
    });
    expect(evaluateNew(template, "2027-02-01")).toMatchObject({
      status: "overdue",
    });
  });

  it("the vehicle tax is a yearly payment on a date that can be moved", () => {
    expect(vehicleTax(ctxOn("2026-10-10")).task).toMatchObject({
      category: "payment",
      trigger: {
        type: "calendar",
        freq: "yearly",
        byMonth: [3],
        byMonthDay: 31,
      },
    });
    expect(
      vehicleTax(ctxOn("2026-10-10"), { month: 11, day: 30 }).task.trigger,
    ).toMatchObject({
      byMonth: [11],
      byMonthDay: 30,
      startDate: "2026-11-30",
    });
  });
});

describe("every two years", () => {
  it.each([
    ["brake fluid", brakeFluid],
    ["air-conditioning service", acService],
  ] as const)(
    "%s: from the last completion, the first time two years from now",
    (_name, make) => {
      const template = make(ctxOn("2026-10-10"));
      expect(template.task).toMatchObject({
        category: "maintenance",
        assetId: ASSET,
        trigger: {
          v: 1,
          type: "interval",
          every: 2,
          unit: "year",
          anchor: "completion",
          startDate: "2028-10-10",
        },
      });
      expect(template.preparations).toEqual([]);
    },
  );

  it("counts from the day it was last done when known", () => {
    expect(
      brakeFluid(ctxOn("2026-10-10"), { lastDone: "2025-02-28" }).task.trigger,
    ).toMatchObject({ startDate: "2027-02-28" });
    expect(
      acService(ctxOn("2026-10-10"), { lastDone: "2024-02-29" }).task.trigger,
    ).toMatchObject({ startDate: "2026-02-28" });
  });

  it("is overdue when it was last done more than two years ago", () => {
    const template = brakeFluid(ctxOn("2026-10-10"), {
      lastDone: "2024-01-15",
    });
    expect(evaluateNew(template, "2026-10-10")).toMatchObject({
      status: "overdue",
      dueDate: "2026-01-15",
    });
  });
});
