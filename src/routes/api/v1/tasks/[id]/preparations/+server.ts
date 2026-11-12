import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { create, list } from "#lib/server/api/handlers/preparations.ts";

export const GET = bind(endpoints.preparationsList, list);
export const POST = bind(endpoints.preparationsCreate, create);
