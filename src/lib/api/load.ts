import { error, redirect } from "@sveltejs/kit";
import { isApiError } from "./errors";
import { apiErrorMessage } from "$lib/error-message";

/**
 * Awaits a client call inside a `load` function: an expired session goes to
 * the login page, any other API failure becomes a SvelteKit error that the
 * nearest `+error.svelte` renders with a localized message.
 */
export async function orFail<T>(
  call: Promise<T>,
  loginRedirectTo?: string,
): Promise<T> {
  try {
    return await call;
  } catch (err) {
    if (!isApiError(err)) throw err;
    if (err.status === 401) {
      const target = loginRedirectTo
        ? `/login?redirectTo=${encodeURIComponent(loginRedirectTo)}`
        : "/login";
      redirect(303, target);
    }
    error(err.status, apiErrorMessage(err));
  }
}
