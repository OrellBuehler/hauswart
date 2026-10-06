import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { remove, update } from "$lib/server/api/handlers/preparations";

export const PATCH = bind(endpoints.preparationsUpdate, update);
export const DELETE = bind(endpoints.preparationsDelete, remove);
