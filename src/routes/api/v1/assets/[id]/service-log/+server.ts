import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { create, listForAsset } from "#lib/server/api/handlers/serviceLog.ts";

export const GET = bind(endpoints.assetServiceLogList, listForAsset);
export const POST = bind(endpoints.assetServiceLogCreate, create);
