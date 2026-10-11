import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { remove, update } from "$lib/server/api/handlers/calendarTargets";

export const PATCH = bind(endpoints.calendarTargetsUpdate, update);
export const DELETE = bind(endpoints.calendarTargetsDelete, remove);
