import { createHash } from "node:crypto";
import { signValue, verifySignature } from "$lib/server/crypto";
import { verifyPassword } from "$lib/server/auth/password";
import { guestPinRateLimiter } from "$lib/server/auth/rate-limit";
import type { ServiceContext } from "$lib/server/service";
import {
  addPinFailure,
  clearPinFailures,
  findGuestLinkByToken,
  isPinLocked,
  linkStatus,
  type GuestLinkRow,
} from "./guest-links";
import { GUEST_PIN_PATTERN } from "$lib/api/schemas/share";

type Now = Pick<ServiceContext, "db" | "now">;

export const GUEST_COOKIE = "hauswart_guest";
export const GUEST_COOKIE_TTL_MS = 12 * 60 * 60 * 1000;
const PURPOSE = "guest-pin";

/**
 * What the token opens:
 * - `unknown`: no such link (a guess, or a link long deleted),
 * - `gone`: revoked, expired, not yet valid or closed by too many wrong PINs; callers show the
 *   same page as for `unknown`, so nobody learns which it was,
 * - `locked`: the PIN is still to be entered,
 * - `ok`: open.
 */
export type GuestAccess =
  | { state: "unknown" }
  | { state: "gone" }
  | { state: "locked" | "ok"; link: GuestLinkRow };

function fingerprint(row: GuestLinkRow): string {
  return createHash("sha256")
    .update(row.pinHash ?? "")
    .digest("hex")
    .slice(0, 16);
}

const messageOf = (row: GuestLinkRow, expires: number) =>
  `${row.id}|${fingerprint(row)}|${expires}`;

/**
 * The cookie that remembers a correct PIN: expiry plus an HMAC over link id, a fingerprint of the
 * PIN hash and the expiry. Setting a new PIN (or removing it) therefore ends every unlock.
 */
export function pinCookie(
  row: GuestLinkRow,
  now: number,
): { value: string; expires: Date } {
  const expires = Math.min(now + GUEST_COOKIE_TTL_MS, row.expiresAt.getTime());
  return {
    value: `${expires}.${signValue(PURPOSE, messageOf(row, expires))}`,
    expires: new Date(expires),
  };
}

export function hasPinAccess(
  row: GuestLinkRow,
  cookie: string | undefined,
  now: number,
): boolean {
  if (!cookie) return false;
  const dot = cookie.indexOf(".");
  if (dot < 1) return false;
  const expires = Number(cookie.slice(0, dot));
  if (!Number.isSafeInteger(expires) || expires <= now) return false;
  return verifySignature(
    PURPOSE,
    messageOf(row, expires),
    cookie.slice(dot + 1),
  );
}

export function resolveGuestAccess(
  ctx: Now,
  token: string,
  cookie: string | undefined,
): GuestAccess {
  const link = findGuestLinkByToken(ctx, token);
  if (!link) return { state: "unknown" };
  if (linkStatus(link, ctx.now) !== "active") return { state: "gone" };
  if (!link.pinHash) return { state: "ok", link };
  if (isPinLocked(link)) return { state: "gone" };
  return hasPinAccess(link, cookie, ctx.now)
    ? { state: "ok", link }
    : { state: "locked", link };
}

export type PinAttempt =
  | { result: "ok"; cookie: { value: string; expires: Date } }
  | { result: "wrong" }
  | { result: "limited"; retryAfterSeconds: number };

/**
 * One PIN guess. The attempt is reserved before the (slow) hash check, so parallel guesses cannot
 * slip past the limits; a correct PIN refunds it. Wrong guesses also count against the link's
 * lifetime budget (`MAX_PIN_FAILURES`).
 */
export async function attemptPin(
  ctx: Now,
  link: GuestLinkRow,
  pin: string,
  ip: string,
): Promise<PinAttempt> {
  const slot = guestPinRateLimiter.acquire(link.id, ip);
  if (!slot.allowed) {
    return {
      result: "limited",
      retryAfterSeconds: Math.max(1, Math.ceil(slot.retryAfterMs / 1000)),
    };
  }
  const correct =
    link.pinHash !== null &&
    GUEST_PIN_PATTERN.test(pin) &&
    (await verifyPassword(pin, link.pinHash));
  if (!correct) {
    addPinFailure(ctx, link.id);
    return { result: "wrong" };
  }
  slot.release();
  clearPinFailures(ctx, link);
  return { result: "ok", cookie: pinCookie(link, ctx.now) };
}
