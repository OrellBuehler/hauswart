import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { get, remove, update } from "#lib/server/api/handlers/fuelLogs.ts";

export const GET = bind(endpoints.fuelLogsGet, get);
export const PATCH = bind(endpoints.fuelLogsUpdate, update);
export const DELETE = bind(endpoints.fuelLogsDelete, remove);
