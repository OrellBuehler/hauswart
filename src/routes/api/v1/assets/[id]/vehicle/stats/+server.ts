import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { stats } from "$lib/server/api/handlers/vehicles";

export const GET = bind(endpoints.vehicleStats, stats);
