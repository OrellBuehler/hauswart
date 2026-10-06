import {
  HTTP_ERROR_CODES,
  errorCodeOf,
  httpMessage,
  withDetail,
  type FailOptions,
  type HttpErrorCode,
} from "../http";

export const HA_ERROR_CODES = [...HTTP_ERROR_CODES, "invalid_input"] as const;
export type HomeAssistantErrorCode = (typeof HA_ERROR_CODES)[number];

const SERVICE = "Home Assistant";

function messageFor(code: HomeAssistantErrorCode): string {
  return code === "invalid_input"
    ? "The request to Home Assistant was not valid."
    : httpMessage(SERVICE, code as HttpErrorCode);
}

/** Typed failure of a Home Assistant call. Messages never contain response bodies, tokens or entity states. */
export class HomeAssistantError extends Error {
  override name = "HomeAssistantError";
  readonly code: HomeAssistantErrorCode;
  readonly status?: number;

  constructor(code: HomeAssistantErrorCode, options: FailOptions = {}) {
    super(
      withDetail(messageFor(code), options.detail),
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.code = code;
    this.status = options.status;
  }
}

export const haFail = (
  code: HomeAssistantErrorCode,
  options?: FailOptions,
): HomeAssistantError => new HomeAssistantError(code, options);

/** A user-presentable line for a stored or returned error code. */
export function messageForCode(code: string): string {
  return (HA_ERROR_CODES as readonly string[]).includes(code)
    ? messageFor(code as HomeAssistantErrorCode)
    : "An unexpected error occurred.";
}

/** A user-presentable line for any error thrown by the adapter. */
export function describeError(err: unknown): string {
  if (err instanceof HomeAssistantError) return err.message;
  console.error("homeassistant: unexpected error", errorCodeOf(err));
  return "An unexpected error occurred.";
}

/** Short machine-readable code for storage and logs. */
export function errorCode(err: unknown): string {
  return err instanceof HomeAssistantError ? err.code : errorCodeOf(err);
}
