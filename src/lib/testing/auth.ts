import { eq } from "drizzle-orm";
import type { TokenKind, UserLocale, UserRole } from "$lib/api/enums";
import { MOBILE_TOKEN_SCOPES, type Scope } from "$lib/api/scopes";
import { getDB, users } from "$lib/server/db";
import { hashPassword } from "$lib/server/auth/password";
import { createSession } from "$lib/server/auth/sessions";
import { createToken, type TokenRecord } from "$lib/server/auth/tokens";
import type { SessionUser } from "$lib/server/auth/types";
import { createUser, toSessionUser } from "$lib/server/users/users";

export const TEST_PASSWORD = "correct-horse-battery";

let counter = 0;
let sharedHash: Promise<string> | undefined;

export interface TestUser extends SessionUser {
  password: string;
}

/**
 * Creates a real user row. Usernames are unique per call unless given. The
 * default password's hash is computed once per process, so creating many users
 * stays fast.
 */
export async function createTestUser(
  opts: {
    username?: string;
    role?: UserRole;
    password?: string;
    displayName?: string | null;
    locale?: UserLocale;
  } = {},
): Promise<TestUser> {
  const password = opts.password ?? TEST_PASSWORD;
  const username = opts.username ?? `user${++counter}`;
  if (opts.password === undefined) {
    sharedHash ??= hashPassword(TEST_PASSWORD);
    const [row] = getDB()
      .insert(users)
      .values({
        username,
        passwordHash: await sharedHash,
        role: opts.role ?? "member",
        displayName: opts.displayName ?? null,
        locale: opts.locale ?? "de",
      })
      .returning()
      .all();
    return { ...toSessionUser(row), password };
  }
  const user = await createUser({
    username,
    password,
    role: opts.role ?? "member",
    displayName: opts.displayName ?? null,
    locale: opts.locale,
  });
  return { ...toSessionUser(user), password };
}

/** A logged-in browser stand-in: real session row plus its token. */
export function loginTestUser(user: SessionUser) {
  return createSession(user.id);
}

/** A bearer token for the user; the plaintext is in `token`. Defaults to a mobile token with the device scopes. */
export function createTestToken(
  user: SessionUser,
  opts: {
    kind?: TokenKind;
    scopes?: readonly Scope[];
    name?: string;
    expiresAt?: Date | null;
  } = {},
): { token: string; record: TokenRecord } {
  return createToken(user.id, {
    kind: opts.kind ?? "mobile",
    name: opts.name ?? "test token",
    scopes: opts.scopes ?? MOBILE_TOKEN_SCOPES,
    expiresAt: opts.expiresAt,
  });
}

export function setUserRole(userId: string, role: UserRole): void {
  getDB().update(users).set({ role }).where(eq(users.id, userId)).run();
}
