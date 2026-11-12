import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { status } from "#lib/server/api/handlers/defects.ts";

export const POST = bind(endpoints.defectsStatus, status);
