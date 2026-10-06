import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { link, listForAsset } from "$lib/server/api/handlers/contacts";

export const GET = bind(endpoints.assetContactsList, listForAsset);
export const POST = bind(endpoints.assetContactsLink, link);
