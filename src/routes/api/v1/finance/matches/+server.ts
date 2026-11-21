import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { matches } from "#lib/server/api/handlers/finance.ts";

export const GET = bind(endpoints.financeMatches, matches);
