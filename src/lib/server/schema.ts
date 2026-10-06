import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { Minor } from "$lib/money";

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

export const USER_ROLES = ["admin", "member"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_LOCALES = ["de", "en"] as const;
export type UserLocale = (typeof USER_LOCALES)[number];

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
  "totp_enabled",
  "totp_disabled",
  "recovery_codes_regenerated",
  "recovery_code_used",
  "passkey_added",
  "passkey_removed",
  "two_factor_reset",
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
