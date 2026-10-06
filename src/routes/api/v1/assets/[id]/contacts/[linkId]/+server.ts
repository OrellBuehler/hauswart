import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { unlink } from "$lib/server/api/handlers/contacts";

export const DELETE = bind(endpoints.assetContactsUnlink, unlink);
