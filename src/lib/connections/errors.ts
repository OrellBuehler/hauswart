import { isApiError } from "$lib/api/errors";
import type { IntegrationKind } from "$lib/api/enums";
import { apiErrorMessage } from "$lib/error-message";
import { m } from "$lib/paraglide/messages";

type Messages = Record<string, () => string>;

const HOME_ASSISTANT: Messages = {
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

/** Paperless-ngx: the transport codes every adapter has, plus those of its own and of a push to it. */
const PAPERLESS: Messages = {
  invalid_url: () => m.integration_error_invalid_url(),
  blocked_host: () => m.integration_error_blocked_host(),
  unauthorized: () => m.integration_paperless_error_unauthorized(),
  forbidden: () => m.integration_paperless_error_forbidden(),
  not_found: () => m.integration_paperless_error_not_found(),
  bad_request: () => m.integration_paperless_error_bad_request(),
  redirect: () => m.integration_paperless_error_redirect(),
  timeout: () => m.integration_paperless_error_timeout(),
  network: () => m.integration_paperless_error_network(),
  tls: () => m.integration_paperless_error_tls(),
  server: () => m.integration_paperless_error_server(),
  invalid_response: () => m.integration_paperless_error_invalid_response(),
  too_large: () => m.integration_paperless_error_too_large(),
  invalid_input: () => m.integration_paperless_error_invalid_input(),
  version: () => m.integration_paperless_error_version(),
  wrong_type: () => m.integration_paperless_error_wrong_type(),
  duplicate: () => m.integration_paperless_error_duplicate(),
  interrupted: () => m.integration_paperless_error_interrupted(),
  file_missing: () => m.integration_paperless_error_file_missing(),
};

const BY_KIND: Partial<Record<IntegrationKind, Messages>> = {
  homeassistant: HOME_ASSISTANT,
  paperless: PAPERLESS,
};

/** A friendly, actionable sentence for the short error code an adapter stored (`unauthorized`, `tls`, ...). */
export function integrationErrorMessage(
  code: string | null,
  kind: IntegrationKind = "homeassistant",
): string {
  return (code && BY_KIND[kind]?.[code]?.()) || m.integration_error_unknown();
}

/** The message for a failed picker call: the stored adapter code when the connected system itself failed, else the generic API wording. */
export function pickerErrorMessage(
  err: unknown,
  kind: IntegrationKind = "homeassistant",
): string {
  if (isApiError(err) && err.code === "upstream_error") {
    const code = (err.details as { code?: unknown } | undefined)?.code;
    if (typeof code === "string") return integrationErrorMessage(code, kind);
  }
  return apiErrorMessage(err);
}

function hostOf(address: string): string {
  return URL.canParse(address) ? new URL(address).host : address.trim();
}

/**
 * The message for a refused save of a connection. A 403 means the server may not connect to the
 * address: for members it is not on the household's list of allowed hosts (or is a local one),
 * which the server explains in English only, so it is said here in the person's language.
 */
export function connectionSaveMessage(err: unknown, address: string): string {
  if (isApiError(err) && err.code === "forbidden") {
    return m.integration_host_forbidden({ host: hostOf(address) });
  }
  return apiErrorMessage(err);
}

/** Field errors of a refused save: the address or the token was not accepted. */
export function connectionFieldErrors(err: unknown): Record<string, string> {
  if (!isApiError(err) || err.code !== "invalid_request") return {};
  const fields =
    (
      err.details as
        { body?: { fieldErrors?: Record<string, unknown> } } | undefined
    )?.body?.fieldErrors ?? {};
  const out: Record<string, string> = {};
  if ("baseUrl" in fields) out.baseUrl = m.integration_url_rejected();
  if ("token" in fields) out.token = m.integration_token_rejected();
  return out;
}
