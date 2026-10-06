import { isApiError } from "$lib/api/errors";
import { apiErrorMessage } from "$lib/error-message";
import { m } from "$lib/paraglide/messages";

const MESSAGES: Record<string, () => string> = {
  invalid_url: () => m.integration_error_invalid_url(),
  blocked_host: () => m.integration_error_blocked_host(),
  unauthorized: () => m.integration_error_unauthorized(),
  forbidden: () => m.integration_error_forbidden(),
  not_found: () => m.integration_error_not_found(),
  bad_request: () => m.integration_error_bad_request(),
  redirect: () => m.integration_error_redirect(),
  timeout: () => m.integration_error_timeout(),
  network: () => m.integration_error_network(),
  tls: () => m.integration_error_tls(),
  server: () => m.integration_error_server(),
  invalid_response: () => m.integration_error_invalid_response(),
  too_large: () => m.integration_error_too_large(),
  invalid_input: () => m.integration_error_invalid_input(),
};

/** A friendly, actionable sentence for the short error code an adapter stored (`unauthorized`, `tls`, ...). */
export function integrationErrorMessage(code: string | null): string {
  return (code && MESSAGES[code]?.()) || m.integration_error_unknown();
}

/** The message for a failed picker call: the stored adapter code when the connected system itself failed, else the generic API wording. */
export function pickerErrorMessage(err: unknown): string {
  if (isApiError(err) && err.code === "upstream_error") {
    const code = (err.details as { code?: unknown } | undefined)?.code;
    if (typeof code === "string") return integrationErrorMessage(code);
  }
  return apiErrorMessage(err);
}
