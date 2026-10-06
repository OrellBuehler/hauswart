/// <reference types="bun" />

import type {
  SessionInfo,
  SessionUser,
  TokenInfo,
} from "$lib/server/auth/types";

declare global {
  namespace App {
    interface Locals {
      /** Set by the hook for a valid session cookie or bearer token. */
      user: SessionUser | null;
      /** Present when the caller authenticated with the session cookie. */
      session: SessionInfo | null;
      /** Present when the caller authenticated with an API token. */
      token: TokenInfo | null;
    }
  }
}

export {};
