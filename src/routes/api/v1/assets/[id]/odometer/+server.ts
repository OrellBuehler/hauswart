import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import {
  listOdometer,
  recordOdometerReading,
} from "$lib/server/api/handlers/vehicles";

export const GET = bind(endpoints.odometerList, listOdometer);
export const POST = bind(endpoints.odometerCreate, recordOdometerReading);
