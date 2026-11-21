import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { create, list } from "#lib/server/api/handlers/guestLinks.ts";

export const GET = bind(endpoints.guestLinksList, list);
export const POST = bind(endpoints.guestLinksCreate, create);
