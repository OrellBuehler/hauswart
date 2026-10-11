import type { TireSeason } from "$lib/api/enums";
import {
  MAX_TREAD_MM,
  createTireSetRequestSchema,
  measureTreadRequestSchema,
  mountTireSetRequestSchema,
  updateTireSetRequestSchema,
  type CreateTireSetRequest,
  type MeasureTreadRequest,
  type MountTireSetRequest,
  type TireSet,
  type UpdateTireSetRequest,
} from "$lib/api/schemas/tire-sets";
import { MAX_ODOMETER_VALUE } from "$lib/api/schemas/vehicles";
import { isValidDate } from "$lib/dates";
import { m } from "$lib/paraglide/messages";
import { issuesToErrors } from "$lib/tasks/field-errors";
import { parseDecimalInput } from "./format";
import { readingToSend } from "./odometer-input";
import { isValidDot } from "./tires";

export type TireSetDraft = {
  season: TireSeason;
  brand: string;
  model: string;
  size: string;
  dot: string;
  treadDepth: string;
  treadMeasuredOn: string;
  storageLocation: string;
  storageContactId: string | null;
  purchasedOn: string;
  notes: string;
};

export type Built<T> = {
  body: T | undefined;
  errors: Record<string, string>;
};

export function newTireSetDraft(options: {
  season: TireSeason;
  today: string;
  size?: string | null | undefined;
}): TireSetDraft {
  return {
    season: options.season,
    brand: "",
    model: "",
    size: options.size ?? "",
    dot: "",
    treadDepth: "",
    treadMeasuredOn: options.today,
    storageLocation: "",
    storageContactId: null,
    purchasedOn: "",
    notes: "",
  };
}

export function draftFromTireSet(set: TireSet): TireSetDraft {
  return {
    season: set.season,
    brand: set.brand ?? "",
    model: set.model ?? "",
    size: set.size ?? "",
    dot: set.dot ?? "",
    treadDepth: "",
    treadMeasuredOn: set.treadMeasuredOn ?? "",
    storageLocation: set.storageLocation ?? "",
    storageContactId: set.storageContactId,
    purchasedOn: set.purchasedOn ?? "",
    notes: set.notes ?? "",
  };
}

function setFields(draft: TireSetDraft, errors: Record<string, string>) {
  const dot = draft.dot.trim();
  if (dot !== "" && !isValidDot(dot)) errors.dot = m.tire_error_dot();
  if (draft.purchasedOn && !isValidDate(draft.purchasedOn)) {
    errors.purchasedOn = m.field_invalid_date();
  }
  return {
    season: draft.season,
    brand: draft.brand,
    model: draft.model,
    size: draft.size,
    dot,
    storageLocation: draft.storageLocation,
    storageContactId: draft.storageContactId,
    purchasedOn: draft.purchasedOn || null,
    notes: draft.notes,
  };
}

const treadError = () => m.tire_error_tread({ max: MAX_TREAD_MM });

export function buildCreateTireSet(
  draft: TireSetDraft,
  today: string,
): Built<CreateTireSetRequest> {
  const errors: Record<string, string> = {};
  const fields = setFields(draft, errors);
  const depth = parseDecimalInput(draft.treadDepth, MAX_TREAD_MM);
  if (depth === undefined) errors.treadDepthMm = treadError();
  const measuredOn = draft.treadMeasuredOn || today;
  if (depth !== null && depth !== undefined) {
    if (!isValidDate(measuredOn))
      errors.treadMeasuredOn = m.field_invalid_date();
    else if (measuredOn > today) {
      errors.treadMeasuredOn = m.vehicle_odometer_date_future();
    }
  }
  const candidate = {
    ...fields,
    ...(typeof depth === "number"
      ? { treadDepthMm: depth, treadMeasuredOn: measuredOn }
      : {}),
  };
  if (Object.keys(errors).length > 0) return { body: undefined, errors };
  const result = createTireSetRequestSchema.safeParse(candidate);
  if (!result.success) {
    return {
      body: undefined,
      errors: issuesToErrors(result.error.issues, candidate),
    };
  }
  return { body: result.data, errors };
}

export function buildUpdateTireSet(
  draft: TireSetDraft,
): Built<UpdateTireSetRequest> {
  const errors: Record<string, string> = {};
  const candidate = setFields(draft, errors);
  if (Object.keys(errors).length > 0) return { body: undefined, errors };
  const result = updateTireSetRequestSchema.safeParse(candidate);
  if (!result.success) {
    return {
      body: undefined,
      errors: issuesToErrors(result.error.issues, candidate),
    };
  }
  return { body: result.data, errors };
}

function checkDay(
  date: string,
  today: string,
  errors: Record<string, string>,
): void {
  if (!date) errors.date = m.field_required();
  else if (!isValidDate(date)) errors.date = m.field_invalid_date();
  else if (date > today) errors.date = m.vehicle_odometer_date_future();
}

function readOdometer(
  text: string,
  known: number | null,
  errors: Record<string, string>,
): number | undefined {
  const reading = readingToSend(text, known, MAX_ODOMETER_VALUE);
  if (!reading.ok) {
    errors.odometer = m.vehicle_odometer_invalid({
      max: MAX_ODOMETER_VALUE.toLocaleString("en"),
    });
    return undefined;
  }
  return reading.value ?? undefined;
}

export function buildMount(input: {
  date: string;
  odometer: string;
  known: number | null;
  today: string;
}): Built<MountTireSetRequest> {
  const errors: Record<string, string> = {};
  checkDay(input.date, input.today, errors);
  const odometer = readOdometer(input.odometer, input.known, errors);
  const candidate = {
    date: input.date,
    ...(odometer === undefined ? {} : { odometer }),
  };
  if (Object.keys(errors).length > 0) return { body: undefined, errors };
  const result = mountTireSetRequestSchema.safeParse(candidate);
  if (!result.success) {
    return {
      body: undefined,
      errors: issuesToErrors(result.error.issues, candidate),
    };
  }
  return { body: result.data, errors };
}

export function buildTread(input: {
  date: string;
  depth: string;
  odometer: string;
  known: number | null;
  today: string;
}): Built<MeasureTreadRequest> {
  const errors: Record<string, string> = {};
  checkDay(input.date, input.today, errors);
  const depth = parseDecimalInput(input.depth, MAX_TREAD_MM);
  if (depth === null) errors.treadDepthMm = m.field_required();
  else if (depth === undefined) errors.treadDepthMm = treadError();
  const odometer = readOdometer(input.odometer, input.known, errors);
  if (Object.keys(errors).length > 0 || typeof depth !== "number") {
    return { body: undefined, errors };
  }
  const candidate = {
    date: input.date,
    treadDepthMm: depth,
    ...(odometer === undefined ? {} : { odometer }),
  };
  const result = measureTreadRequestSchema.safeParse(candidate);
  if (!result.success) {
    return {
      body: undefined,
      errors: issuesToErrors(result.error.issues, candidate),
    };
  }
  return { body: result.data, errors };
}
