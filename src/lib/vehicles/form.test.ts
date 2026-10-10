import { describe, expect, it } from "vitest";
import type { Vehicle } from "$lib/api/schemas/vehicles";
import {
  buildVehicleBody,
  draftFromVehicle,
  emptyVehicleDraft,
  type VehicleDraft,
} from "./form";

const vehicle: Vehicle = {
  assetId: "a1",
  plate: "ZH 000000",
  vin: "VIN0000000000000A",
  registrationNumber: "000.000.000",
  firstRegistration: "2022-03-10",
  fuelType: "diesel",
  tireSizeSummer: "205/55 R16",
  tireSizeWinter: "195/65 R15",
  location: "Tiefgarage",
  odometerUnit: "km",
  notes: "Reifenhotel in der Nähe",
  odometer: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const draft = (over: Partial<VehicleDraft> = {}): VehicleDraft => ({
  ...emptyVehicleDraft(),
  ...over,
});

describe("buildVehicleBody", () => {
  it("sends every field: what is empty is cleared", () => {
    const { body, errors } = buildVehicleBody(draft());
    expect(errors).toEqual({});
    expect(body).toEqual({
      plate: null,
      vin: null,
      registrationNumber: null,
      firstRegistration: null,
      fuelType: null,
      tireSizeSummer: null,
      tireSizeWinter: null,
      location: null,
      odometerUnit: "km",
      notes: null,
    });
  });

  it("trims text and keeps the rest as typed", () => {
    const { body } = buildVehicleBody(
      draft({
        plate: "  zh 123 456 ",
        vin: " V1 ",
        firstRegistration: "2022-03-10",
        fuelType: "electric",
        odometerUnit: "mi",
        notes: "  eine Zeile\nzwei  ",
      }),
    );
    expect(body).toMatchObject({
      plate: "zh 123 456",
      vin: "V1",
      firstRegistration: "2022-03-10",
      fuelType: "electric",
      odometerUnit: "mi",
      notes: "eine Zeile\nzwei",
    });
  });

  it("reports an invalid date and a too long text under the request's field names", () => {
    const { body, errors } = buildVehicleBody(
      draft({ firstRegistration: "2022-02-30", plate: "x".repeat(33) }),
    );
    expect(body).toBeUndefined();
    expect(Object.keys(errors).sort()).toEqual(["firstRegistration", "plate"]);
  });
});

describe("draftFromVehicle", () => {
  it("fills the form from the details of the vehicle", () => {
    expect(draftFromVehicle(vehicle)).toEqual({
      plate: "ZH 000000",
      vin: "VIN0000000000000A",
      registrationNumber: "000.000.000",
      firstRegistration: "2022-03-10",
      fuelType: "diesel",
      tireSizeSummer: "205/55 R16",
      tireSizeWinter: "195/65 R15",
      location: "Tiefgarage",
      odometerUnit: "km",
      notes: "Reifenhotel in der Nähe",
    });
  });

  it("starts empty, in kilometres, for a vehicle without details", () => {
    expect(draftFromVehicle(null)).toEqual(emptyVehicleDraft());
    expect(draftFromVehicle(undefined).odometerUnit).toBe("km");
  });

  it("round-trips: saving an untouched form sends what is stored", () => {
    const { body } = buildVehicleBody(draftFromVehicle(vehicle));
    expect(body).toEqual({
      plate: vehicle.plate,
      vin: vehicle.vin,
      registrationNumber: vehicle.registrationNumber,
      firstRegistration: vehicle.firstRegistration,
      fuelType: vehicle.fuelType,
      tireSizeSummer: vehicle.tireSizeSummer,
      tireSizeWinter: vehicle.tireSizeWinter,
      location: vehicle.location,
      odometerUnit: vehicle.odometerUnit,
      notes: vehicle.notes,
    });
  });

  it("keeps miles", () => {
    expect(
      draftFromVehicle({ ...vehicle, odometerUnit: "mi" }).odometerUnit,
    ).toBe("mi");
  });
});
