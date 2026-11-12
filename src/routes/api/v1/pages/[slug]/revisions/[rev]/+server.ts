import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { revision } from "#lib/server/api/handlers/pages.ts";

export const GET = bind(endpoints.pageRevisionsGet, revision);
