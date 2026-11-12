import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { accept } from "#lib/server/api/handlers/finance.ts";

export const POST = bind(endpoints.financeSuggestionsAccept, accept);
