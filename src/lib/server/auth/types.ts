import type { TokenKind, UserLocale, UserRole } from "$lib/api/enums";
import type { Scope } from "$lib/api/scopes";

export interface SessionUser {
  id: string;
  username: string;
  displayName: string | null;
  role: UserRole;
  locale: UserLocale;
}

export interface SessionInfo {
  /** SHA-256 hex of the session token (never the token itself). */
  id: string;
  expiresAt: Date;
}

export interface TokenInfo {
  id: string;
  kind: TokenKind;
  /** Scopes granted at creation; the effective scopes are capped by the owner's role. */
  scopes: Scope[];
}

export type AuthLocals = {
  user: SessionUser | null;
  session: SessionInfo | null;
  token: TokenInfo | null;
};

/** Who is calling: a browser session or a bearer token, with the scopes they may use. */
export type Principal =
  | {
      auth: "session";
      user: SessionUser;
      session: SessionInfo;
      scopes: Scope[];
    }
  | { auth: "token"; user: SessionUser; token: TokenInfo; scopes: Scope[] };

export class AuthError extends Error {
  constructor(
    readonly code:
      | "username_taken"
      | "setup_closed"
      | "invalid_credentials"
      | "user_not_found"
      | "cannot_demote_last_admin",
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}
