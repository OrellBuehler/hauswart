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

/** Client address for rate limiting; a fixed shared key if the adapter cannot provide one. */
export function clientKey(getClientAddress: () => string): string {
  try {
    return getClientAddress();
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

  if (!row || !ok) return null;

  release();
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
