import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { orderNow } from "#lib/server/api/handlers/parts.ts";

export const GET = bind(endpoints.partsOrderNow, orderNow);
