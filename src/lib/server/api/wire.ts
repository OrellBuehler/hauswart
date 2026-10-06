import type { z } from "zod";
import { toIso } from "$lib/api/schemas/common";
import type { userSchema } from "$lib/api/schemas/auth";
import type { adminUserSchema } from "$lib/api/schemas/users";
import type { apiTokenSchema } from "$lib/api/schemas/tokens";
import type { SessionUser } from "$lib/server/auth/types";
import type { TokenRecord } from "$lib/server/auth/tokens";
import type { UserRecord } from "$lib/server/users/users";

/** Explicit field lists: a row never reaches the wire by accident (password hashes, token hashes). */
export function wireUser(user: SessionUser): z.input<typeof userSchema> {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    locale: user.locale,
  };
}

export function wireAdminUser(
  user: UserRecord,
): z.input<typeof adminUserSchema> {
  return {
    ...wireUser(user),
    ownershipBps: user.ownershipBps,
    createdAt: toIso(user.createdAt),
  };
}

export function wireToken(token: TokenRecord): z.input<typeof apiTokenSchema> {
  return {
    id: token.id,
    kind: token.kind,
    name: token.name,
    prefix: token.prefix,
    scopes: token.scopes,
    lastUsedAt: token.lastUsedAt ? toIso(token.lastUsedAt) : null,
    expiresAt: token.expiresAt ? toIso(token.expiresAt) : null,
    createdAt: toIso(token.createdAt),
  };
}
