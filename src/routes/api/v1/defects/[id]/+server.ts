import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { get, remove, update } from "#lib/server/api/handlers/defects.ts";

export const GET = bind(endpoints.defectsGet, get);
export const PATCH = bind(endpoints.defectsUpdate, update);
export const DELETE = bind(endpoints.defectsDelete, remove);
