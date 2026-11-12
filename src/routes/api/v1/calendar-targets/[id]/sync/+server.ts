import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { sync } from "#lib/server/api/handlers/calendarTargets.ts";

export const POST = bind(endpoints.calendarTargetsSync, sync);
