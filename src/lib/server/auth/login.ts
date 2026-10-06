import { isIP } from "node:net";
import { logLoginAttempt } from "./events";
import { loginRateLimiter, type LoginRateLimiter } from "./rate-limit";
import { verifyAgainstDummy, verifyPassword } from "./password";
import { createSession, purgeExpiredSessions } from "./sessions";
import {
  findUserById,
  findUserByUsername,
  toSessionUser,
} from "$lib/server/users/users";
import { AuthError } from "./types";
import type { SessionInfo, SessionUser } from "./types";

export { RateLimitedError } from "./rate-limit";

export interface LoginResult {
  user: SessionUser;
  token: string;
  session: SessionInfo;
}

let warnedAddress = false;

function parseIPv6(address: string): number[] | null {
  let value = address.trim().replace(/^\[|\]$/g, "");
  const zone = value.indexOf("%");
  if (zone >= 0) value = value.slice(0, zone);
  if (!value.includes(":") || isIP(value) !== 6) return null;

  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number);
    value =
      value.slice(0, tail.index) +
      ((a << 8) | b).toString(16) +
      ":" +
      ((c << 8) | d).toString(16);
  }
  const [head, rest, extra] = value.split("::");
  if (extra !== undefined) return null;
  const left = head ? head.split(":") : [];
  const right = rest ? rest.split(":") : [];
  const missing = 8 - left.length - right.length;
  if (rest === undefined ? missing !== 0 : missing < 1) return null;
  const groups = [
    ...left,
    ...Array<string>(rest === undefined ? 0 : missing).fill("0"),
    ...right,
  ];
  const numbers = groups.map((g) => parseInt(g, 16));
  return numbers.length === 8 && numbers.every((n) => n >= 0 && n <= 0xffff)
    ? numbers
    : null;
}

/**
 * Rate-limit key for a client address: IPv4-mapped IPv6 addresses become the IPv4 address and
 * other IPv6 addresses their /64 network (one subscriber can use billions of addresses in it).
 */
export function normalizeClientAddress(address: string): string {
  const groups = parseIPv6(address);
  if (!groups) return address;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")}::/64`;
}

/** Client address for rate limiting; a fixed shared key if the adapter cannot provide one. */
export function clientKey(getClientAddress: () => string): string {
  try {
    return normalizeClientAddress(getClientAddress());
  } catch {
    if (!warnedAddress) {
      warnedAddress = true;
      console.warn(
        "Could not determine the client address; rate limiting falls back to a single shared key. Check ADDRESS_HEADER / XFF_DEPTH.",
      );
    }
    return "unknown";
  }
}

/** Full login: a fresh session for a user whose credentials were already verified. */
export function issueLogin(
  userId: string,
  now: number = Date.now(),
): LoginResult {
  const row = findUserById(userId);
  if (!row) throw new AuthError("user_not_found", "User not found.");
  purgeExpiredSessions(now);
  const { token, session } = createSession(row.id, now);
  return { user: toSessionUser(row), token, session };
}

/**
 * Checks a username and password. Returns null for any credential failure
 * (unknown user and wrong password are indistinguishable and cost the same).
 * Throws RateLimitedError when blocked. `username` must already be trimmed
 * and lowercased. A future second factor slots in after this step.
 */
export async function verifyCredentials(
  username: string,
  password: string,
  ip: string,
  limiter: LoginRateLimiter = loginRateLimiter,
): Promise<SessionUser | null> {
  // Reserved before any await so parallel guesses are counted immediately.
  const release = limiter.acquireOrThrow(username, ip);

  const row = findUserByUsername(username);
  let ok = false;
  if (row) ok = await verifyPassword(password, row.passwordHash);
  else await verifyAgainstDummy(password);

  if (!row || !ok) {
    logLoginAttempt("login_failed", row?.id);
    return null;
  }

  release();
  logLoginAttempt("login_succeeded", row.id);
  return toSessionUser(row);
}

/** Credentials -> session, for the browser login. Null on bad credentials. */
export async function authenticate(
  username: string,
  password: string,
  ip: string,
  limiter: LoginRateLimiter = loginRateLimiter,
  now: number = Date.now(),
): Promise<LoginResult | null> {
  const user = await verifyCredentials(username, password, ip, limiter);
  return user ? issueLogin(user.id, now) : null;
}
