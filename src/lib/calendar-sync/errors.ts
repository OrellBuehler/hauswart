import type { CalendarProviderKind } from "$lib/api/enums";
import { isApiError } from "$lib/api/errors";
import { pickerErrorMessage } from "$lib/connections/errors";
import { apiErrorMessage } from "$lib/error-message";
import { m } from "$lib/paraglide/messages";
import { providerName } from "./providers";

/** What a refused save says: a sentence for the whole form and/or a sentence per field. */
export type SaveFailure = {
  form: string | undefined;
  fields: Record<string, string>;
};

type FieldErrors = Record<string, unknown>;

function fieldErrorsOf(
  err: unknown,
  source: "body" | "query",
): FieldErrors | undefined {
  if (!isApiError(err) || err.code !== "invalid_request") return undefined;
  const part = (err.details as Record<string, unknown> | undefined)?.[source];
  const fields = (part as { fieldErrors?: unknown } | undefined)?.fieldErrors;
  return fields !== null && typeof fields === "object"
    ? (fields as FieldErrors)
    : undefined;
}

/**
 * The failure of adding or changing a calendar target, in the person's language. The server says
 * which calendar field it refuses (`remoteCalendarId`: not there, or it takes no new events), that
 * the calendar already has a target (409), that the household's calendars are administrators'
 * business (403), that there is no working connection (404) or what the connected system answered
 * (502 with its code).
 */
export function saveFailure(
  err: unknown,
  provider: CalendarProviderKind,
): SaveFailure {
  const fields: Record<string, string> = {};
  const rejected = fieldErrorsOf(err, "body");
  if (rejected) {
    for (const field of Object.keys(rejected)) {
      fields[field] =
        field === "remoteCalendarId"
          ? m.caltargets_error_calendar_unusable()
          : m.field_invalid();
    }
    // The settings are one field for the server; the form has no single control to mark for it.
    const config = "config" in rejected;
    delete fields.config;
    if (config && Object.keys(fields).length === 0) {
      return { form: m.caltargets_error_config(), fields };
    }
    return { form: m.form_check_fields(), fields };
  }
  if (isApiError(err)) {
    switch (err.code) {
      case "conflict":
        return {
          form: undefined,
          fields: { remoteCalendarId: m.caltargets_error_calendar_taken() },
        };
      case "forbidden":
        return { form: m.caltargets_error_forbidden(), fields };
      case "not_found":
        return {
          form: m.caltargets_error_no_connection({
            provider: providerName(provider),
          }),
          fields,
        };
      case "upstream_error":
        return { form: pickerErrorMessage(err, provider), fields };
    }
  }
  return { form: apiErrorMessage(err), fields };
}

type RemovalDetails = {
  code?: unknown;
  deleted?: unknown;
  remaining?: unknown;
  disabled?: unknown;
};

const removalDetails = (err: unknown): RemovalDetails | undefined =>
  isApiError(err) ? (err.details as RemovalDetails | undefined) : undefined;

/** Whether a failed removal left the target switched off (it stopped after it had begun to delete events). */
export function removalPausedTarget(err: unknown): boolean {
  return (
    isApiError(err) &&
    err.code === "upstream_error" &&
    removalDetails(err)?.disabled === true
  );
}

/**
 * The failure of removing a target. With the events removed as well the server may stop half way:
 * the target stays, switched off so nothing is written again, and a second try goes on from there.
 */
export function deleteFailure(
  err: unknown,
  provider: CalendarProviderKind,
): string {
  const refused = fieldErrorsOf(err, "query");
  if (refused && "removeRemote" in refused) {
    return m.caltargets_error_remove_unsupported();
  }
  if (isApiError(err)) {
    switch (err.code) {
      case "conflict":
        return removalDetails(err)?.code === "busy"
          ? m.caltargets_error_remove_busy()
          : m.caltargets_error_remove_offline();
      case "forbidden":
        return m.caltargets_error_forbidden();
      case "not_found":
        return m.caltargets_error_gone();
      case "upstream_error": {
        const details = removalDetails(err);
        if (
          typeof details?.deleted === "number" &&
          typeof details.remaining === "number"
        ) {
          if (details.code === "too_many") {
            return m.caltargets_error_remove_partial({
              deleted: details.deleted,
              remaining: details.remaining,
            });
          }
          if (details.disabled === true) {
            return m.caltargets_error_remove_paused({
              reason: pickerErrorMessage(err, provider),
              deleted: details.deleted,
              remaining: details.remaining,
            });
          }
        }
        return m.caltargets_error_remove_failed({
          reason: pickerErrorMessage(err, provider),
        });
      }
    }
  }
  return apiErrorMessage(err);
}
