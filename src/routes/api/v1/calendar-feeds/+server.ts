import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { create, list } from "$lib/server/api/handlers/calendarFeeds";

export const GET = bind(endpoints.calendarFeedsList, list);
export const POST = bind(endpoints.calendarFeedsCreate, create);
