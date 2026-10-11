import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { create, list } from "$lib/server/api/handlers/settlements";

export const GET = bind(endpoints.settlementsList, list);
export const POST = bind(endpoints.settlementsCreate, create);
