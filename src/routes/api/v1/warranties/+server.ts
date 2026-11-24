import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { list } from "#lib/server/api/handlers/warranties.ts";

export const GET = bind(endpoints.warrantiesList, list);
