import { isHttpError } from "@sveltejs/kit";
import { ApiError, type ErrorCode } from "$lib/api/errors";
import { RateLimitedError } from "$lib/server/auth/rate-limit";
import { AuthError } from "$lib/server/auth/types";

const AUTH_ERROR_CODES: Record<AuthError["code"], ErrorCode> = {
  username_taken: "conflict",
  setup_closed: "setup_complete",
  invalid_credentials: "invalid_credentials",
  user_not_found: "not_found",
  cannot_demote_last_admin: "conflict",
};

const STATUS_ERROR_CODES: Record<number, ErrorCode> = {
  401: "unauthenticated",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  429: "rate_limited",
};

export function rateLimitedError(retryAfterMs: number): ApiError {
  return new ApiError("rate_limited", "Too many requests, slow down.", {
    details: { retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) },
  });
}

/** Maps what services and SvelteKit throw to the API error model; null for anything unexpected. */
export function toApiError(err: unknown): ApiError | null {
  if (err instanceof ApiError) return err;
  if (err instanceof RateLimitedError) {
    return new ApiError("rate_limited", err.message, {
      details: { retryAfterSeconds: err.retryAfterSeconds },
    });
  }
  if (err instanceof AuthError) {
    return new ApiError(AUTH_ERROR_CODES[err.code], err.message);
  }
  if (isHttpError(err) && err.status < 500) {
    return new ApiError(
      STATUS_ERROR_CODES[err.status] ?? "invalid_request",
      err.body.message,
      { status: err.status },
    );
  }
  return null;
}
