import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { TOKEN_KINDS, USER_LOCALES, USER_ROLES } from "$lib/api/enums";
import type { Scope } from "$lib/api/scopes";
import type { Minor } from "$lib/money";

export { TOKEN_KINDS, USER_LOCALES, USER_ROLES };
export type { TokenKind, UserLocale, UserRole } from "$lib/api/enums";

export const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`)
    .$onUpdate(() => new Date()),
};

export const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

export const minor = (name: string) => integer(name).$type<Minor>();

export const users = sqliteTable("users", {
  id: id(),
  username: text("username").notNull().unique(),
  displayName: text("display_name"),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: USER_ROLES }).notNull().default("member"),
  locale: text("locale", { enum: USER_LOCALES }).notNull().default("de"),
  /** Share of shared household costs this user bears, in basis points (5000 = 50%). */
  ownershipBps: integer("ownership_bps").notNull().default(5000),
  ...timestamps,
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    /** Last step-up authentication; gates sensitive changes. */
    reauthAt: integer("reauth_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const AUTH_EVENT_TYPES = [
  "setup_completed",
  "user_created",
  "role_changed",
  "password_reset",
  "token_created",
  "token_revoked",
] as const;
export type AuthEventType = (typeof AUTH_EVENT_TYPES)[number];

/** Audit trail of security-relevant changes. Never stores secrets, codes or credentials. */
export const authEvents = sqliteTable(
  "auth_events",
  {
    id: id(),
    userId: text("user_id").notNull(),
    actorId: text("actor_id").notNull(),
    type: text("type", { enum: AUTH_EVENT_TYPES }).notNull(),
    ...timestamps,
  },
  (t) => [index("auth_events_user_id_idx").on(t.userId)],
);

/**
 * Bearer credentials for the mobile app, Home Assistant, MCP and other
 * integrations. Only the sha256 of the token is stored; the plaintext is shown
 * once at creation.
 */
export const apiTokens = sqliteTable(
  "api_tokens",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: TOKEN_KINDS }).notNull(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    /** First characters of the token, for recognising it in lists. */
    prefix: text("prefix").notNull(),
    scopes: text("scopes", { mode: "json" }).$type<Scope[]>().notNull(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (t) => [index("api_tokens_user_id_idx").on(t.userId)],
);
