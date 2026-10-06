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
