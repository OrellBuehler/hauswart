import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { get, remove, update } from "#lib/server/api/handlers/tireSets.ts";

export const GET = bind(endpoints.tireSetsGet, get);
export const PATCH = bind(endpoints.tireSetsUpdate, update);
export const DELETE = bind(endpoints.tireSetsDelete, remove);
