import { isApiError, type ErrorCode } from "$lib/api/errors";
import { m } from "$lib/paraglide/messages";

/**
 * A user-facing, localized message for a failed API call. `overrides` lets a
 * caller give a stable code a more specific meaning (e.g. `conflict` on user
 * creation means the username is taken).
 */
export function apiErrorMessage(
  err: unknown,
  overrides: Partial<Record<ErrorCode, string>> = {},
): string {
  if (!isApiError(err)) return m.error_generic();
  const override = overrides[err.code];
  if (override) return override;
  switch (err.code) {
    case "invalid_credentials":
      return m.error_invalid_credentials();
    case "rate_limited":
      return m.error_rate_limited();
    case "setup_complete":
      return m.error_setup_complete();
    case "csrf_failed":
      return m.error_csrf_failed();
    case "invalid_request":
      return m.error_invalid_request();
    case "unauthenticated":
    case "setup_required":
      return m.error_unauthenticated();
    case "forbidden":
      return m.error_forbidden();
    case "not_found":
      return m.error_not_found();
    case "conflict":
      return m.error_conflict();
    case "gone":
      return m.error_gone();
    case "upstream_error":
      return m.error_upstream();
    case "internal":
      return m.error_generic();
  }
}
