import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { get, remove, update } from "$lib/server/api/handlers/cost-tags";

export const GET = bind(endpoints.costTagsGet, get);
export const PATCH = bind(endpoints.costTagsUpdate, update);
export const DELETE = bind(endpoints.costTagsDelete, remove);
