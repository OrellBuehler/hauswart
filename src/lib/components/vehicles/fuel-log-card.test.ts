import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import type { FuelLog } from "$lib/api/schemas/fuel-logs";
import type { VehicleStats } from "$lib/api/schemas/vehicle-stats";
import type { Vehicle } from "$lib/api/schemas/vehicles";
import FuelLogCard from "./fuel-log-card.svelte";

const vehicle: Vehicle = {
  assetId: "a1",
  plate: null,
  vin: null,
  registrationNumber: null,
  firstRegistration: null,
  fuelType: "diesel",
  tireSizeSummer: null,
  tireSizeWinter: null,
  location: null,
  odometerUnit: "km",
  notes: null,
  odometer: { value: 44300, date: "2026-10-04", unit: "km" },
  updatedAt: null,
};

const log = (over: Partial<FuelLog>): FuelLog => ({
  id: "f1",
  assetId: "a1",
  date: "2026-10-04",
  odometer: 44300,
  odometerUnit: "km",
  quantity: 35.6,
  unit: "l",
  amountMinor: 6910,
  currency: "CHF",
  fullTank: true,
  missedPrevious: false,
  station: "Beispiel-Tankstelle",
  notes: null,
  costEntryId: "c1",
  paidByUserId: null,
  pricePerUnitMinor: 194.1,
  distance: 540,
  consumptionPer100: 6.6,
  costPerDistanceMinor: 12.8,
  createdBy: null,
  createdAt: "2026-10-04T10:00:00.000Z",
  updatedAt: "2026-10-04T10:00:00.000Z",
  ...over,
});

const stats = (over: Partial<VehicleStats> = {}): VehicleStats => ({
  assetId: "a1",
  year: null,
  from: "2026-01-12",
  to: "2026-10-04",
  odometerUnit: "km",
  distance: 4200,
  distanceByMonth: [],
  costs: {
    currency: "CHF",
    totalMinor: 54510,
    count: 8,
    otherCurrencyCount: 0,
    byCategory: [],
  },
  costPerDistanceMinor: 12.6,
  consumption: [
    {
      unit: "l",
      averagePer100: 6.1,
      stretchCount: 6,
      last: [
        {
          fillId: "a",
          date: "2026-09-02",
          distance: 660,
          quantity: 37.5,
          consumptionPer100: 5.7,
        },
        {
          fillId: "b",
          date: "2026-10-04",
          distance: 540,
          quantity: 35.6,
          consumptionPer100: 6.6,
        },
      ],
    },
  ],
  priceTrend: [
    { fillId: "a", date: "2026-09-02", unit: "l", pricePerUnitMinor: 191.5 },
    { fillId: "b", date: "2026-10-04", unit: "l", pricePerUnitMinor: 194.1 },
  ],
  tireSet: null,
  nextTasks: [],
  ...over,
});

function html(
  logs: FuelLog[],
  options: { canWrite?: boolean; stats?: VehicleStats } = {},
): string {
  return render(FuelLogCard as never, {
    props: {
      assetId: "a1",
      logs,
      nextCursor: null,
      stats: options.stats ?? stats(),
      vehicle,
      currency: "CHF",
      today: "2026-10-11",
      people: [],
      currentUserId: "u1",
      canWrite: options.canWrite ?? true,
    } as never,
  }).body;
}

describe("FuelLogCard", () => {
  it("shows the consumption, the price and a chart of each", () => {
    const body = html([log({})]);
    expect(body).toMatch(/6[.,]1 l\/100 km/);
    expect(body).toMatch(/über 6 Strecken/);
    expect(body).toMatch(/CHF.1[.,]941\/l/);
    expect(body.match(/role="img"/g)).toHaveLength(2);
  });

  it("describes the price chart in words", () => {
    const body = html([log({})]);
    expect(body).toMatch(/aria-label="Preisverlauf der letzten 2 Tankungen/);
  });

  it("lists a fill-up with its amount on the right and what it closed", () => {
    const body = html([log({})]);
    expect(body).toMatch(/CHF.69[.,]10/);
    expect(body).toMatch(/text-end/);
    expect(body).toMatch(/6[.,]6 l\/100 km/);
    expect(body).toMatch(/540 km seit der letzten Vollfüllung/);
  });

  it("marks a partial fill and a gap", () => {
    const body = html([
      log({
        fullTank: false,
        missedPrevious: true,
        consumptionPer100: null,
        distance: null,
      }),
    ]);
    expect(body).toContain("Teilfüllung");
    expect(body).toContain("Lücke davor");
  });

  it("calls a free charge free", () => {
    const body = html([
      log({ unit: "kWh", amountMinor: 0, pricePerUnitMinor: 0 }),
    ]);
    expect(body).toContain("gratis");
  });

  it("explains how consumption comes about while there is none", () => {
    const body = html([log({ consumptionPer100: null, distance: null })], {
      stats: stats({
        consumption: [
          { unit: "l", averagePer100: null, stretchCount: 0, last: [] },
        ],
      }),
    });
    expect(body).toContain("Noch kein Verbrauch");
    expect(body).toContain("zwei vollen Tankfüllungen");
  });

  it("has an empty state with the way to the first entry", () => {
    const body = html([], {
      stats: stats({ consumption: [], priceTrend: [] }),
    });
    expect(body).toContain("Noch keine Tankungen");
    expect(body).toContain("Tanken erfassen");
  });

  it("offers neither adding nor changing to a person without the costs scope", () => {
    const body = html([log({})], { canWrite: false });
    expect(body).not.toContain("Tanken erfassen");
    expect(body).not.toContain("Aktionen für die Tankung");
    expect(html([], { canWrite: false })).not.toContain("Tanken erfassen");
  });
});
