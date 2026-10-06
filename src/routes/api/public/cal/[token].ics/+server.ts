import type { RequestHandler } from "./$types";
import { serveCalendarFeed } from "$lib/server/calendar/public";

export const GET: RequestHandler = (event) =>
  serveCalendarFeed(event, event.params.token);
