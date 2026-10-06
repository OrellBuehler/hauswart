import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { get, remove, update } from "$lib/server/api/handlers/pages";

export const GET = bind(endpoints.pagesGet, get);
export const PATCH = bind(endpoints.pagesUpdate, update);
export const DELETE = bind(endpoints.pagesDelete, remove);
