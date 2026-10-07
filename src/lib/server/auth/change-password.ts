import { and, eq, ne } from "drizzle-orm";
import { sessions, users } from "$lib/server/db";
import { invalidField, type ServiceContext } from "$lib/server/service";
import { logAuthEvent, logPasswordChangeFailed } from "./events";
import { hashPassword, verifyPassword } from "./password";
import { loginRateLimiter, type LoginRateLimiter } from "./rate-limit";
import { AuthError } from "./types";

export interface PasswordChange {
  userId: string;
  currentPassword: string;
  newPassword: string;
  /** The session making the change; it is the only one of the user that survives. */
  keepSessionId: string;
  /** Client address, for the failed-attempt budget (see `clientKey`). */
  clientKey: string;
}

/**
 * A person changing their own password. The current password must be right; a wrong one counts
 * against the same failure budget as sign-in (`loginRateLimiter`, throws `RateLimitedError` when
 * spent) and is a field error on `currentPassword`. On success every other session of the user
 * ends. API tokens stay valid: the person created them on purpose and can revoke them on their
 * own, whereas an administrator's reset (`updateUser`) revokes them because the account may have
 * been taken over.
 *
 * The stored hash is replaced only if it is still the one the current password was checked
 * against, so a reset by an administrator (or a second change) that lands in between is not
 * silently overwritten.
 */
export async function changePassword(
  ctx: ServiceContext,
  input: PasswordChange,
  limiter: LoginRateLimiter = loginRateLimiter,
): Promise<void> {
  const row = ctx.db
    .select({
      id: users.id,
      username: users.username,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.id, input.userId))
    .get();
  if (!row) throw new AuthError("user_not_found", "User not found.");

  // Reserved before any await so parallel guesses are counted immediately.
  const release = limiter.acquireOrThrow(row.username, input.clientKey);

  if (!(await verifyPassword(input.currentPassword, row.passwordHash))) {
    logPasswordChangeFailed(row.id);
    throw wrongCurrentPassword();
  }
  release();

  const passwordHash = await hashPassword(input.newPassword);
  const changed = ctx.db.transaction(
    (tx) => {
      const updated = tx
        .update(users)
        .set({ passwordHash })
        .where(
          and(eq(users.id, row.id), eq(users.passwordHash, row.passwordHash)),
        )
        .returning({ id: users.id })
        .get();
      if (!updated) return false;
      tx.delete(sessions)
        .where(
          and(
            eq(sessions.userId, row.id),
            ne(sessions.id, input.keepSessionId),
          ),
        )
        .run();
      return true;
    },
    { behavior: "immediate" },
  );
  if (!changed) throw wrongCurrentPassword();

  logAuthEvent("password_changed", row.id);
}

function wrongCurrentPassword() {
  return invalidField("currentPassword", "The current password is wrong.");
}
