import type { endpoints } from "$lib/api/registry";
import { ApiError } from "$lib/api/errors";
import { logAuthEvent } from "$lib/server/auth/events";
import { revokeUserTokens } from "$lib/server/auth/tokens";
import {
  createUser,
  findUserById,
  listUsers,
  updateUser,
} from "$lib/server/users/users";
import type { Handler } from "../bind";
import { wireAdminUser } from "../wire";

export const list: Handler<typeof endpoints.usersList> = () => ({
  items: listUsers().map(wireAdminUser),
  nextCursor: null,
});

export const create: Handler<typeof endpoints.usersCreate> = async ({
  ctx,
  body,
}) => {
  const user = await createUser(body);
  logAuthEvent("user_created", user.id, ctx.user.id);
  return { user: wireAdminUser(user) };
};

export const update: Handler<typeof endpoints.usersUpdate> = async ({
  ctx,
  params,
  body,
}) => {
  const ownSession =
    params.id === ctx.user.id && ctx.principal.auth === "session"
      ? ctx.principal.session.id
      : undefined;
  const result = await updateUser(params.id, body, ownSession);
  if (result.roleChanged) logAuthEvent("role_changed", params.id, ctx.user.id);
  if (result.passwordReset)
    logAuthEvent("password_reset", params.id, ctx.user.id);
  return { user: wireAdminUser(result.user) };
};

export const revokeTokens: Handler<typeof endpoints.usersRevokeTokens> = ({
  ctx,
  params,
}) => {
  if (!findUserById(params.id))
    throw new ApiError("not_found", "User not found");
  const revoked = revokeUserTokens(params.id, undefined, ctx.now);
  if (revoked > 0) logAuthEvent("token_revoked", params.id, ctx.user.id);
  return { revoked };
};
