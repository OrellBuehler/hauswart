import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { create, list } from "$lib/server/api/handlers/guestLinks";

export const GET = bind(endpoints.guestLinksList, list);
export const POST = bind(endpoints.guestLinksCreate, create);
