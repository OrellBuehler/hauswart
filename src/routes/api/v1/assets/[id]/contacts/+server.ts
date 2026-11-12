import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { link, listForAsset } from "#lib/server/api/handlers/contacts.ts";

export const GET = bind(endpoints.assetContactsList, listForAsset);
export const POST = bind(endpoints.assetContactsLink, link);
