import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { get, remove, update } from "$lib/server/api/handlers/fuelLogs";

export const GET = bind(endpoints.fuelLogsGet, get);
export const PATCH = bind(endpoints.fuelLogsUpdate, update);
export const DELETE = bind(endpoints.fuelLogsDelete, remove);
