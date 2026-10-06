import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { orderNow } from "$lib/server/api/handlers/parts";

export const GET = bind(endpoints.partsOrderNow, orderNow);
