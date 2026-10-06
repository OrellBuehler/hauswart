import { createHash, timingSafeEqual } from "node:crypto";
import { ApiError } from "$lib/api/errors";
import type { endpoints } from "$lib/api/registry";
import { MOBILE_TOKEN_SCOPES } from "$lib/api/scopes";
import { toIso } from "$lib/api/schemas/common";
import { setupToken } from "$lib/server/config";
import { logAuthEvent } from "$lib/server/auth/events";
import { setLocaleCookie } from "$lib/server/auth/locale";
import { AuthError } from "$lib/server/auth/types";
import {
  authenticate,
  clientKey,
  verifyCredentials,
} from "$lib/server/auth/login";
import {
  MOBILE_TOKEN_LIFETIME_MS,
  createToken,
  revokeToken,
} from "$lib/server/auth/tokens";
import {
  createSession,
  deleteSessionCookie,
  invalidateSession,
  setSessionCookie,
} from "$lib/server/auth/sessions";
import {
  countUsers,
  createFirstAdmin,
  updateProfile,
} from "$lib/server/users/users";
import type { Handler } from "../bind";
import { wireUser } from "../wire";

export const setupStatus: Handler<typeof endpoints.setupStatus> = () => {
  const needsSetup = countUsers() === 0;
  return { needsSetup, tokenRequired: needsSetup && setupToken() !== null };
};

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function checkSetupToken(supplied: string | undefined): void {
  const expected = setupToken();
  if (expected === null) return;
  if (!timingSafeEqual(digest(supplied ?? ""), digest(expected))) {
    throw new ApiError("forbidden", "Invalid setup token");
  }
}

export const setup: Handler<typeof endpoints.setup> = async ({
  body,
  event,
}) => {
  if (countUsers() > 0) {
    throw new AuthError("setup_closed", "Setup has already been completed.");
  }
  checkSetupToken(body.setupToken);
  const created = await createFirstAdmin(body);
  logAuthEvent("setup_completed", created.id);
  const { token, session } = createSession(created.id);
  setSessionCookie(event.cookies, token, session.expiresAt);
  setLocaleCookie(event.cookies, created.locale);
  return { user: wireUser(created) };
};

export const login: Handler<typeof endpoints.authLogin> = async ({
  ctx,
  body,
  event,
}) => {
  const result = await authenticate(
    body.username,
    body.password,
    clientKey(event.getClientAddress),
  );
  if (!result) {
    throw new ApiError("invalid_credentials", "Invalid username or password");
  }
  // A new login replaces whatever session this browser had.
  if (ctx.principal?.auth === "session") {
    invalidateSession(ctx.principal.session.id);
  }
  setSessionCookie(event.cookies, result.token, result.session.expiresAt);
  setLocaleCookie(event.cookies, result.user.locale);
  return { user: wireUser(result.user) };
};

export const logout: Handler<typeof endpoints.authLogout> = ({
  ctx,
  event,
}) => {
  if (ctx.principal.auth === "session")
    invalidateSession(ctx.principal.session.id);
  deleteSessionCookie(event.cookies);
  return null;
};

export const me: Handler<typeof endpoints.authMe> = ({ ctx }) => ({
  user: wireUser(ctx.user),
  auth: ctx.principal.auth,
  scopes: ctx.principal.scopes,
});

export const updateMe: Handler<typeof endpoints.authUpdateMe> = ({
  ctx,
  body,
  event,
}) => {
  const user = updateProfile(ctx.user.id, body);
  if (body.locale) setLocaleCookie(event.cookies, body.locale);
  return { user: wireUser(user) };
};

export const issueDeviceToken: Handler<typeof endpoints.authToken> = async ({
  ctx,
  body,
  event,
}) => {
  const user = await verifyCredentials(
    body.username,
    body.password,
    clientKey(event.getClientAddress),
  );
  if (!user) {
    throw new ApiError("invalid_credentials", "Invalid username or password");
  }
  const expiresAt = new Date(ctx.now + MOBILE_TOKEN_LIFETIME_MS);
  const name = body.platform
    ? `${body.deviceName} (${body.platform})`
    : body.deviceName;
  const { token } = createToken(user.id, {
    kind: "mobile",
    name,
    scopes: MOBILE_TOKEN_SCOPES,
    expiresAt,
  });
  logAuthEvent("token_created", user.id);
  return { token, expiresAt: toIso(expiresAt), user: wireUser(user) };
};

export const revokeCallingToken: Handler<typeof endpoints.authRevokeToken> = ({
  ctx,
}) => {
  if (ctx.principal.auth === "token") {
    revokeToken(ctx.user.id, ctx.principal.token.id, ctx.now);
    logAuthEvent("token_revoked", ctx.user.id);
  }
  return null;
};
