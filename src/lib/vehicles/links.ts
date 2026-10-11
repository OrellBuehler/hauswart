import { resolve } from "$app/paths";
import { vehicleCostsQuery } from "./cost-card";

export function vehicleCostsHref(assetId: string, year: number): string {
  return `${resolve("/costs")}${vehicleCostsQuery(assetId, year)}`;
}

export function newVehicleCostHref(assetId: string): string {
  return `${resolve("/costs/new")}?${new URLSearchParams({ asset: assetId })}`;
}
