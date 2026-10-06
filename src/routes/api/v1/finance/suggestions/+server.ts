import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { listAll } from "$lib/server/api/handlers/finance";

export const GET = bind(endpoints.financeSuggestionsList, listAll);
