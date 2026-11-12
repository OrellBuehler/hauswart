import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { removeOdometerReading } from "#lib/server/api/handlers/vehicles.ts";

export const DELETE = bind(endpoints.odometerDelete, removeOdometerReading);
