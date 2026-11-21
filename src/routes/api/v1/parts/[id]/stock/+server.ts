import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { stock } from "#lib/server/api/handlers/parts.ts";

export const POST = bind(endpoints.partsStock, stock);
