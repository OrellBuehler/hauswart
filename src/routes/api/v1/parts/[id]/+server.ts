import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { get, remove, update } from "$lib/server/api/handlers/parts";

export const GET = bind(endpoints.partsGet, get);
export const PATCH = bind(endpoints.partsUpdate, update);
export const DELETE = bind(endpoints.partsDelete, remove);
