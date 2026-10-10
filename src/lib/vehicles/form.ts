import type { OdometerUnit, VehicleFuelType } from "$lib/api/enums";
import {
  putVehicleRequestSchema,
  type PutVehicleRequest,
  type Vehicle,
} from "$lib/api/schemas/vehicles";
import { isValidDate } from "$lib/dates";
import { issuesToErrors } from "$lib/tasks/field-errors";
import { m } from "$lib/paraglide/messages";

/** What the vehicle fields of the asset form edit. Text stays text until it is checked on submit. */
export type VehicleDraft = {
  plate: string;
  vin: string;
  registrationNumber: string;
  firstRegistration: string;
  /** Empty for "not specified". */
  fuelType: VehicleFuelType | "";
  tireSizeSummer: string;
  tireSizeWinter: string;
  location: string;
  odometerUnit: OdometerUnit;
  notes: string;
};

export function emptyVehicleDraft(): VehicleDraft {
  return {
    plate: "",
    vin: "",
    registrationNumber: "",
    firstRegistration: "",
    fuelType: "",
    tireSizeSummer: "",
    tireSizeWinter: "",
    location: "",
    odometerUnit: "km",
    notes: "",
  };
}

/** The draft for the details a vehicle has now; a vehicle never saved (or an asset that becomes one) starts empty. */
export function draftFromVehicle(
  vehicle: Vehicle | null | undefined,
): VehicleDraft {
  if (!vehicle) return emptyVehicleDraft();
  return {
    plate: vehicle.plate ?? "",
    vin: vehicle.vin ?? "",
    registrationNumber: vehicle.registrationNumber ?? "",
    firstRegistration: vehicle.firstRegistration ?? "",
    fuelType: vehicle.fuelType ?? "",
    tireSizeSummer: vehicle.tireSizeSummer ?? "",
    tireSizeWinter: vehicle.tireSizeWinter ?? "",
    location: vehicle.location ?? "",
    odometerUnit: vehicle.odometerUnit,
    notes: vehicle.notes ?? "",
  };
}

export type BuiltVehicle = {
  body: PutVehicleRequest | undefined;
  errors: Record<string, string>;
};

/**
 * The body of `PUT /assets/{id}/vehicle`. The request replaces the details, so every field is sent:
 * an empty one clears it. Errors are keyed by the request's field names.
 */
export function buildVehicleBody(draft: VehicleDraft): BuiltVehicle {
  const errors: Record<string, string> = {};
  if (draft.firstRegistration && !isValidDate(draft.firstRegistration)) {
    errors.firstRegistration = m.field_invalid_date();
  }
  const candidate = {
    plate: draft.plate,
    vin: draft.vin,
    registrationNumber: draft.registrationNumber,
    firstRegistration: draft.firstRegistration || null,
    fuelType: draft.fuelType || null,
    tireSizeSummer: draft.tireSizeSummer,
    tireSizeWinter: draft.tireSizeWinter,
    location: draft.location,
    odometerUnit: draft.odometerUnit,
    notes: draft.notes,
  };
  const result = putVehicleRequestSchema.safeParse(candidate);
  if (!result.success) {
    Object.assign(errors, {
      ...issuesToErrors(result.error.issues, candidate),
      ...errors,
    });
  }
  if (Object.keys(errors).length > 0 || !result.success) {
    return { body: undefined, errors };
  }
  return { body: result.data, errors };
}
