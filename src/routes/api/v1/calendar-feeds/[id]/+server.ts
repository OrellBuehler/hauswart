import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { remove, update } from "#lib/server/api/handlers/calendarFeeds.ts";

export const PATCH = bind(endpoints.calendarFeedsUpdate, update);
export const DELETE = bind(endpoints.calendarFeedsDelete, remove);
