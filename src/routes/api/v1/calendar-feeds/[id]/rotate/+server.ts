import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { rotate } from "$lib/server/api/handlers/calendarFeeds";

export const POST = bind(endpoints.calendarFeedsRotate, rotate);
