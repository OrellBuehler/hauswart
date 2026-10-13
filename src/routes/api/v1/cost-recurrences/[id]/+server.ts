import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { get, remove, update } from "$lib/server/api/handlers/cost-recurrences";

export const GET = bind(endpoints.costRecurrencesGet, get);
export const PATCH = bind(endpoints.costRecurrencesUpdate, update);
export const DELETE = bind(endpoints.costRecurrencesDelete, remove);
