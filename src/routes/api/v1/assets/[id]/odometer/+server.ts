import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import {
  listOdometer,
  recordOdometerReading,
} from "#lib/server/api/handlers/vehicles.ts";

export const GET = bind(endpoints.odometerList, listOdometer);
export const POST = bind(endpoints.odometerCreate, recordOdometerReading);
