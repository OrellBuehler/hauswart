import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { create, list } from "#lib/server/api/handlers/calendarFeeds.ts";

export const GET = bind(endpoints.calendarFeedsList, list);
export const POST = bind(endpoints.calendarFeedsCreate, create);
