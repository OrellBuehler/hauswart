import { isHttpError } from "@sveltejs/kit";
import { ApiError, type ErrorCode } from "$lib/api/errors";
import { RateLimitedError } from "$lib/server/auth/rate-limit";
import { AuthError } from "$lib/server/auth/types";
import { MarkdownError } from "$lib/server/docs/markdown-core";
import { FileError, type FileErrorCode } from "$lib/server/files/errors";

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
  410: "gone",
  429: "rate_limited",
};

const FILE_ERROR_STATUS: Record<FileErrorCode, number> = {
  empty: 400,
  too_large: 413,
  unsupported_type: 415,
  unsupported_heic: 415,
  corrupt_image: 400,
  image_too_large: 413,
  invalid_path: 404,
};

const FILE_ERROR_MESSAGES: Record<FileErrorCode, string> = {
  empty: "The file is empty",
  too_large: "The file is too large",
  unsupported_type: "This file type is not supported",
  unsupported_heic: "HEIC images are not supported; send JPEG, PNG or WebP",
  corrupt_image: "The image is damaged or cannot be read",
  image_too_large: "The image has too many pixels",
  invalid_path: "File not found",
};

function fileApiError(err: FileError): ApiError {
  const status = FILE_ERROR_STATUS[err.code];
  if (err.code === "invalid_path") {
    return new ApiError("not_found", FILE_ERROR_MESSAGES[err.code]);
  }
  return new ApiError("invalid_request", FILE_ERROR_MESSAGES[err.code], {
    status,
    details: { code: err.code },
  });
}

function markdownApiError(err: MarkdownError): ApiError {
  if (err.code === "unavailable") {
    return new ApiError(
      "internal",
      "The markdown renderer is busy, try again",
      {
        status: 503,
        details: { code: err.code },
      },
    );
  }
  return new ApiError(
    "invalid_request",
    err.code === "too_large"
      ? "The markdown is too large"
      : "The markdown is too complex to render",
    { details: { code: err.code } },
  );
}

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
  if (err instanceof FileError) return fileApiError(err);
  if (err instanceof MarkdownError) return markdownApiError(err);
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
