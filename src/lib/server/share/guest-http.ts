import {
  error,
  fail,
  redirect,
  type ActionFailure,
  type RequestEvent,
} from "@sveltejs/kit";
import { clientKey } from "$lib/server/auth/login";
import {
  shareMissLimiter,
  shareRequestLimiter,
  shareTokenLimiter,
} from "$lib/server/auth/rate-limit";
import { cookieSecureOverride } from "$lib/server/auth/sessions";
import { getDB } from "$lib/server/db";
import {
  attemptPin,
  GUEST_COOKIE,
  resolveGuestAccess,
  type GuestAccess,
} from "./guest-access";

type Open = Extract<GuestAccess, { link: unknown }>;

/** What an error page for `/g/*` tells apart; the message of the thrown error is one of these. */
export const GUEST_ERRORS = {
  gone: "gone",
  page: "page",
  rate: "rate",
} as const;

/**
 * The gate every guest request passes: per-address and per-link rate limits, then the token.
 * Unknown, revoked, expired, not-yet-valid and closed links all end in the same 404 (`gone`), so
 * the response never says which it was. Returns the open or PIN-locked link.
 */
export function guestGate(event: RequestEvent, token: string): Open {
  const ip = clientKey(event.getClientAddress);
  if (!shareRequestLimiter.hit(ip).allowed) error(429, GUEST_ERRORS.rate);
  if (!shareMissLimiter.peek(ip).allowed) error(429, GUEST_ERRORS.rate);
  const access = resolveGuestAccess(
    { db: getDB(), now: Date.now() },
    token,
    event.cookies.get(GUEST_COOKIE),
  );
  if (access.state === "unknown") {
    shareMissLimiter.hit(ip);
    error(404, GUEST_ERRORS.gone);
  }
  if (access.state === "gone") error(404, GUEST_ERRORS.gone);
  if (!shareTokenLimiter.hit(`g:${access.link.id}`).allowed) {
    error(429, GUEST_ERRORS.rate);
  }
  return access;
}

export interface PinFailure {
  error: "wrong" | "limited";
}

/** The form action behind the PIN gate: checks the PIN and, when right, remembers it in a cookie. */
export async function unlockAction(
  event: RequestEvent,
): Promise<ActionFailure<PinFailure>> {
  const token = event.params.token as string;
  const access = guestGate(event, token);
  if (access.state === "ok") redirect(303, event.url.pathname);
  const form = await event.request.formData();
  const pin = form.get("pin");
  const attempt = await attemptPin(
    { db: getDB(), now: Date.now() },
    access.link,
    typeof pin === "string" ? pin.trim() : "",
    clientKey(event.getClientAddress),
  );
  if (attempt.result === "limited") return fail(429, { error: "limited" });
  if (attempt.result === "wrong") return fail(400, { error: "wrong" });
  event.cookies.set(GUEST_COOKIE, attempt.cookie.value, {
    path: `/g/${token}`,
    httpOnly: true,
    sameSite: "lax",
    expires: attempt.cookie.expires,
    ...cookieSecureOverride(),
  });
  redirect(303, event.url.pathname);
}

const GUEST_HEADERS: Record<string, string> = {
  "x-robots-tag": "noindex, nofollow, noarchive",
  "referrer-policy": "same-origin",
};

/** Headers for every response under `/g/`: never cached, never indexed, no referrer to other sites. */
export function withGuestHeaders(response: Response): Response {
  const apply = (target: Response) => {
    for (const [name, value] of Object.entries(GUEST_HEADERS)) {
      target.headers.set(name, value);
    }
    if (!target.headers.has("cache-control")) {
      target.headers.set("cache-control", "no-store");
    }
    return target;
  };
  try {
    return apply(response);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return apply(new Response(response.body, response));
  }
}
