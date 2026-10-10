import type {
  OdometerSource,
  OdometerUnit,
  VehicleFuelType,
} from "$lib/api/enums";
import { m } from "$lib/paraglide/messages";

export const fuelLabels: Record<VehicleFuelType, () => string> = {
  petrol: () => m.vehicle_fuel_petrol(),
  diesel: () => m.vehicle_fuel_diesel(),
  electric: () => m.vehicle_fuel_electric(),
  hybrid: () => m.vehicle_fuel_hybrid(),
  plugin_hybrid: () => m.vehicle_fuel_plugin_hybrid(),
  other: () => m.vehicle_fuel_other(),
};

export const unitLabels: Record<OdometerUnit, () => string> = {
  km: () => m.vehicle_unit_km(),
  mi: () => m.vehicle_unit_mi(),
};

export const odometerSourceLabels: Record<OdometerSource, () => string> = {
  manual: () => m.vehicle_source_manual(),
  completion: () => m.vehicle_source_completion(),
  service_log: () => m.vehicle_source_service_log(),
  fuel_log: () => m.vehicle_source_fuel_log(),
  tire_change: () => m.vehicle_source_tire_change(),
  signal: () => m.vehicle_source_signal(),
};
