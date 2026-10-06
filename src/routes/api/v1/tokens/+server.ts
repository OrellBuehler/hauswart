import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { create, list } from "$lib/server/api/handlers/tokens";

export const GET = bind(endpoints.tokensList, list);
export const POST = bind(endpoints.tokensCreate, create);
