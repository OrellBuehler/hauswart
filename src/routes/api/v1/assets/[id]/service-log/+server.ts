import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { create, listForAsset } from "$lib/server/api/handlers/serviceLog";

export const GET = bind(endpoints.assetServiceLogList, listForAsset);
export const POST = bind(endpoints.assetServiceLogCreate, create);
