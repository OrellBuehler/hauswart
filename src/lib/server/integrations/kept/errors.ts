import {
  HTTP_ERROR_CODES,
  errorCodeOf,
  httpMessage,
  withDetail,
  type FailOptions,
  type HttpErrorCode,
} from "../http";

export const KEPT_ERROR_CODES = [
  ...HTTP_ERROR_CODES,
  "rate_limited",
  "conflict",
  "invalid_input",
] as const;
export type KeptErrorCode = (typeof KEPT_ERROR_CODES)[number];

const SERVICE = "Kept";

export interface KeptErrorOptions extends FailOptions {
  /** Seconds the server asked us to wait (`Retry-After`), when it sent a usable value. */
  retryAfter?: number | null;
  /** The endpoint of the failed call, e.g. `GET /bills` (route template, never ids). */
  endpoint?: string;
}

function messageFor(code: KeptErrorCode, endpoint?: string): string {
  switch (code) {
    case "forbidden":
      return endpoint
        ? `The Kept token lacks the permission or category access needed for ${endpoint}.`
        : httpMessage(SERVICE, "forbidden");
    case "rate_limited":
      return "Kept is limiting requests. Try again later.";
    case "conflict":
      return "Kept refused the request because a limit was reached (at most 20 links per bill or transaction).";
    case "invalid_input":
      return "The request to Kept was not valid.";
    default:
      return httpMessage(SERVICE, code as HttpErrorCode);
  }
}

/** Typed failure of a Kept call. Messages never contain response bodies, tokens or finance data. */
export class KeptError extends Error {
  override name = "KeptError";
  readonly code: KeptErrorCode;
  readonly status?: number;
  readonly retryAfter: number | null;
  readonly endpoint?: string;

  constructor(code: KeptErrorCode, options: KeptErrorOptions = {}) {
    super(
      withDetail(messageFor(code, options.endpoint), options.detail),
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.code = code;
    this.status = options.status;
    this.retryAfter = options.retryAfter ?? null;
    this.endpoint = options.endpoint;
  }
}

export const keptFail = (
  code: KeptErrorCode,
  options?: KeptErrorOptions,
): KeptError => new KeptError(code, options);

/** A user-presentable line for a stored or returned error code. */
export function messageForCode(code: string): string {
  return (KEPT_ERROR_CODES as readonly string[]).includes(code)
    ? messageFor(code as KeptErrorCode)
    : "An unexpected error occurred.";
}

/** A user-presentable line for any error thrown by the adapter. */
export function describeError(err: unknown): string {
  if (err instanceof KeptError) return err.message;
  console.error("kept: unexpected error", errorCodeOf(err));
  return "An unexpected error occurred.";
}

/** Short machine-readable code for storage and logs. */
export function errorCode(err: unknown): string {
  return err instanceof KeptError ? err.code : errorCodeOf(err);
}
