import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { dismiss } from "$lib/server/api/handlers/finance";

export const POST = bind(endpoints.financeSuggestionsDismiss, dismiss);
