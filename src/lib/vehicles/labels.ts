import type { Component } from "svelte";
import CloudSunIcon from "@lucide/svelte/icons/cloud-sun";
import SnowflakeIcon from "@lucide/svelte/icons/snowflake";
import SunIcon from "@lucide/svelte/icons/sun";
import type {
  FuelUnit,
  OdometerSource,
  OdometerUnit,
  TireSeason,
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

export const tireSeasonLabels: Record<TireSeason, () => string> = {
  summer: () => m.tire_season_summer(),
  winter: () => m.tire_season_winter(),
  all_season: () => m.tire_season_all_season(),
};

export const tireSeasonOptionLabels: Record<TireSeason, () => string> = {
  summer: () => m.tire_season_option_summer(),
  winter: () => m.tire_season_option_winter(),
  all_season: () => m.tire_season_option_all_season(),
};

export const tireSeasonIcons: Record<TireSeason, Component> = {
  summer: SunIcon,
  winter: SnowflakeIcon,
  all_season: CloudSunIcon,
};

export const fuelUnitLabels: Record<FuelUnit, () => string> = {
  l: () => m.fuel_unit_l(),
  kWh: () => m.fuel_unit_kwh(),
};

export const odometerOwnerLabels: Partial<
  Record<OdometerSource, () => string>
> = {
  completion: () => m.vehicle_owner_completion(),
  service_log: () => m.vehicle_owner_service_log(),
  fuel_log: () => m.vehicle_owner_fuel_log(),
  tire_change: () => m.vehicle_owner_tire_change(),
};
