import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { setup, setupStatus } from "#lib/server/api/handlers/auth.ts";

export const GET = bind(endpoints.setupStatus, setupStatus);
export const POST = bind(endpoints.setup, setup);
