import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { linkToAsset, listForAsset } from "$lib/server/api/handlers/parts";

export const GET = bind(endpoints.assetPartsList, listForAsset);
export const POST = bind(endpoints.assetPartsLink, linkToAsset);
