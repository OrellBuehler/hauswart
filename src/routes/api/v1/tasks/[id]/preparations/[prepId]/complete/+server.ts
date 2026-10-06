import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { complete } from "$lib/server/api/handlers/preparations";

export const POST = bind(endpoints.preparationsComplete, complete);
