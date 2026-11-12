import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { suggestions } from "#lib/server/api/handlers/documents.ts";

export const GET = bind(endpoints.documentsSuggestions, suggestions);
