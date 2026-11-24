import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { get } from "#lib/server/api/handlers/emergency.ts";

export const GET = bind(endpoints.emergencyGet, get);
