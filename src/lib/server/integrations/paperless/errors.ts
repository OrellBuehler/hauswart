import {
  HTTP_ERROR_CODES,
  errorCodeOf,
  httpMessage,
  withDetail,
  type FailOptions,
  type HttpErrorCode,
} from "../http";

export const PAPERLESS_ERROR_CODES = [
  ...HTTP_ERROR_CODES,
  "version",
  "wrong_type",
  "invalid_input",
] as const;
export type PaperlessErrorCode = (typeof PAPERLESS_ERROR_CODES)[number];

const SERVICE = "Paperless";

function messageFor(code: PaperlessErrorCode): string {
  switch (code) {
    case "version":
      return "The Paperless API version is not supported. Paperless-ngx 2.16 or newer is required.";
    case "wrong_type":
      return "Paperless sent a file of an unexpected type.";
    case "invalid_input":
      return "The request to Paperless was not valid.";
    default:
      return httpMessage(SERVICE, code as HttpErrorCode);
  }
}

/** Typed failure of a Paperless call. Messages never contain response bodies, tokens or document content. */
export class PaperlessError extends Error {
  override name = "PaperlessError";
  readonly code: PaperlessErrorCode;
  readonly status?: number;

  constructor(code: PaperlessErrorCode, options: FailOptions = {}) {
    super(
      withDetail(messageFor(code), options.detail),
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.code = code;
    this.status = options.status;
  }
}

export const paperlessFail = (
  code: PaperlessErrorCode,
  options?: FailOptions,
): PaperlessError => new PaperlessError(code, options);

/** A user-presentable line for a stored or returned error code. */
export function messageForCode(code: string): string {
  return (PAPERLESS_ERROR_CODES as readonly string[]).includes(code)
    ? messageFor(code as PaperlessErrorCode)
    : "An unexpected error occurred.";
}

/** A user-presentable line for any error thrown by the adapter. */
export function describeError(err: unknown): string {
  if (err instanceof PaperlessError) return err.message;
  console.error("paperless: unexpected error", errorCodeOf(err));
  return "An unexpected error occurred.";
}

/** Short machine-readable code for storage and logs. */
export function errorCode(err: unknown): string {
  return err instanceof PaperlessError ? err.code : errorCodeOf(err);
}
