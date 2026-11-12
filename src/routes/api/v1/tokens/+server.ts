import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { create, list } from "#lib/server/api/handlers/tokens.ts";

export const GET = bind(endpoints.tokensList, list);
export const POST = bind(endpoints.tokensCreate, create);
