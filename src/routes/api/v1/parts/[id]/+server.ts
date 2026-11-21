import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { get, remove, update } from "#lib/server/api/handlers/parts.ts";

export const GET = bind(endpoints.partsGet, get);
export const PATCH = bind(endpoints.partsUpdate, update);
export const DELETE = bind(endpoints.partsDelete, remove);
