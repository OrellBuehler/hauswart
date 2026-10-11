import { z } from "zod";
import { costCategorySchema } from "./costs";
import { dashboardTaskSchema } from "./dashboard";
import { dateSchema } from "./common";
import { fuelUnitSchema } from "./fuel-logs";
import { tireSetSchema } from "./tire-sets";
import { odometerUnitSchema } from "./vehicles";

/** Without a year the statistics cover everything there is. */
export const vehicleStatsQuerySchema = z.object({
  year: z.coerce.number().int().min(1990).max(2200).optional(),
});

export const vehicleStatsSchema = z
  .object({
    assetId: z.string(),
    /** The year asked for; null for all time. */
    year: z.number().int().nullable(),
    /** The period covered: the year, or from the first to the last odometer reading (null without readings). */
    from: dateSchema.nullable(),
    to: dateSchema.nullable(),
    odometerUnit: odometerUnitSchema,
    /** Driven in the period, from the odometer readings (a stretch between two readings counts evenly for the days in between). */
    distance: z.number(),
    distanceByMonth: z.array(
      z.object({ month: z.string(), distance: z.number() }),
    ),
    /** Cost entries of the vehicle that count as an expense, in the household currency (the others are only counted). */
    costs: z.object({
      currency: z.string(),
      totalMinor: z.number().int(),
      count: z.number().int(),
      otherCurrencyCount: z.number().int(),
      byCategory: z.array(
        z.object({
          category: costCategorySchema,
          totalMinor: z.number().int(),
          count: z.number().int(),
        }),
      ),
    }),
    /** Minor units per distance unit: the total cost over the distance; null without a distance. */
    costPerDistanceMinor: z.number().nullable(),
    /** One entry per unit that was filled (litres, kWh): the average over the stretches closed in the period, weighted by distance, and the last ten, oldest first. */
    consumption: z.array(
      z.object({
        unit: fuelUnitSchema,
        averagePer100: z.number().nullable(),
        stretchCount: z.number().int(),
        last: z.array(
          z.object({
            fillId: z.string(),
            date: dateSchema,
            distance: z.number(),
            quantity: z.number(),
            consumptionPer100: z.number(),
          }),
        ),
      }),
    ),
    /** The price per litre or kWh of the fills in the period (a rate in minor units), the last 24, oldest first. */
    priceTrend: z.array(
      z.object({
        fillId: z.string(),
        date: dateSchema,
        unit: fuelUnitSchema,
        pricePerUnitMinor: z.number(),
      }),
    ),
    /** The tire set the vehicle runs on. */
    tireSet: tireSetSchema.nullable(),
    /** The next tasks of the vehicle, overdue first (at most five). */
    nextTasks: z.array(dashboardTaskSchema),
  })
  .meta({ id: "VehicleStats" });
export type VehicleStats = z.infer<typeof vehicleStatsSchema>;
