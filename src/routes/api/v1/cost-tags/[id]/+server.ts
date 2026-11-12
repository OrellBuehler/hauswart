import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { get, remove, update } from "#lib/server/api/handlers/cost-tags.ts";

export const GET = bind(endpoints.costTagsGet, get);
export const PATCH = bind(endpoints.costTagsUpdate, update);
export const DELETE = bind(endpoints.costTagsDelete, remove);
