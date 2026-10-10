import { and, eq, sql } from "drizzle-orm";
import type { CostCategory, FuelUnit } from "$lib/api/enums";
import { yearRange } from "$lib/server/costs/costs";
import { dateInZone, householdTimeZone } from "$lib/server/config";
import {
  assets,
  costEntries,
  fuelLogs,
  odometerReadings,
} from "$lib/server/db";
import { getHousehold } from "$lib/server/household/household";
import { notFound, type ServiceContext } from "$lib/server/service";
import {
  getUpcomingTasks,
  type DashboardTaskRecord,
} from "$lib/server/tasks/dashboard";
import {
  averageConsumption,
  pricePerUnitMinor,
  type Stretch,
} from "$lib/vehicles/fuel";
import {
  distanceBetween,
  distanceByMonth,
  monthsBetween,
  round1,
} from "$lib/vehicles/stats";
import { stretchesOf } from "./fuel-logs";
import { odometerUnitOf } from "./summary";
import { mountedTireSet, type TireSetDetailRecord } from "./tires";

export const LAST_CONSUMPTION_VALUES = 10;
export const PRICE_TREND_FILLS = 24;
export const NEXT_TASKS = 5;

export interface VehicleStatsRecord {
  assetId: string;
  year: number | null;
  from: string | null;
  to: string | null;
  today: string;
  odometerUnit: "km" | "mi";
  distance: number;
  distanceByMonth: { month: string; distance: number }[];
  costs: {
    currency: string;
    totalMinor: number;
    count: number;
    otherCurrencyCount: number;
    byCategory: { category: CostCategory; totalMinor: number; count: number }[];
  };
  costPerDistanceMinor: number | null;
  consumption: {
    unit: FuelUnit;
    averagePer100: number | null;
    stretchCount: number;
    last: {
      fillId: string;
      date: string;
      distance: number;
      quantity: number;
      consumptionPer100: number;
    }[];
  }[];
  priceTrend: {
    fillId: string;
    date: string;
    unit: FuelUnit;
    pricePerUnitMinor: number;
  }[];
  tireSet: TireSetDetailRecord | null;
  nextTasks: DashboardTaskRecord[];
}

/**
 * A vehicle in numbers, for a year or for all time: how far it was driven (from the odometer
 * readings, in total and per month), what it cost (every cost entry of the vehicle that counts as an
 * expense, in the household currency, by category) and per distance unit, how much it uses (the
 * full-to-full stretches closed in the period: the average and the last ten) and what the fuel cost
 * per unit, the tires it runs on and its next tasks. An asset that is no vehicle has no statistics (404).
 */
export async function vehicleStats(
  ctx: ServiceContext,
  assetId: string,
  year: number | undefined,
): Promise<VehicleStatsRecord> {
  const asset = ctx.db
    .select({ kind: assets.kind })
    .from(assets)
    .where(eq(assets.id, assetId))
    .get();
  if (!asset) throw notFound("Asset");
  if (asset.kind !== "vehicle") throw notFound("Vehicle");

  const { currency } = getHousehold(ctx);
  const readings = ctx.db
    .select({ date: odometerReadings.date, value: odometerReadings.value })
    .from(odometerReadings)
    .where(eq(odometerReadings.assetId, assetId))
    .all();
  const dates = readings.map((r) => r.date).sort();
  const span = year === undefined ? null : yearRange(year);
  const from = span ? span.from : (dates[0] ?? null);
  const to = span ? span.to : (dates[dates.length - 1] ?? null);
  const inPeriod = (date: string) =>
    (from === null || date >= from) && (to === null || date <= to);

  const months =
    from && to ? monthsBetween(from.slice(0, 7), to.slice(0, 7)) : [];
  const distance = from && to ? distanceBetween(readings, from, to) : 0;

  const entries = ctx.db
    .select({
      amountMinor: costEntries.amountMinor,
      currency: costEntries.currency,
      category: costEntries.category,
      date: costEntries.date,
      countsAsExpense: costEntries.countsAsExpense,
    })
    .from(costEntries)
    .where(
      and(
        eq(costEntries.assetId, assetId),
        span ? sql`${costEntries.date} >= ${span.from}` : undefined,
        span ? sql`${costEntries.date} <= ${span.to}` : undefined,
      ),
    )
    .all();
  let total = 0;
  let count = 0;
  let otherCurrency = 0;
  const categories = new Map<
    CostCategory,
    { totalMinor: number; count: number }
  >();
  for (const entry of entries) {
    if (entry.currency !== currency) {
      otherCurrency += 1;
      continue;
    }
    if (!entry.countsAsExpense) continue;
    total += entry.amountMinor;
    count += 1;
    const tally = categories.get(entry.category) ?? { totalMinor: 0, count: 0 };
    tally.totalMinor += entry.amountMinor;
    tally.count += 1;
    categories.set(entry.category, tally);
  }

  const stretches = stretchesOf(ctx, assetId).filter((s) => inPeriod(s.date));
  const units = [...new Set(stretches.map((s) => s.unit))].sort();
  const consumption = units.map((unit) => {
    const own: Stretch[] = stretches.filter((s) => s.unit === unit);
    return {
      unit,
      averagePer100: averageConsumption(own),
      stretchCount: own.length,
      last: own.slice(-LAST_CONSUMPTION_VALUES).map((s) => ({
        fillId: s.fillId,
        date: s.date,
        distance: s.distance,
        quantity: s.quantity,
        consumptionPer100: s.consumptionPer100,
      })),
    };
  });

  const priceTrend = ctx.db
    .select()
    .from(fuelLogs)
    .where(and(eq(fuelLogs.assetId, assetId), eq(fuelLogs.currency, currency)))
    .all()
    .filter((f) => inPeriod(f.date))
    .sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.odometer - b.odometer,
    )
    .flatMap((f) => {
      const price = pricePerUnitMinor(f);
      return price === null
        ? []
        : [
            {
              fillId: f.id,
              date: f.date,
              unit: f.unit,
              pricePerUnitMinor: price,
            },
          ];
    })
    .slice(-PRICE_TREND_FILLS);

  const upcoming = await getUpcomingTasks(ctx, { assetId });
  const nextTasks = [
    ...upcoming.upcoming.overdue,
    ...upcoming.upcoming.today,
    ...upcoming.upcoming.thisWeek,
    ...upcoming.upcoming.later,
    ...upcoming.upcoming.signalBased,
  ].slice(0, NEXT_TASKS);

  return {
    assetId,
    year: year ?? null,
    from,
    to,
    today: dateInZone(ctx.now, householdTimeZone()),
    odometerUnit: odometerUnitOf(ctx.db, assetId),
    distance: round1(distance),
    distanceByMonth: distanceByMonth(readings, months).map((m) => ({
      month: m.month,
      distance: round1(m.distance),
    })),
    costs: {
      currency,
      totalMinor: total,
      count,
      otherCurrencyCount: otherCurrency,
      byCategory: [...categories]
        .map(([category, t]) => ({ category, ...t }))
        .sort(
          (a, b) =>
            b.totalMinor - a.totalMinor || a.category.localeCompare(b.category),
        ),
    },
    costPerDistanceMinor: distance > 0 ? total / distance : null,
    consumption,
    priceTrend,
    tireSet: mountedTireSet(ctx, assetId),
    nextTasks,
  };
}
