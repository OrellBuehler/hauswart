import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { matches } from "$lib/server/api/handlers/finance";

export const GET = bind(endpoints.financeMatches, matches);
