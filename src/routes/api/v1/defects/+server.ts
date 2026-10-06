import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { create, list } from "$lib/server/api/handlers/defects";

export const GET = bind(endpoints.defectsList, list);
export const POST = bind(endpoints.defectsCreate, create);
