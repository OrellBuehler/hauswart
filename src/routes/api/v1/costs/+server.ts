import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { create, list } from "$lib/server/api/handlers/costs";

export const GET = bind(endpoints.costsList, list);
export const POST = bind(endpoints.costsCreate, create);
