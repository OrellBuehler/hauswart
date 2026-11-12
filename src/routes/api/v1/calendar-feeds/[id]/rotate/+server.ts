import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { rotate } from "#lib/server/api/handlers/calendarFeeds.ts";

export const POST = bind(endpoints.calendarFeedsRotate, rotate);
