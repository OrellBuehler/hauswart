import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { get, remove, update } from "$lib/server/api/handlers/tireSets";

export const GET = bind(endpoints.tireSetsGet, get);
export const PATCH = bind(endpoints.tireSetsUpdate, update);
export const DELETE = bind(endpoints.tireSetsDelete, remove);
