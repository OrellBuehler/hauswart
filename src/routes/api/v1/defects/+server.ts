import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { create, list } from "#lib/server/api/handlers/defects.ts";

export const GET = bind(endpoints.defectsList, list);
export const POST = bind(endpoints.defectsCreate, create);
