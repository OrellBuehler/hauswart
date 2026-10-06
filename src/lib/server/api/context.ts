import type { AuthMode } from "$lib/api/registry";
import type { DB } from "$lib/server/db";
import type { Principal, SessionUser } from "$lib/server/auth/types";

interface BaseContext {
  db: DB;
  /** Request time, ms since epoch. */
  now: number;
  /** Today's date as `YYYY-MM-DD` in the household time zone. */
  today: string;
}

export interface AuthedContext extends BaseContext {
  user: SessionUser;
  principal: Principal;
}

/** Public endpoints may or may not have a caller. */
export interface PublicContext extends BaseContext {
  user: SessionUser | null;
  principal: Principal | null;
}

export type ContextFor<A extends AuthMode> = A extends "public"
  ? PublicContext
  : AuthedContext;
