import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { create, list } from "#lib/server/api/handlers/tireSets.ts";

export const GET = bind(endpoints.tireSetsList, list);
export const POST = bind(endpoints.tireSetsCreate, create);
