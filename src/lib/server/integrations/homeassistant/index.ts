import { registerIntegration } from "$lib/server/connections/registry";
import { registerNotificationChannel } from "$lib/server/notifications/channels";
import { homeAssistantIntegration } from "./adapter";
import { createNotifyChannel } from "./channel";
import {
  startHomeAssistantScheduler,
  type SchedulerOptions,
} from "./scheduler";

/**
 * Wires the Home Assistant adapter into the app at startup: the connection
 * settings (`/integrations/homeassistant`), the `ha_notify` notification
 * channel and the polling scheduler. Everything is inert until an
 * administrator saves a connection. Returns a function that undoes it.
 */
export function registerHomeAssistant(
  options: { scheduler?: SchedulerOptions } = {},
): () => void {
  const offIntegration = registerIntegration(homeAssistantIntegration);
  const offChannel = registerNotificationChannel(createNotifyChannel());
  const stopScheduler = startHomeAssistantScheduler(options.scheduler);
  return () => {
    stopScheduler();
    offChannel();
    offIntegration();
  };
}

export { createNotifyChannel, CHANNEL_NAME } from "./channel";
export { homeAssistantIntegration } from "./adapter";
export {
  startHomeAssistantScheduler,
  type SchedulerOptions,
} from "./scheduler";
export { pollStates, syncCalendars } from "./sync";
export {
  DEFAULT_TIMEOUT_MS,
  HomeAssistantClient,
  MAX_JSON_BYTES,
  normalizeBaseUrl,
  type ClientOptions,
} from "./client";
export {
  HA_ERROR_CODES,
  HomeAssistantError,
  describeError,
  errorCode,
  messageForCode,
  type HomeAssistantErrorCode,
} from "./errors";
export {
  HaInputError,
  MAX_SUMMARY_MATCH_LENGTH,
  buildActionableNotification,
  calendarEventsToDates,
  compileSummaryMatcher,
  isUnavailableState,
  notificationActionToken,
  parseNotificationActionToken,
  parseNumericState,
  toSignal,
  type ActionableNotificationInput,
  type InterruptionLevel,
  type NotificationPayload,
  type Signal,
} from "./helpers";
export type {
  HaArea,
  HaCalendar,
  HaCalendarEvent,
  HaConfig,
  HaDevice,
  HaEntityRegistryEntry,
  HaFloor,
  HaEventTime,
  HaState,
} from "./schemas";
export {
  WS_MAX_MESSAGE_BYTES,
  WS_TIMEOUT_MS,
  haWsCommand,
  type WsOptions,
  type WsRegistryCommand,
  type WsResultMap,
} from "./ws";
