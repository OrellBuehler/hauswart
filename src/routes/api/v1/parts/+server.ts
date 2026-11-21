import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { create, list } from "#lib/server/api/handlers/parts.ts";

export const GET = bind(endpoints.partsList, list);
export const POST = bind(endpoints.partsCreate, create);
