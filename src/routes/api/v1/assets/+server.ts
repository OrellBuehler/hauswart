import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { create, list } from "$lib/server/api/handlers/assets";

export const GET = bind(endpoints.assetsList, list);
export const POST = bind(endpoints.assetsCreate, create);
