import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { get, remove, update } from "$lib/server/api/handlers/hints";

export const GET = bind(endpoints.hintsGet, get);
export const PATCH = bind(endpoints.hintsUpdate, update);
export const DELETE = bind(endpoints.hintsDelete, remove);
