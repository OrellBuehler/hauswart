import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { get, remove, update } from "$lib/server/api/handlers/settlements";

export const GET = bind(endpoints.settlementsGet, get);
export const PATCH = bind(endpoints.settlementsUpdate, update);
export const DELETE = bind(endpoints.settlementsDelete, remove);
