import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { create, list } from "#lib/server/api/handlers/calendarTargets.ts";

export const GET = bind(endpoints.calendarTargetsList, list);
export const POST = bind(endpoints.calendarTargetsCreate, create);
