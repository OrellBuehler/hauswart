import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { create, list } from "$lib/server/api/handlers/fuelLogs";

export const GET = bind(endpoints.fuelLogsList, list);
export const POST = bind(endpoints.fuelLogsCreate, create);
