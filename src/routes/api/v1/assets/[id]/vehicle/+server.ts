import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { get, put } from "#lib/server/api/handlers/vehicles.ts";

export const GET = bind(endpoints.vehiclesGet, get);
export const PUT = bind(endpoints.vehiclesPut, put);
