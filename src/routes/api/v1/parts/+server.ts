import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { create, list } from "$lib/server/api/handlers/parts";

export const GET = bind(endpoints.partsList, list);
export const POST = bind(endpoints.partsCreate, create);
