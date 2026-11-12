import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { dismiss } from "#lib/server/api/handlers/finance.ts";

export const POST = bind(endpoints.financeSuggestionsDismiss, dismiss);
