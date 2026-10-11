import { startCalendarSyncScheduler, type SchedulerOptions } from "./scheduler";

/**
 * Starts the calendar sync at startup: it keeps every calendar target current (see the scheduler).
 * Inert until somebody adds a target, and until an adapter registers the provider the target
 * names. Returns a function that stops it.
 */
export function registerCalendarSync(
  options: { scheduler?: SchedulerOptions } = {},
): () => void {
  return startCalendarSyncScheduler(options.scheduler);
}

export {
  registerCalendarProvider,
  getCalendarProvider,
  type CalendarCapabilities,
  type CalendarItem,
  type CalendarProvider,
  type CalendarSession,
  type ItemWhen,
  type RemoteCalendar,
  type RemoteEvent,
  type TimeRange,
} from "./provider";
export { markerLine, parseMarker, REF_DOMAIN } from "./ref";
