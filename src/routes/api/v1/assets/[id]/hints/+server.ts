import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { create, listForAsset } from "$lib/server/api/handlers/hints";

export const GET = bind(endpoints.assetHintsList, listForAsset);
export const POST = bind(endpoints.assetHintsCreate, create);
