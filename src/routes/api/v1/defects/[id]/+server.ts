import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { get, remove, update } from "$lib/server/api/handlers/defects";

export const GET = bind(endpoints.defectsGet, get);
export const PATCH = bind(endpoints.defectsUpdate, update);
export const DELETE = bind(endpoints.defectsDelete, remove);
