import { isApiError } from "#lib/api/errors.ts";
import { detailsCode } from "#lib/docs/errors.ts";
import { apiErrorMessage } from "#lib/error-message.ts";
import { m } from "#lib/paraglide/messages.js";

/** Messages for the refusals of the upload endpoint (400/413/415 with a `details.code`). */
export function uploadErrorMessage(err: unknown): string {
  switch (detailsCode(err)) {
    case "empty":
      return m.attach_error_empty();
    case "too_large":
      return m.attach_error_too_large();
    case "unsupported_type":
      return m.attach_error_unsupported_type();
    case "unsupported_heic":
      return m.attach_error_heic();
    case "corrupt_image":
      return m.attach_error_corrupt();
    case "image_too_large":
      return m.attach_error_image_too_large();
  }
  if (isApiError(err) && err.status === 0) return m.attach_error_network();
  if (isApiError(err) && err.status === 413) return m.attach_error_too_large();
  if (isApiError(err) && err.status === 415) {
    return m.attach_error_unsupported_type();
  }
  return apiErrorMessage(err);
}
