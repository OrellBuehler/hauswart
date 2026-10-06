export const ERROR_CODES = [
  "unauthenticated",
  "forbidden",
  "invalid_request",
  "not_found",
  "conflict",
  "rate_limited",
  "csrf_failed",
  "setup_required",
  "setup_complete",
  "invalid_credentials",
  "internal",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Default HTTP status per code; an ApiError may carry a more specific one (413, 415, ...). */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  invalid_request: 400,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  csrf_failed: 403,
  setup_required: 401,
  setup_complete: 409,
  invalid_credentials: 401,
  internal: 500,
};

export interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return (
    typeof value === "string" &&
    (ERROR_CODES as readonly string[]).includes(value)
  );
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    options: { status?: number; details?: unknown; cause?: unknown } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "ApiError";
    this.code = code;
    this.status = options.status ?? ERROR_STATUS[code];
    this.details = options.details;
  }

  toBody(): ErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
