import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { sync } from "$lib/server/api/handlers/finance";

export const POST = bind(endpoints.financeSync, sync);
