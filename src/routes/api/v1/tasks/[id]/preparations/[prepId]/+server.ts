import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { remove, update } from "#lib/server/api/handlers/preparations.ts";

export const PATCH = bind(endpoints.preparationsUpdate, update);
export const DELETE = bind(endpoints.preparationsDelete, remove);
