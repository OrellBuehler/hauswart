import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { get, remove, update } from "#lib/server/api/handlers/costs.ts";

export const GET = bind(endpoints.costsGet, get);
export const PATCH = bind(endpoints.costsUpdate, update);
export const DELETE = bind(endpoints.costsDelete, remove);
