import { endpoints } from "$lib/api/registry";
import { api } from "$lib/api/browser";
import type { UserLocale } from "$lib/api/enums";
import { setLocale } from "$lib/paraglide/runtime";

/**
 * Switches the UI language by reloading the page. The server already sets the
 * locale cookie when the account is updated, which makes Paraglide's own
 * reload a no-op, so reload explicitly.
 */
export async function applyLocale(locale: UserLocale): Promise<void> {
  await setLocale(locale, { reload: false });
  window.location.reload();
}

/** Saves the language on the account, then switches the UI. */
export async function saveLocale(locale: UserLocale): Promise<void> {
  await api.call(endpoints.authUpdateMe, { body: { locale } });
  await applyLocale(locale);
}
