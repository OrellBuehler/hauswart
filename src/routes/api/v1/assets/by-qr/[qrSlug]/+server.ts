import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { byQr } from "$lib/server/api/handlers/assets";

export const GET = bind(endpoints.assetsByQr, byQr);
