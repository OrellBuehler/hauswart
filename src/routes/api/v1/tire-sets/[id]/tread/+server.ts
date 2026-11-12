import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { tread } from "#lib/server/api/handlers/tireSets.ts";

export const POST = bind(endpoints.tireSetsTread, tread);
