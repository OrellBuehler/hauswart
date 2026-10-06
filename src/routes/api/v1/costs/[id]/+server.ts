import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { get, remove, update } from "$lib/server/api/handlers/costs";

export const GET = bind(endpoints.costsGet, get);
export const PATCH = bind(endpoints.costsUpdate, update);
export const DELETE = bind(endpoints.costsDelete, remove);
