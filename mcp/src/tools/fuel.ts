import { z } from "zod";
import { FUEL_UNITS } from "../../../src/lib/api/enums";
import { endpoints } from "../../../src/lib/api/registry";
import {
  MAX_FUEL_QUANTITY,
  type FuelLog,
} from "../../../src/lib/api/schemas/fuel-logs";
import { odometerValueSchema } from "../../../src/lib/api/schemas/vehicles";
import { moreHint, plural, round } from "../format";
import { defineTool } from "../tool";
import { money, rate, toMinor } from "./costs";
import { resolveVehicle, vehicleLabel, vehicleRef } from "./vehicles";

const date = z.iso.date();

/** `6.84 l/100 km over 600 km` for a full fill that closes a stretch, else null. */
const stretchText = (f: FuelLog) =>
  f.consumptionPer100 === null || f.distance === null
    ? null
    : `${round(f.consumptionPer100)} ${f.unit}/100 ${f.odometerUnit} over ${round(f.distance, 1)} ${f.odometerUnit}`;

const fillRow = (f: FuelLog) => ({
  id: f.id,
  date: f.date,
  odometer: f.odometer,
  odometerUnit: f.odometerUnit,
  quantity: f.quantity,
  unit: f.unit,
  amount: money(f.amountMinor, f.currency),
  pricePerUnit:
    f.pricePerUnitMinor === null
      ? null
      : rate(f.pricePerUnitMinor, f.currency, f.unit),
  fullTank: f.fullTank ? null : false,
  missedPrevious: f.missedPrevious ? true : null,
  station: f.station,
  notes: f.notes,
  distance: f.distance === null ? null : round(f.distance, 1),
  consumptionPer100:
    f.consumptionPer100 === null ? null : round(f.consumptionPer100),
  costPerDistance:
    f.costPerDistanceMinor === null
      ? null
      : rate(f.costPerDistanceMinor, f.currency, f.odometerUnit),
  costEntryId: f.costEntryId,
});

export const addFuelLog = defineTool({
  name: "add_fuel_log",
  title: "Log a fill-up or charge",
  description:
    "Logs a fill-up (litres) or a charge (kWh) of a vehicle (id, name or plate). odometer is what the display shows when filling up, in the vehicle's own unit (km or mi); quantity is the litres or kWh; amount is the total price as a decimal such as '78.50' in the household currency unless currency is given ('0' for a free charge). It also records the odometer reading (a value lower than the reading before is refused as a typo) and, unless the amount is 0, books a cost entry of the category fuel for the vehicle, paid by the token's user unless paidBy says otherwise and split by ownership unless split is equal or none. unit defaults to kWh for an electric vehicle and litres otherwise. Consumption is worked out between two full fills: fullTank (default true) says the tank was filled up completely, pass false for a partial fill, and missedPrevious: true when an earlier fill was never logged, so no consumption is worked out across the gap. date defaults to today. The result shows the price per unit and, for a full fill that closes a stretch, the distance and consumption per 100.",
  mode: "create",
  scopes: ["costs:write"],
  input: {
    vehicle: vehicleRef,
    odometer: odometerValueSchema.describe(
      "What the odometer shows, in the vehicle's unit",
    ),
    quantity: z.number().finite().positive().max(MAX_FUEL_QUANTITY),
    amount: z
      .string()
      .trim()
      .min(1)
      .max(20)
      .describe(
        "Total price as a decimal, e.g. '78.50'; '0' for a free charge",
      ),
    unit: z.enum(FUEL_UNITS).optional(),
    date: date.optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    fullTank: z.boolean().default(true),
    missedPrevious: z.boolean().default(false),
    station: z.string().trim().min(1).max(120).optional(),
    notes: z.string().trim().min(1).max(2000).optional(),
    paidBy: z.string().min(1).max(100).optional(),
    split: z.enum(["ownership", "equal", "none"]).optional(),
  },
  async handler(
    { vehicle: ref, amount, currency, paidBy, split, ...rest },
    ctx,
  ) {
    const asset = await resolveVehicle(ctx, ref);
    const amountMinor = toMinor(amount, currency ?? ctx.household.currency);
    const paidByUserId = paidBy ? await ctx.resolveUser(paidBy) : undefined;
    const fill = await ctx.api.call(endpoints.fuelLogsCreate, {
      params: { id: asset.id },
      body: { ...rest, amountMinor, currency, paidByUserId, splitMode: split },
    });
    const stretch = stretchText(fill);
    return {
      summary: `Logged ${fill.quantity} ${fill.unit} for ${money(fill.amountMinor, fill.currency)} on ${fill.date} at ${fill.odometer} ${fill.odometerUnit} (${vehicleLabel(asset)}).${stretch ? ` Consumption ${stretch}.` : ""}`,
      data: { vehicle: asset.name, vehicleId: asset.id, ...fillRow(fill) },
    };
  },
});

export const listFuelLogs = defineTool({
  name: "list_fuel_logs",
  title: "List the fuel log of a vehicle",
  description:
    "The fuel log (Tankbuch) of a vehicle (id, name or plate), newest first: every fill-up or charge with date, odometer, quantity, amount, price per unit and station. A full fill that closes a stretch also has the distance since the previous full fill, the consumption per 100 and the cost per distance (full-to-full: partial fills in between are added up). fullTank is shown only when false (a partial fill) and missedPrevious only when true. Filter by year. Statistics over a period are in get_vehicle_stats; log a fill with add_fuel_log.",
  mode: "read",
  input: {
    vehicle: vehicleRef,
    year: z.number().int().min(1900).max(2999).optional(),
    limit: z.number().int().min(1).max(100).default(30),
    cursor: z.string().min(1).max(512).optional(),
  },
  async handler({ vehicle: ref, year, limit, cursor }, ctx) {
    const asset = await resolveVehicle(ctx, ref);
    const page = await ctx.api.call(endpoints.fuelLogsList, {
      params: { id: asset.id },
      query: { year, limit, cursor },
    });
    return {
      summary: `${plural(page.items.length, "fuel log entry", "fuel log entries")} of ${vehicleLabel(asset)}${year ? ` in ${year}` : ""}.${moreHint(page.nextCursor)}`,
      data: {
        vehicle: asset.name,
        vehicleId: asset.id,
        fills: page.items.map(fillRow),
        nextCursor: page.nextCursor,
      },
    };
  },
});

export const fuelTools = [addFuelLog, listFuelLogs];
