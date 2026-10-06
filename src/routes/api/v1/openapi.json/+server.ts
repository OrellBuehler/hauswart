import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { openapi } from "$lib/server/api/handlers/system";

export const GET = bind(endpoints.openapi, openapi);
