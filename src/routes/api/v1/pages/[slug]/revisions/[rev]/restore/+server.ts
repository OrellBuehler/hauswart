import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { restore } from "#lib/server/api/handlers/pages.ts";

export const POST = bind(endpoints.pageRevisionsRestore, restore);
