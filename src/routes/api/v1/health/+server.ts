import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { health } from "#lib/server/api/handlers/system.ts";

export const GET = bind(endpoints.health, health);
