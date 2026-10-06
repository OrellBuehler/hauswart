import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
  ASSET_KINDS,
  ASSIGN_MODES,
  COMPLETION_KINDS,
  COMPLETION_SOURCES,
  DUE_KINDS,
  DUE_STATUSES,
  NOTIFICATION_KINDS,
  NOTIFICATION_TITLE_KEYS,
  NOTIFY_MODES,
  PREPARATION_KINDS,
  ROTATION_STRATEGIES,
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  TASK_SOURCES,
  TOKEN_KINDS,
  USER_LOCALES,
  USER_ROLES,
} from "$lib/api/enums";
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

export const HOUSEHOLD_ID = "household";

/** The one household; a singleton row created on first use. */
export const household = sqliteTable("household", {
  id: text("id").primaryKey().default(HOUSEHOLD_ID),
  name: text("name").notNull().default("Haushalt"),
  timezone: text("timezone").notNull(),
  currency: text("currency").notNull().default("CHF"),
  /** Date the keys were handed over (`YYYY-MM-DD`). */
  handoverDate: text("handover_date"),
  /** Validated by `householdSettingsSchema` on read and write. */
  settings: text("settings", { mode: "json" })
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'`),
  ...timestamps,
});

export const rooms = sqliteTable("rooms", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  haAreaId: text("ha_area_id"),
  icon: text("icon"),
  sortOrder: integer("sort_order").notNull().default(0),
  notes: text("notes"),
  ...timestamps,
});

export const assets = sqliteTable(
  "assets",
  {
    id: id(),
    kind: text("kind", { enum: ASSET_KINDS }).notNull().default("device"),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    /** 10 random base32 characters for the QR code; unguessable, separate from `slug`. */
    qrSlug: text("qr_slug").notNull().unique(),
    roomId: text("room_id").references(() => rooms.id, {
      onDelete: "set null",
    }),
    category: text("category"),
    manufacturer: text("manufacturer"),
    model: text("model"),
    serialNumber: text("serial_number"),
    purchaseDate: text("purchase_date"),
    installedDate: text("installed_date"),
    warrantyUntil: text("warranty_until"),
    warrantyExtendedUntil: text("warranty_extended_until"),
    showOnEmergency: integer("show_on_emergency", { mode: "boolean" })
      .notNull()
      .default(false),
    notes: text("notes"),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
    species: text("species"),
    light: text("light"),
    waterNotes: text("water_notes"),
    /** Attachments arrive with the documents milestone; no foreign key yet. */
    photoAttachmentId: text("photo_attachment_id"),
    ...timestamps,
  },
  (t) => [
    index("assets_room_id_idx").on(t.roomId),
    index("assets_kind_idx").on(t.kind),
  ],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: id(),
    title: text("title").notNull(),
    descriptionMd: text("description_md").notNull().default(""),
    category: text("category", { enum: TASK_CATEGORIES })
      .notNull()
      .default("other"),
    priority: text("priority", { enum: TASK_PRIORITIES })
      .notNull()
      .default("normal"),
    effortMinutes: integer("effort_minutes"),
    assetId: text("asset_id").references(() => assets.id, {
      onDelete: "set null",
    }),
    roomId: text("room_id").references(() => rooms.id, {
      onDelete: "set null",
    }),
    /** Validated by the engine's `triggerSchema` on read and write. */
    trigger: text("trigger", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    assignMode: text("assign_mode", { enum: ASSIGN_MODES })
      .notNull()
      .default("none"),
    assigneeUserId: text("assignee_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    rotationOrder: text("rotation_order", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    rotationStrategy: text("rotation_strategy", { enum: ROTATION_STRATEGIES })
      .notNull()
      .default("alternate"),
    notifyMode: text("notify_mode", { enum: NOTIFY_MODES })
      .notNull()
      .default("assignee"),
    graceDays: integer("grace_days").notNull().default(0),
    /** Falls back to the household setting when null. */
    dueSoonDays: integer("due_soon_days"),
    /** `YYYY-MM-DD`: hidden from "due" lists while today is before it. */
    snoozedUntil: text("snoozed_until"),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
    source: text("source", { enum: TASK_SOURCES }).notNull().default("manual"),
    externalSource: text("external_source"),
    externalRef: text("external_ref"),
    externalUrl: text("external_url"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [
    index("tasks_asset_id_idx").on(t.assetId),
    index("tasks_room_id_idx").on(t.roomId),
    index("tasks_archived_at_idx").on(t.archivedAt),
    uniqueIndex("tasks_external_idx").on(t.externalSource, t.externalRef),
  ],
);

/** The engine's last verdict per task. A cache: `evaluateAll` rebuilds it from tasks and completions. */
export const taskState = sqliteTable(
  "task_state",
  {
    taskId: text("task_id")
      .primaryKey()
      .references(() => tasks.id, { onDelete: "cascade" }),
    status: text("status", { enum: DUE_STATUSES }).notNull(),
    dueDate: text("due_date"),
    dueKind: text("due_kind", { enum: DUE_KINDS }).notNull(),
    occurrenceKey: text("occurrence_key").notNull(),
    windowStart: text("window_start"),
    progressJson: text("progress_json", { mode: "json" }).$type<{
      current: number;
      target: number;
      unit?: string;
    }>(),
    estimateJson: text("estimate_json", { mode: "json" }).$type<{
      date: string;
      confidence: "low" | "medium";
    }>(),
    missedCount: integer("missed_count").notNull().default(0),
    reasonsJson: text("reasons_json", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    currentAssigneeUserId: text("current_assignee_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    counterBaseline: real("counter_baseline"),
    activeSince: integer("active_since"),
    dueSince: integer("due_since"),
    evaluatedAt: integer("evaluated_at", { mode: "timestamp_ms" }).notNull(),
    ...timestamps,
  },
  (t) => [
    index("task_state_status_idx").on(t.status),
    index("task_state_due_date_idx").on(t.dueDate),
  ],
);

export const taskCompletions = sqliteTable(
  "task_completions",
  {
    id: id(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }).notNull(),
    /** `completedAt` as a date in the household time zone. */
    completedDate: text("completed_date").notNull(),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    source: text("source", { enum: COMPLETION_SOURCES }).notNull(),
    kind: text("kind", { enum: COMPLETION_KINDS }).notNull().default("done"),
    counterValue: real("counter_value"),
    occurrenceKey: text("occurrence_key"),
    dueDateAtCompletion: text("due_date_at_completion"),
    note: text("note"),
    idempotencyKey: text("idempotency_key").unique(),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    revokedBy: text("revoked_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [
    index("task_completions_task_idx").on(t.taskId, sql`${t.completedAt} desc`),
    index("task_completions_completed_at_idx").on(sql`${t.completedAt} desc`),
  ],
);

export const taskPreparations = sqliteTable(
  "task_preparations",
  {
    id: id(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    kind: text("kind", { enum: PREPARATION_KINDS })
      .notNull()
      .default("generic"),
    /** Days before the due date the preparation becomes relevant. */
    leadDays: integer("lead_days"),
    /** Alternative lead: relevant while a signal matches (validated by `leadValueSchema`). */
    leadValue: text("lead_value", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
    /** Spare parts arrive with a later milestone; no foreign key yet. */
    partId: text("part_id"),
    qty: integer("qty").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("task_preparations_task_id_idx").on(t.taskId)],
);

export const taskPrepCompletions = sqliteTable(
  "task_prep_completions",
  {
    id: id(),
    prepId: text("prep_id")
      .notNull()
      .references(() => taskPreparations.id, { onDelete: "cascade" }),
    occurrenceKey: text("occurrence_key").notNull(),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("task_prep_completions_unique").on(t.prepId, t.occurrenceKey),
  ],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: id(),
    /** Null = the whole household (read state is then shared). */
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: NOTIFICATION_KINDS }).notNull(),
    taskId: text("task_id").references(() => tasks.id, {
      onDelete: "cascade",
    }),
    dedupeKey: text("dedupe_key").notNull().unique(),
    /** Paraglide message key plus its parameters: the reader's locale renders the text. */
    titleKey: text("title_key", { enum: NOTIFICATION_TITLE_KEYS }).notNull(),
    paramsJson: text("params_json", { mode: "json" })
      .$type<Record<string, string | number>>()
      .notNull()
      .default(sql`'{}'`),
    url: text("url"),
    readAt: integer("read_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (t) => [
    index("notifications_user_idx").on(t.userId, t.readAt),
    index("notifications_created_at_idx").on(sql`${t.createdAt} desc`),
  ],
);
