import type { CostSplitMode, FuelUnit, VehicleFuelType } from "$lib/api/enums";
import { MAX_COST_MINOR } from "$lib/api/schemas/costs";
import {
  MAX_FUEL_QUANTITY,
  createFuelLogRequestSchema,
  updateFuelLogRequestSchema,
  type CreateFuelLogRequest,
  type FuelLog,
  type UpdateFuelLogRequest,
} from "$lib/api/schemas/fuel-logs";
import { currencySchema } from "$lib/api/schemas/household";
import { MAX_ODOMETER_VALUE } from "$lib/api/schemas/vehicles";
import { equalShares, validateShares } from "$lib/costs/form";
import { isValidDate } from "$lib/dates";
import { formatMoney, readMoney } from "$lib/format-money";
import { currencyExponent, minor, toDecimalString } from "$lib/money";
import { m } from "$lib/paraglide/messages";
import { issuesToErrors } from "$lib/tasks/field-errors";
import { parseDecimalInput } from "./format";

export type FuelDraft = {
  date: string;
  odometer: string;
  quantity: string;
  amount: string;
  unit: FuelUnit;
  currency: string;
  fullTank: boolean;
  missedPrevious: boolean;
  station: string;
  notes: string;
  paidByUserId: string;
  splitMode: CostSplitMode;
  shares: Record<string, string>;
};

export function defaultFuelUnit(
  fuelType: VehicleFuelType | null | undefined,
): FuelUnit {
  return fuelType === "electric" ? "kWh" : "l";
}

export function newFuelDraft(options: {
  today: string;
  unit: FuelUnit;
  currency: string;
  paidByUserId: string;
  userIds: readonly string[];
}): FuelDraft {
  return {
    date: options.today,
    odometer: "",
    quantity: "",
    amount: "",
    unit: options.unit,
    currency: options.currency,
    fullTank: true,
    missedPrevious: false,
    station: "",
    notes: "",
    paidByUserId: options.paidByUserId,
    splitMode: "ownership",
    shares: equalShares(options.userIds),
  };
}

export function draftFromFuelLog(
  log: FuelLog,
  userIds: readonly string[],
): FuelDraft {
  return {
    date: log.date,
    odometer: String(log.odometer),
    quantity: String(log.quantity),
    amount: toDecimalString(
      minor(log.amountMinor),
      currencyExponent(log.currency),
    ),
    unit: log.unit,
    currency: log.currency,
    fullTank: log.fullTank,
    missedPrevious: log.missedPrevious,
    station: log.station ?? "",
    notes: log.notes ?? "",
    paidByUserId: log.paidByUserId ?? "",
    splitMode: "ownership",
    shares: equalShares(userIds),
  };
}

const currencyOf = (draft: Pick<FuelDraft, "currency">): string =>
  draft.currency.trim().toUpperCase();

type Fill = {
  date: string;
  odometer: number;
  quantity: number;
  amountMinor: number;
};

type Checked = {
  errors: Record<string, string>;
  fill: Fill | undefined;
};

function check(draft: FuelDraft, today: string): Checked {
  const errors: Record<string, string> = {};
  if (!draft.date) errors.date = m.field_required();
  else if (!isValidDate(draft.date)) errors.date = m.field_invalid_date();
  else if (draft.date > today) errors.date = m.vehicle_odometer_date_future();

  const odometer = parseDecimalInput(draft.odometer, MAX_ODOMETER_VALUE);
  if (odometer === null) errors.odometer = m.field_required();
  else if (odometer === undefined) {
    errors.odometer = m.vehicle_odometer_invalid({
      max: MAX_ODOMETER_VALUE.toLocaleString("en"),
    });
  }

  const quantity = parseDecimalInput(draft.quantity, MAX_FUEL_QUANTITY);
  if (quantity === null) errors.quantity = m.field_required();
  else if (quantity === undefined || quantity <= 0) {
    errors.quantity = m.fuel_error_quantity({
      max: MAX_FUEL_QUANTITY.toLocaleString("en"),
    });
  }

  let amountMinor: number | undefined;
  const currency = currencyOf(draft);
  if (!currencySchema.safeParse(currency).success) {
    errors.currency = m.cost_currency_invalid();
  } else {
    const amount = readMoney(draft.amount, currency);
    if (amount === null) errors.amountMinor = m.field_required();
    else if (amount === undefined || amount < 0) {
      errors.amountMinor = m.cost_amount_invalid({
        decimals: currencyExponent(currency),
      });
    } else if (amount > MAX_COST_MINOR) {
      errors.amountMinor = m.cost_amount_too_large({
        max: formatMoney(MAX_COST_MINOR, currency),
      });
    } else amountMinor = amount;
  }

  if (
    Object.keys(errors).length > 0 ||
    typeof odometer !== "number" ||
    typeof quantity !== "number" ||
    amountMinor === undefined
  ) {
    return { errors, fill: undefined };
  }
  return {
    errors,
    fill: { date: draft.date, odometer, quantity, amountMinor },
  };
}

const nullable = (text: string): string | null => text.trim() || null;

export type BuiltFuel<T> = {
  body: T | undefined;
  errors: Record<string, string>;
};

export function buildCreateFuelLog(
  draft: FuelDraft,
  options: { today: string; userIds: readonly string[] },
): BuiltFuel<CreateFuelLogRequest> {
  const { errors, fill } = check(draft, options.today);
  let shares: { userId: string; shareBps: number }[] = [];
  if (draft.splitMode === "custom") {
    const checked = validateShares(draft.shares, options.userIds);
    shares = checked.items;
    if (checked.error) errors.shares = checked.error;
  }
  if (!fill || Object.keys(errors).length > 0) {
    return { body: undefined, errors };
  }
  const candidate = {
    date: fill.date,
    odometer: fill.odometer,
    quantity: fill.quantity,
    unit: draft.unit,
    amountMinor: fill.amountMinor,
    currency: currencyOf(draft),
    fullTank: draft.fullTank,
    missedPrevious: draft.missedPrevious,
    station: nullable(draft.station),
    notes: nullable(draft.notes),
    paidByUserId: draft.paidByUserId || null,
    splitMode: draft.splitMode,
    ...(draft.splitMode === "custom" ? { shares } : {}),
  };
  const result = createFuelLogRequestSchema.safeParse(candidate);
  if (!result.success) {
    return {
      body: undefined,
      errors: issuesToErrors(result.error.issues, candidate),
    };
  }
  return { body: result.data, errors };
}

export type FuelUpdate =
  | { kind: "invalid"; errors: Record<string, string> }
  | { kind: "unchanged" }
  | { kind: "changed"; body: UpdateFuelLogRequest };

export function buildUpdateFuelLog(
  draft: FuelDraft,
  log: FuelLog,
  today: string,
): FuelUpdate {
  const { errors, fill } = check(draft, today);
  if (!fill || Object.keys(errors).length > 0) {
    return { kind: "invalid", errors };
  }
  const changes: Record<string, unknown> = {};
  if (fill.date !== log.date) changes.date = fill.date;
  if (fill.odometer !== log.odometer) changes.odometer = fill.odometer;
  if (fill.quantity !== log.quantity) changes.quantity = fill.quantity;
  if (draft.unit !== log.unit) changes.unit = draft.unit;
  if (fill.amountMinor !== log.amountMinor)
    changes.amountMinor = fill.amountMinor;
  if (currencyOf(draft) !== log.currency) changes.currency = currencyOf(draft);
  if (draft.fullTank !== log.fullTank) changes.fullTank = draft.fullTank;
  if (draft.missedPrevious !== log.missedPrevious) {
    changes.missedPrevious = draft.missedPrevious;
  }
  if (nullable(draft.station) !== log.station) {
    changes.station = nullable(draft.station);
  }
  if (nullable(draft.notes) !== log.notes)
    changes.notes = nullable(draft.notes);
  const payer = draft.paidByUserId || null;
  if (payer !== log.paidByUserId) changes.paidByUserId = payer;
  if (Object.keys(changes).length === 0) return { kind: "unchanged" };
  const result = updateFuelLogRequestSchema.safeParse(changes);
  if (!result.success) {
    return {
      kind: "invalid",
      errors: issuesToErrors(result.error.issues, changes),
    };
  }
  return { kind: "changed", body: result.data };
}
