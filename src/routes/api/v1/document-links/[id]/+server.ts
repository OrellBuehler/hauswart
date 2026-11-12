import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { linksDelete } from "#lib/server/api/handlers/documents.ts";

export const DELETE = bind(endpoints.documentLinksDelete, linksDelete);
