import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import type { TireSet } from "$lib/api/schemas/tire-sets";
import type { Vehicle } from "$lib/api/schemas/vehicles";
import TireSetsCard from "./tire-sets-card.svelte";

const vehicle: Vehicle = {
  assetId: "a1",
  plate: "ZH 000000",
  vin: null,
  registrationNumber: null,
  firstRegistration: "2022-03-10",
  fuelType: "diesel",
  tireSizeSummer: "205/55 R16",
  tireSizeWinter: "195/65 R15",
  location: null,
  odometerUnit: "km",
  notes: null,
  odometer: { value: 44420, date: "2026-10-08", unit: "km" },
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const set = (over: Partial<TireSet>): TireSet => ({
  id: "ts1",
  assetId: "a1",
  season: "winter",
  brand: "Beispiel",
  model: "Alpin",
  size: "195/65 R15",
  dot: "2423",
  treadDepthMm: 6.5,
  treadMeasuredOn: "2026-03-01",
  treadWarning: false,
  ageYears: 2.3,
  storageLocation: "Keller",
  storageContactId: null,
  storageContactName: null,
  mounted: false,
  mountedOn: null,
  purchasedOn: null,
  retiredAt: null,
  notes: null,
  distance: 0,
  odometerUnit: "km",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

function html(sets: TireSet[], canWrite = true): string {
  return render(TireSetsCard as never, {
    props: {
      assetId: "a1",
      sets,
      vehicle,
      today: "2026-10-11",
      canWrite,
    } as never,
  }).body;
}

describe("TireSetsCard", () => {
  it("says which set is mounted", () => {
    const body = html([
      set({
        id: "s",
        season: "summer",
        size: "205/55 R16",
        mounted: true,
        mountedOn: "2026-04-15",
      }),
      set({ id: "w" }),
    ]);
    expect(body).toContain("Sommerreifen 205/55 R16, seit");
    expect(body).toContain("Aufgezogen");
  });

  it("warns clearly when the tread is low or the tires are old", () => {
    const body = html([
      set({ treadWarning: true, treadDepthMm: 3.5, ageYears: 7.4 }),
    ]);
    expect(body).toContain('role="alert"');
    expect(body).toContain("Reifen prüfen");
    expect(body).toMatch(/Profiltiefe 3[.,]5 mm, unter der Grenze von 4 mm/);
    expect(body).toMatch(/7[.,]4 Jahre alt/);
  });

  it("raises no alarm for a set in good shape", () => {
    const body = html([set({})]);
    expect(body).not.toContain('role="alert"');
  });

  it("raises no alarm for a retired set", () => {
    const body = html([
      set({
        treadWarning: true,
        treadDepthMm: 1.5,
        ageYears: 9,
        retiredAt: "2026-01-01T00:00:00.000Z",
      }),
    ]);
    expect(body).not.toContain('role="alert"');
  });

  it("offers to mount a set that is not mounted, and not the one that is", () => {
    const body = html([
      set({
        id: "s",
        season: "summer",
        mounted: true,
        mountedOn: "2026-04-15",
      }),
      set({ id: "w" }),
    ]);
    expect(body.match(/>\s*Aufziehen\s*</g)).toHaveLength(1);
    expect(body.match(/Profil messen/g)).toHaveLength(2);
  });

  it("hides retired sets behind a button", () => {
    const body = html([
      set({ id: "w" }),
      set({
        id: "old",
        season: "summer",
        size: "175/70 R14",
        retiredAt: "2026-01-01T00:00:00.000Z",
      }),
    ]);
    expect(body).not.toContain("175/70 R14");
    expect(body).toContain("1 ausgemusterten Satz anzeigen");
  });

  it("explains itself when there is no set", () => {
    const body = html([]);
    expect(body).toContain("Noch keine Reifensätze");
  });

  it("leaves out every action for a person who may not write", () => {
    const body = html([set({})], false);
    expect(body).not.toContain("Satz hinzufügen");
    expect(body).not.toContain("Profil messen");
    expect(body).not.toContain("Aktionen für");
  });
});
