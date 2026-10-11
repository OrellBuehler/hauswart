import { resolve } from "$app/paths";
import { assetHref } from "$lib/links";
import { vehicleCostsQuery } from "./cost-card";

export function vehicleCostsHref(assetId: string, year: number): string {
  return `${resolve("/costs")}${vehicleCostsQuery(assetId, year)}`;
}

export function newVehicleCostHref(assetId: string): string {
  return `${resolve("/costs/new")}?${new URLSearchParams({ asset: assetId })}`;
}

/** The fuel log card on a vehicle's page. */
export function fuelLogHref(assetId: string): string {
  return `${assetHref(assetId)}#fuel-log`;
}
