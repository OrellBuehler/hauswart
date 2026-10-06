import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { get } from "$lib/server/api/handlers/emergency";

export const GET = bind(endpoints.emergencyGet, get);
