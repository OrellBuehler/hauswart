import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { serve } from "#lib/server/api/handlers/mcp.ts";

export const POST = bind(endpoints.mcp, serve);
