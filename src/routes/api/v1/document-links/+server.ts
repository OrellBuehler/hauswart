import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { linksCreate, linksList } from "#lib/server/api/handlers/documents.ts";

export const GET = bind(endpoints.documentLinksList, linksList);
export const POST = bind(endpoints.documentLinksCreate, linksCreate);
