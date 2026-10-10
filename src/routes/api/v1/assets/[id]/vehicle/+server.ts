import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { get, put } from "$lib/server/api/handlers/vehicles";

export const GET = bind(endpoints.vehiclesGet, get);
export const PUT = bind(endpoints.vehiclesPut, put);
