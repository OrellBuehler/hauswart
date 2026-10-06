import type { Cookies } from "@sveltejs/kit";
import type { UserLocale } from "$lib/api/enums";
import { cookieMaxAge, cookieName } from "$lib/paraglide/runtime";
import { cookieSecureOverride } from "./sessions";

/** Keeps the Paraglide locale cookie in step with the account's stored language. */
export function setLocaleCookie(cookies: Cookies, locale: UserLocale): void {
  cookies.set(cookieName, locale, {
    path: "/",
    maxAge: cookieMaxAge,
    sameSite: "lax",
    httpOnly: false,
    ...cookieSecureOverride(),
  });
}
