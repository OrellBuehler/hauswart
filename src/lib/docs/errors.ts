import { isApiError } from "$lib/api/errors";
import { apiErrorMessage } from "$lib/error-message";
import { m } from "$lib/paraglide/messages";

export function detailsCode(err: unknown): string | undefined {
  if (!isApiError(err)) return undefined;
  const details = err.details;
  if (details && typeof details === "object" && "code" in details) {
    const code = (details as { code: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/** Messages for saving, previewing and restoring a page; everything else falls back to the generic ones. */
export function pageErrorMessage(err: unknown): string {
  switch (detailsCode(err)) {
    case "too_large":
      return m.docs_error_too_large();
    case "too_complex":
      return m.docs_error_too_complex();
    case "unavailable":
      return m.docs_error_unavailable();
  }
  if (isApiError(err) && err.status === 413) return m.docs_error_too_large();
  if (isApiError(err) && err.status === 503) return m.docs_error_unavailable();
  if (isApiError(err) && err.code === "rate_limited") {
    return m.docs_error_preview_rate_limited();
  }
  return apiErrorMessage(err, { conflict: m.docs_error_conflict() });
}

export function currentRevOf(err: unknown): number | undefined {
  if (!isApiError(err) || err.code !== "conflict") return undefined;
  const details = err.details;
  if (details && typeof details === "object" && "currentRev" in details) {
    const rev = (details as { currentRev: unknown }).currentRev;
    return typeof rev === "number" ? rev : undefined;
  }
  return undefined;
}
