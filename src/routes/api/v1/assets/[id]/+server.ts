import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { get, remove, update } from "$lib/server/api/handlers/assets";

export const GET = bind(endpoints.assetsGet, get);
export const PATCH = bind(endpoints.assetsUpdate, update);
export const DELETE = bind(endpoints.assetsDelete, remove);
