import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { accept } from "$lib/server/api/handlers/finance";

export const POST = bind(endpoints.financeSuggestionsAccept, accept);
