import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { create, list } from "$lib/server/api/handlers/calendarTargets";

export const GET = bind(endpoints.calendarTargetsList, list);
export const POST = bind(endpoints.calendarTargetsCreate, create);
