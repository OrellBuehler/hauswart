import { ApiError } from "$lib/api/errors";
import type { endpoints } from "$lib/api/registry";
import { logAuthEvent } from "$lib/server/auth/events";
import { requireScopes } from "$lib/server/auth/guards";
import { createToken, listTokens, revokeToken } from "$lib/server/auth/tokens";
import type { Handler } from "../bind";
import { wireToken } from "../wire";

export const list: Handler<typeof endpoints.tokensList> = ({ ctx }) => ({
  items: listTokens(ctx.user.id).map(wireToken),
  nextCursor: null,
});

export const create: Handler<typeof endpoints.tokensCreate> = ({
  ctx,
  body,
}) => {
  // A token can never carry more than its creator may do.
  requireScopes(ctx.principal, body.scopes);
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  if (expiresAt && expiresAt.getTime() <= ctx.now) {
    throw new ApiError("invalid_request", "Invalid request", {
      details: {
        body: {
          formErrors: [],
          fieldErrors: { expiresAt: ["Must be in the future"] },
        },
      },
    });
  }
  const { token, record } = createToken(ctx.user.id, {
    kind: body.kind,
    name: body.name,
    scopes: body.scopes,
    expiresAt,
  });
  logAuthEvent("token_created", ctx.user.id);
  return { ...wireToken(record), token };
};

export const revoke: Handler<typeof endpoints.tokensRevoke> = ({
  ctx,
  params,
}) => {
  if (!revokeToken(ctx.user.id, params.id, ctx.now)) {
    throw new ApiError("not_found", "Token not found");
  }
  logAuthEvent("token_revoked", ctx.user.id);
  return null;
};
