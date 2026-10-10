import type { z } from "zod";
import type { OdometerUnit, UserLocale } from "$lib/api/enums";
import type {
  createPreparationRequestSchema,
  createTaskRequestSchema,
} from "$lib/api/schemas/tasks";
import { addYears, daysInMonth, formatDate, parseDate } from "$lib/dates";
import { m } from "$lib/paraglide/messages";
import type { CalendarTrigger } from "$lib/tasks/engine/types";
import { odometerSignalKey } from "./odometer";

/**
 * Tasks a vehicle usually needs, ready to send to `POST /tasks` (and, for the preparations,
 * `POST /tasks/{id}/preparations`). Pure: the date comes in as `today`, the titles are Paraglide
 * messages in the given locale, nothing is read from the clock or the server.
 */

export const VEHICLE_TEMPLATE_IDS = [
  "tires_winter",
  "tires_summer",
  "service",
  "mfk",
  "vignette",
  "vehicle_tax",
  "brake_fluid",
  "ac_service",
] as const;
export type VehicleTemplateId = (typeof VEHICLE_TEMPLATE_IDS)[number];

export type VehicleTaskBody = z.input<typeof createTaskRequestSchema>;
export type VehiclePreparationBody = z.input<
  typeof createPreparationRequestSchema
>;

export interface VehicleTaskTemplate {
  id: VehicleTemplateId;
  /** The body of `POST /tasks`; linked to the vehicle. */
  task: VehicleTaskBody;
  /** Bodies of `POST /tasks/{id}/preparations`, to send once the task exists. */
  preparations: VehiclePreparationBody[];
}

/** What the templates need to know about the vehicle and the moment. */
export interface VehicleTemplateContext {
  assetId: string;
  /** `YYYY-MM-DD`; the inspection date is suggested from it. */
  firstRegistration?: string | null;
  /** `YYYY-MM-DD` in the household time zone. */
  today: string;
  /** Titles are written in this locale; the current one when omitted. */
  locale?: UserLocale;
  /** What the odometer counts in; kilometres when omitted. */
  odometerUnit?: OdometerUnit;
}

/** A date in the year `year`, the day cut back to the end of a short month (31 April becomes 30 April). */
function onDay(year: number, month: number, day: number): string {
  return formatDate(year, month, Math.min(day, daysInMonth(year, month)));
}

/** The next time `month`/`day` comes around, today included. */
export function nextYearly(today: string, month: number, day: number): string {
  const { year } = parseDate(today);
  const thisYear = onDay(year, month, day);
  return thisYear >= today ? thisYear : onDay(year + 1, month, day);
}

const messageOptions = (ctx: VehicleTemplateContext) =>
  ctx.locale ? { locale: ctx.locale } : undefined;

interface YearlyOptions {
  /** Month of the year (1-12). */
  month?: number;
  /** Day of the month; cut back in short months. */
  day?: number;
}

function yearly(
  ctx: VehicleTemplateContext,
  defaults: { month: number; day: number; earlyDays: number },
  options: YearlyOptions,
): CalendarTrigger {
  const month = options.month ?? defaults.month;
  const day = options.day ?? defaults.day;
  return {
    v: 1,
    type: "calendar",
    freq: "yearly",
    interval: 1,
    byMonth: [month],
    byMonthDay: day,
    startDate: nextYearly(ctx.today, month, day),
    earlyDays: defaults.earlyDays,
  };
}

/** Days before the date a garage appointment should be booked. */
const GARAGE_LEAD_DAYS = 28;

function tireChange(
  id: "tires_winter" | "tires_summer",
  ctx: VehicleTemplateContext,
  defaults: { month: number; day: number },
  title: string,
  options: YearlyOptions,
): VehicleTaskTemplate {
  return {
    id,
    task: {
      title,
      category: "maintenance",
      assetId: ctx.assetId,
      trigger: yearly(ctx, { ...defaults, earlyDays: 14 }, options),
    },
    preparations: [
      {
        title: m.vehicle_task_tires_prep_garage({}, messageOptions(ctx)),
        kind: "generic",
        leadDays: GARAGE_LEAD_DAYS,
      },
    ],
  };
}

/** Back to winter tires: every year in October. */
export function tiresWinter(
  ctx: VehicleTemplateContext,
  options: YearlyOptions = {},
): VehicleTaskTemplate {
  return tireChange(
    "tires_winter",
    ctx,
    { month: 10, day: 15 },
    m.vehicle_task_tires_winter_title({}, messageOptions(ctx)),
    options,
  );
}

/** Back to summer tires: every year in April. */
export function tiresSummer(
  ctx: VehicleTemplateContext,
  options: YearlyOptions = {},
): VehicleTaskTemplate {
  return tireChange(
    "tires_summer",
    ctx,
    { month: 4, day: 15 },
    m.vehicle_task_tires_summer_title({}, messageOptions(ctx)),
    options,
  );
}

export const DEFAULT_SERVICE_DISTANCE: Record<OdometerUnit, number> = {
  km: 15_000,
  mi: 10_000,
};
export const DEFAULT_SERVICE_MONTHS = 12;

export interface ServiceOptions {
  /** Distance between two services, in the vehicle's unit. */
  distance?: number;
  /** Months after which the service is due even if the distance was not driven. */
  months?: number;
}

/**
 * The regular service: after a distance on the odometer or after a time, whichever comes first.
 * The odometer is the vehicle's own (`odometer:<asset id>`); readings come from `POST
 * /assets/{id}/odometer`, service log entries and task completions.
 */
export function service(
  ctx: VehicleTemplateContext,
  options: ServiceOptions = {},
): VehicleTaskTemplate {
  const unit = ctx.odometerUnit ?? "km";
  return {
    id: "service",
    task: {
      title: m.vehicle_task_service_title({}, messageOptions(ctx)),
      category: "maintenance",
      assetId: ctx.assetId,
      trigger: {
        v: 1,
        type: "counter_delta",
        entityId: odometerSignalKey(ctx.assetId),
        threshold: options.distance ?? DEFAULT_SERVICE_DISTANCE[unit],
        unit,
        orEvery: {
          every: options.months ?? DEFAULT_SERVICE_MONTHS,
          unit: "month",
        },
      },
    },
    preparations: [],
  };
}

/**
 * When the periodic inspection (MFK) is due by Swiss rules: four years after the first
 * registration, three years after that, then every two years. The first of those dates that is
 * not before `today`; null without a first registration. A suggestion: the vehicle's own
 * inspection date is the one on its registration papers.
 */
export function suggestMfkDate(
  firstRegistration: string | null | undefined,
  today: string,
): string | null {
  if (!firstRegistration) return null;
  let years = 4;
  for (let i = 0; i < 200; i += 1) {
    const date = addYears(firstRegistration, years);
    if (date >= today) return date;
    years += years === 4 ? 3 : 2;
  }
  return null;
}

/**
 * The periodic inspection on a date (once; set the next one when it is done). The date comes from
 * the registration papers; without one it is suggested from the first registration, and a vehicle
 * with neither cannot get this task (`RangeError`).
 */
export function mfk(
  ctx: VehicleTemplateContext,
  options: { date?: string } = {},
): VehicleTaskTemplate {
  const date = options.date ?? suggestMfkDate(ctx.firstRegistration, ctx.today);
  if (!date) {
    throw new RangeError(
      "The inspection needs a date or the vehicle's first registration",
    );
  }
  return {
    id: "mfk",
    task: {
      title: m.vehicle_task_mfk_title({}, messageOptions(ctx)),
      category: "inspection",
      priority: "high",
      assetId: ctx.assetId,
      trigger: { v: 1, type: "one_off", date },
    },
    preparations: [],
  };
}

/** The motorway vignette runs out at the end of January: buy it from mid December on. */
export function vignette(
  ctx: VehicleTemplateContext,
  options: YearlyOptions = {},
): VehicleTaskTemplate {
  return {
    id: "vignette",
    task: {
      title: m.vehicle_task_vignette_title({}, messageOptions(ctx)),
      category: "payment",
      assetId: ctx.assetId,
      trigger: yearly(ctx, { month: 1, day: 31, earlyDays: 45 }, options),
    },
    preparations: [],
  };
}

/** The yearly vehicle tax; the date depends on the canton, so it is meant to be changed. */
export function vehicleTax(
  ctx: VehicleTemplateContext,
  options: YearlyOptions = {},
): VehicleTaskTemplate {
  return {
    id: "vehicle_tax",
    task: {
      title: m.vehicle_task_tax_title({}, messageOptions(ctx)),
      category: "payment",
      assetId: ctx.assetId,
      trigger: yearly(ctx, { month: 3, day: 31, earlyDays: 30 }, options),
    },
    preparations: [],
  };
}

interface EveryTwoYearsOptions {
  /** When it was last done: the next time is two years after. Today when omitted. */
  lastDone?: string;
}

function everyTwoYears(
  id: "brake_fluid" | "ac_service",
  ctx: VehicleTemplateContext,
  title: string,
  options: EveryTwoYearsOptions,
): VehicleTaskTemplate {
  return {
    id,
    task: {
      title,
      category: "maintenance",
      assetId: ctx.assetId,
      trigger: {
        v: 1,
        type: "interval",
        every: 2,
        unit: "year",
        anchor: "completion",
        startDate: addYears(options.lastDone ?? ctx.today, 2),
      },
    },
    preparations: [],
  };
}

/** The brake fluid absorbs water: every two years. */
export function brakeFluid(
  ctx: VehicleTemplateContext,
  options: EveryTwoYearsOptions = {},
): VehicleTaskTemplate {
  return everyTwoYears(
    "brake_fluid",
    ctx,
    m.vehicle_task_brake_fluid_title({}, messageOptions(ctx)),
    options,
  );
}

/** The air-conditioning service: every two years. */
export function acService(
  ctx: VehicleTemplateContext,
  options: EveryTwoYearsOptions = {},
): VehicleTaskTemplate {
  return everyTwoYears(
    "ac_service",
    ctx,
    m.vehicle_task_ac_service_title({}, messageOptions(ctx)),
    options,
  );
}

export interface VehicleTemplateOptions {
  /** Date of the next inspection; the suggestion from the first registration when omitted. */
  mfkDate?: string;
  service?: ServiceOptions;
}

/**
 * Every template for a vehicle, in the order a person would set them up. The inspection is left
 * out when neither its date nor the first registration is known.
 */
export function vehicleTemplates(
  ctx: VehicleTemplateContext,
  options: VehicleTemplateOptions = {},
): VehicleTaskTemplate[] {
  const mfkDate =
    options.mfkDate ?? suggestMfkDate(ctx.firstRegistration, ctx.today);
  return [
    tiresWinter(ctx),
    tiresSummer(ctx),
    service(ctx, options.service),
    ...(mfkDate ? [mfk(ctx, { date: mfkDate })] : []),
    vignette(ctx),
    vehicleTax(ctx),
    brakeFluid(ctx),
    acService(ctx),
  ];
}
