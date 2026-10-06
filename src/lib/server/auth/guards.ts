import { ApiError } from "$lib/api/errors";
import { effectiveScopes, missingScopes, type Scope } from "$lib/api/scopes";
import type { AuthLocals, Principal } from "./types";

/** The principal the hook resolved into `locals`, or null for anonymous callers. */
export function resolvePrincipal(
  locals: Partial<AuthLocals>,
): Principal | null {
  const { user, token, session } = locals;
  if (!user) return null;
  if (token) {
    return {
      auth: "token",
      user,
      token,
      scopes: effectiveScopes(user.role, token.scopes),
    };
  }
  if (session) {
    return {
      auth: "session",
      user,
      session,
      scopes: effectiveScopes(user.role),
    };
  }
  return null;
}

export function requirePrincipal(principal: Principal | null): Principal {
  if (!principal) {
    throw new ApiError("unauthenticated", "Authentication required");
  }
  return principal;
}

export function requireScopes(
  principal: Principal,
  required: readonly Scope[],
): void {
  const missing = missingScopes(principal.scopes, required);
  if (missing.length > 0) {
    throw new ApiError("forbidden", "Insufficient scope", {
      details: { missingScopes: missing },
    });
  }
}

export function requireAdmin(principal: Principal): void {
  requireScopes(principal, ["admin"]);
}
