import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { get } from "$lib/server/api/handlers/dashboard";

export const GET = bind(endpoints.dashboard, get);
