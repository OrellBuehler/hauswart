import { isApiError } from "$lib/api/errors";
import { m } from "$lib/paraglide/messages";

/** A user-facing, localized message for a failed API call. */
export function apiErrorMessage(err: unknown): string {
  if (!isApiError(err)) return m.error_generic();
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
    default:
      return m.error_generic();
  }
}
