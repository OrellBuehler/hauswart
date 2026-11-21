import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { complete } from "#lib/server/api/handlers/preparations.ts";

export const POST = bind(endpoints.preparationsComplete, complete);
