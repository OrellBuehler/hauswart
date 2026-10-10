import { z } from "zod";
import { endpoints } from "../../../src/lib/api/registry";
import { round } from "../format";
import { defineTool } from "../tool";
import { money, rate } from "./costs";
import { tireRow } from "./tires";
import { dashboardTaskRow } from "./upcoming";
import { resolveVehicle, vehicleLabel, vehicleRef } from "./vehicles";

export const getVehicleStats = defineTool({
  name: "get_vehicle_stats",
  title: "A vehicle in numbers",
  description:
    "Statistics of a vehicle (id, name or plate) for a year or, without year, for all time: the distance driven (from the odometer readings, also per month), what it cost (the vehicle's cost entries that count as an expense, in the household currency, by category and per distance unit), the consumption per 100 (average and the last ten stretches, litres and kWh apart), the price per litre or kWh of the last fills, the tire set that is mounted and the vehicle's next tasks. Consumption needs full fills in the fuel log (add_fuel_log, list_fuel_logs); costs and distance need cost entries and odometer readings. Amounts are decimals in the household currency.",
  mode: "read",
  input: {
    vehicle: vehicleRef,
    year: z.number().int().min(1990).max(2200).optional(),
  },
  async handler({ vehicle: ref, year }, ctx) {
    const asset = await resolveVehicle(ctx, ref);
    const s = await ctx.api.call(endpoints.vehicleStats, {
      params: { id: asset.id },
      query: { year },
    });
    const unit = s.odometerUnit;
    const currency = s.costs.currency;
    const averages = s.consumption.flatMap((c) =>
      c.averagePer100 === null
        ? []
        : [`${round(c.averagePer100)} ${c.unit}/100 ${unit}`],
    );
    const parts = [
      `${round(s.distance, 1)} ${unit} driven`,
      `${money(s.costs.totalMinor, currency)} in costs${
        s.costPerDistanceMinor === null
          ? ""
          : ` (${rate(s.costPerDistanceMinor, currency, unit)})`
      }`,
      ...(averages.length > 0 ? [`consumption ${averages.join(", ")}`] : []),
    ];
    return {
      summary: `${vehicleLabel(asset)} (${s.year ?? "all time"}): ${parts.join("; ")}.`,
      data: {
        vehicle: asset.name,
        vehicleId: asset.id,
        year: s.year,
        from: s.from,
        to: s.to,
        unit,
        distance: round(s.distance, 1),
        distanceByMonth: s.distanceByMonth.map((m) => ({
          month: m.month,
          distance: round(m.distance, 1),
        })),
        costs: {
          total: money(s.costs.totalMinor, currency),
          count: s.costs.count,
          byCategory: s.costs.byCategory.map((c) => ({
            category: c.category,
            total: money(c.totalMinor, currency),
            count: c.count,
          })),
          otherCurrencyEntries: s.costs.otherCurrencyCount || null,
        },
        costPerDistance:
          s.costPerDistanceMinor === null
            ? null
            : rate(s.costPerDistanceMinor, currency, unit),
        consumption: s.consumption.map((c) => ({
          unit: c.unit,
          averagePer100:
            c.averagePer100 === null ? null : round(c.averagePer100),
          stretches: c.stretchCount,
          last: c.last.map((l) => ({
            date: l.date,
            distance: round(l.distance, 1),
            quantity: round(l.quantity, 1),
            per100: round(l.consumptionPer100),
          })),
        })),
        priceTrend: s.priceTrend.map((p) => ({
          date: p.date,
          price: rate(p.pricePerUnitMinor, currency, p.unit),
        })),
        tireSet: s.tireSet ? tireRow(s.tireSet) : null,
        nextTasks: s.nextTasks.map(dashboardTaskRow),
      },
    };
  },
});
