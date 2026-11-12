import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { search } from "#lib/server/api/handlers/search.ts";

export const GET = bind(endpoints.search, search);
