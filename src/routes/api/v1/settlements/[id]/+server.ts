import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { get, remove, update } from "#lib/server/api/handlers/settlements.ts";

export const GET = bind(endpoints.settlementsGet, get);
export const PATCH = bind(endpoints.settlementsUpdate, update);
export const DELETE = bind(endpoints.settlementsDelete, remove);
