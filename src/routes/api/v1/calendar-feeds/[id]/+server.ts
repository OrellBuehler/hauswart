import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { remove, update } from "$lib/server/api/handlers/calendarFeeds";

export const PATCH = bind(endpoints.calendarFeedsUpdate, update);
export const DELETE = bind(endpoints.calendarFeedsDelete, remove);
