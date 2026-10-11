import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { removeOdometerReading } from "$lib/server/api/handlers/vehicles";

export const DELETE = bind(endpoints.odometerDelete, removeOdometerReading);
