import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { create, list } from "$lib/server/api/handlers/tireSets";

export const GET = bind(endpoints.tireSetsList, list);
export const POST = bind(endpoints.tireSetsCreate, create);
