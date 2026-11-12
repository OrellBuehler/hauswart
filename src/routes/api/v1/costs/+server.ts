import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { create, list } from "#lib/server/api/handlers/costs.ts";

export const GET = bind(endpoints.costsList, list);
export const POST = bind(endpoints.costsCreate, create);
