import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { tread } from "$lib/server/api/handlers/tireSets";

export const POST = bind(endpoints.tireSetsTread, tread);
