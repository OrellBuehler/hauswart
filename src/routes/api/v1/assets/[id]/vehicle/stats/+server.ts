import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { stats } from "#lib/server/api/handlers/vehicles.ts";

export const GET = bind(endpoints.vehicleStats, stats);
