import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { remove, update } from "#lib/server/api/handlers/calendarTargets.ts";

export const PATCH = bind(endpoints.calendarTargetsUpdate, update);
export const DELETE = bind(endpoints.calendarTargetsDelete, remove);
