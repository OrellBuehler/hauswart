import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import type { CostBook } from "$lib/api/schemas/cost-books";
import type { Vehicle } from "$lib/api/schemas/vehicles";
import VehicleCard from "./vehicle-card.svelte";

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
  costBookId: null,
  odometer: { value: 44300, date: "2026-10-04", unit: "km" },
  updatedAt: null,
};

const book = (over: Partial<CostBook> = {}): CostBook => ({
  id: "b1",
  name: "Auto",
  slug: "auto",
  icon: "car",
  defaultSplitMode: "equal",
  taxRelevant: false,
  archivedAt: null,
  sortOrder: 2,
  isDefault: false,
  entryCount: 0,
  settlementCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

function html(v: Vehicle, books: CostBook[]): string {
  return render(VehicleCard as never, {
    props: {
      assetId: "a1",
      vehicle: v,
      books,
      today: "2026-10-11",
      canWrite: true,
    } as never,
  }).body;
}

describe("VehicleCard", () => {
  it("names the book the fuel fills of the vehicle go into", () => {
    const body = html({ ...vehicle, costBookId: "b1" }, [book()]);
    expect(body).toContain("Kostenbuch");
    expect(body).toContain("Auto");
  });

  it("says when that book is archived", () => {
    const body = html({ ...vehicle, costBookId: "b1" }, [
      book({ archivedAt: "2026-06-01T00:00:00.000Z" }),
    ]);
    expect(body).toContain("Auto (archiviert)");
  });

  it("shows no book for a vehicle that uses the default book", () => {
    expect(html(vehicle, [book()])).not.toContain("Kostenbuch");
  });
});
