import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { health } from "$lib/server/api/handlers/system";

export const GET = bind(endpoints.health, health);
