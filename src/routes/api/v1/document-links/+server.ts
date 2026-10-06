import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { linksCreate, linksList } from "$lib/server/api/handlers/documents";

export const GET = bind(endpoints.documentLinksList, linksList);
export const POST = bind(endpoints.documentLinksCreate, linksCreate);
