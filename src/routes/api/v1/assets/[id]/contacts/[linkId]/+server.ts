import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { unlink } from "#lib/server/api/handlers/contacts.ts";

export const DELETE = bind(endpoints.assetContactsUnlink, unlink);
