import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { list } from "#lib/server/api/handlers/documents.ts";

export const GET = bind(endpoints.documentsList, list);
