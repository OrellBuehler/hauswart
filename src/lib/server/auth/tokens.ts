import { and, desc, eq, isNull, lte, or } from "drizzle-orm";
import type { TokenKind } from "$lib/api/enums";
import { isScope, type Scope } from "$lib/api/scopes";
import { apiTokens, getDB, users } from "$lib/server/db";
import { hashToken } from "./sessions";
import type { SessionUser, TokenInfo } from "./types";

export const TOKEN_PREFIX = "hw_";
/** `hw_` + 32 random bytes as base64url (43 characters). */
export const TOKEN_PATTERN = /^hw_[A-Za-z0-9_-]{43}$/;
export const DISPLAY_PREFIX_LENGTH = 8;
export const LAST_USED_THROTTLE_MS = 60_000;
export const MOBILE_TOKEN_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;

export interface TokenRecord {
  id: string;
  kind: TokenKind;
  name: string;
  prefix: string;
  scopes: Scope[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface NewToken {
  kind: TokenKind;
  name: string;
  scopes: readonly Scope[];
  expiresAt?: Date | null;
}

export function generateTokenPlaintext(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `${TOKEN_PREFIX}${Buffer.from(bytes).toString("base64url")}`;
}

function cleanScopes(scopes: readonly unknown[]): Scope[] {
  return scopes.filter((s): s is Scope => typeof s === "string" && isScope(s));
}

const recordColumns = {
  id: apiTokens.id,
  kind: apiTokens.kind,
  name: apiTokens.name,
  prefix: apiTokens.prefix,
  scopes: apiTokens.scopes,
  lastUsedAt: apiTokens.lastUsedAt,
  expiresAt: apiTokens.expiresAt,
  createdAt: apiTokens.createdAt,
};

/** Creates a token. The plaintext is returned once and never stored. */
export function createToken(
  userId: string,
  input: NewToken,
): { token: string; record: TokenRecord } {
  const token = generateTokenPlaintext();
  const row = getDB()
    .insert(apiTokens)
    .values({
      userId,
      kind: input.kind,
      name: input.name,
      tokenHash: hashToken(token),
      prefix: token.slice(0, DISPLAY_PREFIX_LENGTH),
      scopes: [...input.scopes],
      expiresAt: input.expiresAt ?? null,
    })
    .returning(recordColumns)
    .get();
  return { token, record: { ...row, scopes: cleanScopes(row.scopes) } };
}

export interface VerifiedToken {
  user: SessionUser;
  token: TokenInfo;
}

/**
 * Resolves a plaintext bearer token to its owner. Revoked and expired tokens
 * do not verify. `lastUsedAt` is refreshed at most once a minute so hot
 * clients do not turn every request into a write.
 */
export function verifyToken(
  plaintext: string,
  now: number = Date.now(),
): VerifiedToken | null {
  if (!TOKEN_PATTERN.test(plaintext)) return null;
  const db = getDB();
  const row = db
    .select({
      tokenId: apiTokens.id,
      kind: apiTokens.kind,
      scopes: apiTokens.scopes,
      expiresAt: apiTokens.expiresAt,
      revokedAt: apiTokens.revokedAt,
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      locale: users.locale,
    })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(eq(apiTokens.tokenHash, hashToken(plaintext)))
    .get();
  if (!row || row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= now) return null;

  db.update(apiTokens)
    .set({ lastUsedAt: new Date(now) })
    .where(
      and(
        eq(apiTokens.id, row.tokenId),
        or(
          isNull(apiTokens.lastUsedAt),
          lte(apiTokens.lastUsedAt, new Date(now - LAST_USED_THROTTLE_MS)),
        ),
      ),
    )
    .run();

  return {
    user: {
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      role: row.role,
      locale: row.locale,
    },
    token: { id: row.tokenId, kind: row.kind, scopes: cleanScopes(row.scopes) },
  };
}

/** The user's own tokens that have not been revoked, newest first. */
export function listTokens(userId: string): TokenRecord[] {
  return getDB()
    .select(recordColumns)
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt), desc(apiTokens.id))
    .all()
    .map((r) => ({ ...r, scopes: cleanScopes(r.scopes) }));
}

/** Revokes one of the user's own tokens. False when it does not exist, is not theirs or is already revoked. */
export function revokeToken(
  userId: string,
  id: string,
  now: number = Date.now(),
): boolean {
  const revoked = getDB()
    .update(apiTokens)
    .set({ revokedAt: new Date(now) })
    .where(
      and(
        eq(apiTokens.id, id),
        eq(apiTokens.userId, userId),
        isNull(apiTokens.revokedAt),
      ),
    )
    .returning({ id: apiTokens.id })
    .all();
  return revoked.length > 0;
}

/** Revokes all of a user's live tokens, optionally only one kind. Returns how many. */
export function revokeUserTokens(
  userId: string,
  kind?: TokenKind,
  now: number = Date.now(),
): number {
  return getDB()
    .update(apiTokens)
    .set({ revokedAt: new Date(now) })
    .where(
      and(
        eq(apiTokens.userId, userId),
        isNull(apiTokens.revokedAt),
        kind ? eq(apiTokens.kind, kind) : undefined,
      ),
    )
    .returning({ id: apiTokens.id })
    .all().length;
}
