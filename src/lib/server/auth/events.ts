import { authEvents, getDB, type AuthEventType } from "$lib/server/db";

/** Records a security event. Callers pass ids only, never secrets, codes or credentials. */
export function logAuthEvent(
  type: AuthEventType,
  userId: string,
  actorId: string = userId,
): void {
  getDB().insert(authEvents).values({ type, userId, actorId }).run();
  console.info(JSON.stringify({ event: `auth.${type}`, userId, actorId }));
}

/**
 * Logs a sign-in attempt without storing it: successes carry the user id, failures carry it
 * only when the user exists. Never pass a username, address or password.
 */
export function logLoginAttempt(
  outcome: "login_succeeded" | "login_failed",
  userId?: string,
): void {
  console.info(
    JSON.stringify({
      event: `auth.${outcome}`,
      ...(userId === undefined ? {} : { userId }),
    }),
  );
}
