import type { UserRole } from "./enums";

export const SCOPES = [
  "read",
  "write",
  "docs:write",
  "costs:write",
  "ha:action",
  "admin",
] as const;
export type Scope = (typeof SCOPES)[number];

export const MOBILE_TOKEN_SCOPES: readonly Scope[] = [
  "read",
  "write",
  "docs:write",
  "costs:write",
];

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}

/** Every scope a user of this role may hold; `admin` only for administrators. */
export function scopesForRole(role: UserRole): Scope[] {
  return role === "admin" ? [...SCOPES] : SCOPES.filter((s) => s !== "admin");
}

/**
 * What a principal may actually do: the token's scopes capped by the owner's
 * current role, so demoting an admin also strips `admin` from their tokens.
 * Sessions pass `undefined` and get everything their role allows.
 */
export function effectiveScopes(
  role: UserRole,
  granted?: readonly Scope[],
): Scope[] {
  const allowed = scopesForRole(role);
  return granted ? allowed.filter((s) => granted.includes(s)) : allowed;
}

export function missingScopes(
  held: readonly Scope[],
  required: readonly Scope[],
): Scope[] {
  return required.filter((s) => !held.includes(s));
}
