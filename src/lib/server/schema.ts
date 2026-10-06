import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
  ASSET_CONTACT_ROLES,
  ASSET_KINDS,
  ASSIGN_MODES,
  ATTACHMENT_OWNER_TYPES,
  COMMENT_ENTITY_TYPES,
  COMPLETION_KINDS,
  COMPLETION_SOURCES,
  CONTACT_KINDS,
  DEFECT_DEADLINE_SOURCES,
  DEFECT_EVENT_TYPES,
  DEFECT_SEVERITIES,
  DEFECT_STATUSES,
  DELIVERY_STATUSES,
  DOC_SECTIONS,
  DUE_KINDS,
  DUE_STATUSES,
  FEED_SCOPES,
  GUEST_SECTIONS,
  HINT_KINDS,
  INTEGRATION_KINDS,
  INTEGRATION_STATUSES,
  NOTIFICATION_KINDS,
  NOTIFICATION_TARGET_CHANNELS,
  NOTIFICATION_TITLE_KEYS,
  NOTIFY_MODES,
  PART_MOVEMENT_REASONS,
  PREPARATION_KINDS,
  ROTATION_STRATEGIES,
  SERVICE_LOG_KINDS,
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
    /** An attachment owned by this asset (checked by the service; attachments have no foreign keys). */
    photoAttachmentId: text("photo_attachment_id"),
    /** The record this asset mirrors in another system; opaque to the core. */
    externalSource: text("external_source"),
    externalRef: text("external_ref"),
    ...timestamps,
  },
  (t) => [
    index("assets_room_id_idx").on(t.roomId),
    index("assets_kind_idx").on(t.kind),
    uniqueIndex("assets_external_idx").on(t.externalSource, t.externalRef),
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

export const contacts = sqliteTable(
  "contacts",
  {
    id: id(),
    kind: text("kind", { enum: CONTACT_KINDS }).notNull().default("other"),
    name: text("name").notNull(),
    company: text("company"),
    phone: text("phone"),
    email: text("email"),
    url: text("url"),
    address: text("address"),
    notes: text("notes"),
    emergency: integer("emergency", { mode: "boolean" })
      .notNull()
      .default(false),
    guestVisible: integer("guest_visible", { mode: "boolean" })
      .notNull()
      .default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Opaque link to an external record (an adapter's id space); the core never interprets it. */
    externalSource: text("external_source"),
    externalRef: text("external_ref"),
    ...timestamps,
  },
  (t) => [
    index("contacts_kind_idx").on(t.kind),
    uniqueIndex("contacts_external_idx").on(t.externalSource, t.externalRef),
  ],
);

export const assetContacts = sqliteTable(
  "asset_contacts",
  {
    id: id(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    role: text("role", { enum: ASSET_CONTACT_ROLES }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("asset_contacts_unique").on(t.assetId, t.contactId, t.role),
    index("asset_contacts_contact_id_idx").on(t.contactId),
  ],
);

export const parts = sqliteTable(
  "parts",
  {
    id: id(),
    name: text("name").notNull(),
    partNumber: text("part_number"),
    supplier: text("supplier"),
    shopUrl: text("shop_url"),
    unitPriceMinor: minor("unit_price_minor"),
    currency: text("currency").notNull().default("CHF"),
    stockCount: integer("stock_count").notNull().default(0),
    minStock: integer("min_stock").notNull().default(0),
    reorderQty: integer("reorder_qty").notNull().default(1),
    leadTimeDays: integer("lead_time_days").notNull().default(14),
    orderedAt: integer("ordered_at", { mode: "timestamp_ms" }),
    orderedQty: integer("ordered_qty").notNull().default(0),
    notes: text("notes"),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (t) => [index("parts_archived_at_idx").on(t.archivedAt)],
);

export const assetParts = sqliteTable(
  "asset_parts",
  {
    id: id(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("asset_parts_unique").on(t.assetId, t.partId),
    index("asset_parts_part_id_idx").on(t.partId),
  ],
);

export const taskParts = sqliteTable(
  "task_parts",
  {
    id: id(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    qty: integer("qty").notNull().default(1),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("task_parts_unique").on(t.taskId, t.partId),
    index("task_parts_part_id_idx").on(t.partId),
  ],
);

export const partMovements = sqliteTable(
  "part_movements",
  {
    id: id(),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    reason: text("reason", { enum: PART_MOVEMENT_REASONS }).notNull(),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    completionId: text("completion_id").references(() => taskCompletions.id, {
      onDelete: "set null",
    }),
    note: text("note"),
    at: integer("at", { mode: "timestamp_ms" }).notNull(),
    ...timestamps,
  },
  (t) => [
    index("part_movements_part_idx").on(t.partId, sql`${t.at} desc`),
    index("part_movements_completion_id_idx").on(t.completionId),
  ],
);

export const serviceLog = sqliteTable(
  "service_log",
  {
    id: id(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    kind: text("kind", { enum: SERVICE_LOG_KINDS }).notNull(),
    title: text("title").notNull(),
    descriptionMd: text("description_md").notNull().default(""),
    contactId: text("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    completionId: text("completion_id").references(() => taskCompletions.id, {
      onDelete: "set null",
    }),
    costMinor: minor("cost_minor"),
    currency: text("currency"),
    /** Cost entries arrive with the costs milestone; no foreign key yet. */
    costEntryId: text("cost_entry_id"),
    performedBy: text("performed_by"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [
    index("service_log_asset_idx").on(t.assetId, sql`${t.date} desc`),
    index("service_log_date_idx").on(sql`${t.date} desc`),
    uniqueIndex("service_log_completion_idx").on(t.completionId),
  ],
);

export const defects = sqliteTable(
  "defects",
  {
    id: id(),
    /** Stable running number, for talking about a defect ("Mangel 3"). */
    number: integer("number").notNull().unique(),
    title: text("title").notNull(),
    descriptionMd: text("description_md").notNull().default(""),
    status: text("status", { enum: DEFECT_STATUSES }).notNull().default("open"),
    severity: text("severity", { enum: DEFECT_SEVERITIES })
      .notNull()
      .default("medium"),
    roomId: text("room_id").references(() => rooms.id, {
      onDelete: "set null",
    }),
    assetId: text("asset_id").references(() => assets.id, {
      onDelete: "set null",
    }),
    locationDetail: text("location_detail"),
    discoveredOn: text("discovered_on").notNull(),
    reportedOn: text("reported_on"),
    responsibleContactId: text("responsible_contact_id").references(
      () => contacts.id,
      { onDelete: "set null" },
    ),
    deadlineDate: text("deadline_date"),
    deadlineSource: text("deadline_source", { enum: DEFECT_DEADLINE_SOURCES })
      .notNull()
      .default("manual"),
    fixedOn: text("fixed_on"),
    resolutionMd: text("resolution_md").notNull().default(""),
    /** Cost entries arrive with the costs milestone; no foreign key yet. */
    costEntryId: text("cost_entry_id"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [
    index("defects_status_idx").on(t.status),
    index("defects_room_id_idx").on(t.roomId),
    index("defects_asset_id_idx").on(t.assetId),
    index("defects_deadline_idx").on(t.deadlineDate),
  ],
);

export const defectEvents = sqliteTable(
  "defect_events",
  {
    id: id(),
    defectId: text("defect_id")
      .notNull()
      .references(() => defects.id, { onDelete: "cascade" }),
    at: integer("at", { mode: "timestamp_ms" }).notNull(),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    type: text("type", { enum: DEFECT_EVENT_TYPES }).notNull(),
    fromStatus: text("from_status", { enum: DEFECT_STATUSES }),
    toStatus: text("to_status", { enum: DEFECT_STATUSES }),
    bodyMd: text("body_md").notNull().default(""),
    /** E.g. a linked document; opaque to the core. */
    externalRef: text("external_ref"),
    ...timestamps,
  },
  (t) => [index("defect_events_defect_idx").on(t.defectId, t.at)],
);

export const comments = sqliteTable(
  "comments",
  {
    id: id(),
    entityType: text("entity_type", { enum: COMMENT_ENTITY_TYPES }).notNull(),
    entityId: text("entity_id").notNull(),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    bodyMd: text("body_md").notNull(),
    editedAt: integer("edited_at", { mode: "timestamp_ms" }),
    /** Soft delete: the row stays so the thread keeps its order; the body is cleared. */
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (t) => [
    index("comments_entity_idx").on(t.entityType, t.entityId, t.createdAt),
  ],
);

export const assetHints = sqliteTable(
  "asset_hints",
  {
    id: id(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull().default(""),
    kind: text("kind", { enum: HINT_KINDS }).notNull().default("tip"),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    guestVisible: integer("guest_visible", { mode: "boolean" })
      .notNull()
      .default(false),
    /** A recurring task created from or linked to the hint. */
    taskId: text("task_id").references(() => tasks.id, {
      onDelete: "set null",
    }),
    /** Validated by `signalReactionSchema` on read and write; executed by an adapter. */
    reaction: text("reaction", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
    ...timestamps,
  },
  (t) => [
    index("asset_hints_asset_idx").on(t.assetId, t.sortOrder),
    index("asset_hints_task_id_idx").on(t.taskId),
  ],
);

/** Documentation pages: markdown source plus the cached renderings (see `docs/pages.ts`). */
export const docPages = sqliteTable(
  "doc_pages",
  {
    id: id(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    section: text("section", { enum: DOC_SECTIONS })
      .notNull()
      .default("general"),
    assetId: text("asset_id").references(() => assets.id, {
      onDelete: "set null",
    }),
    roomId: text("room_id").references(() => rooms.id, {
      onDelete: "set null",
    }),
    bodyMd: text("body_md").notNull().default(""),
    /** Cache: HTML for members, secrets included. */
    renderedHtmlMember: text("rendered_html_member").notNull().default(""),
    /** Cache: HTML for the guest link, secrets removed; contains the literal `{token}` placeholder. */
    renderedHtmlGuest: text("rendered_html_guest").notNull().default(""),
    /** Cache: plain text WITHOUT secret blocks; search and snippets read this. */
    plainText: text("plain_text").notNull().default(""),
    /** Cache: table of contents per audience (ids differ when a secret block hides a heading). */
    headingsJson: text("headings_json", { mode: "json" })
      .$type<{
        member: { level: number; text: string; id: string }[];
        guest: { level: number; text: string; id: string }[];
      }>()
      .notNull()
      .default(sql`'{"member":[],"guest":[]}'`),
    sortOrder: integer("sort_order").notNull().default(0),
    guestVisible: integer("guest_visible", { mode: "boolean" })
      .notNull()
      .default(false),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    /** Optimistic concurrency: starts at 1, +1 on every save. */
    rev: integer("rev").notNull().default(1),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (t) => [
    index("doc_pages_asset_id_idx").on(t.assetId),
    index("doc_pages_room_id_idx").on(t.roomId),
    index("doc_pages_section_idx").on(t.section),
  ],
);

/** The last 50 saved states of a page (pruned on save). Revision `rev` is the state after save `rev`. */
export const docPageRevisions = sqliteTable(
  "doc_page_revisions",
  {
    id: id(),
    pageId: text("page_id")
      .notNull()
      .references(() => docPages.id, { onDelete: "cascade" }),
    rev: integer("rev").notNull(),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull(),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [uniqueIndex("doc_page_revisions_page_rev").on(t.pageId, t.rev)],
);

/**
 * Uploaded files. One row = one owner (`ownerType` + `ownerId`); the same stored file (same
 * `sha256`) can back many rows. There are no foreign keys on the owner: the owner's existence is
 * checked at upload through the owner registry (`attachments/owners.ts`) and each domain removes
 * its attachments when it deletes an owner (`removeOwnedAttachments`).
 */
export const attachments = sqliteTable(
  "attachments",
  {
    id: id(),
    sha256: text("sha256").notNull(),
    /** `ab/<sha256>` relative to the files root. */
    path: text("path").notNull(),
    thumbPath: text("thumb_path"),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    width: integer("width"),
    height: integer("height"),
    /** Sanitized upload name with an extension that matches the detected type. */
    filename: text("filename").notNull(),
    caption: text("caption"),
    guestVisible: integer("guest_visible", { mode: "boolean" })
      .notNull()
      .default(false),
    ownerType: text("owner_type", { enum: ATTACHMENT_OWNER_TYPES }).notNull(),
    ownerId: text("owner_id").notNull(),
    uploadedBy: text("uploaded_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [
    index("attachments_owner_idx").on(t.ownerType, t.ownerId),
    index("attachments_sha256_idx").on(t.sha256),
  ],
);

/**
 * A link to an external system. `userId` null = the household's connection
 * (one per kind); otherwise the person's own. The token is AES-GCM encrypted
 * and never leaves the server.
 */
export const connections = sqliteTable(
  "connections",
  {
    id: id(),
    kind: text("kind", { enum: INTEGRATION_KINDS }).notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    baseUrl: text("base_url").notNull(),
    tokenEnc: text("token_enc").notNull(),
    allowInsecureTls: integer("allow_insecure_tls", { mode: "boolean" })
      .notNull()
      .default(false),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    /** Kind-specific settings, validated by the adapter. */
    configJson: text("config_json", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
    status: text("status", { enum: INTEGRATION_STATUSES })
      .notNull()
      .default("unknown"),
    /** Short machine-readable code of the last failure, never a message. */
    lastError: text("last_error"),
    lastOkAt: integer("last_ok_at", { mode: "timestamp_ms" }),
    lastCheckedAt: integer("last_checked_at", { mode: "timestamp_ms" }),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("connections_kind_user_idx").on(t.kind, t.userId),
    // NULLs are distinct in a unique index, so the household's own row needs its own.
    uniqueIndex("connections_household_kind_idx")
      .on(t.kind)
      .where(sql`${t.userId} is null`),
  ],
);

/** The latest reading of an external value, keyed by its opaque id (for example an entity id). */
export const signals = sqliteTable("signals", {
  key: text("key").primaryKey(),
  numeric: real("numeric"),
  text: text("text"),
  unit: text("unit"),
  /** When the value last changed at the source. */
  changedAt: integer("changed_at", { mode: "timestamp_ms" }).notNull(),
  /** When this application last read it. */
  seenAt: integer("seen_at", { mode: "timestamp_ms" }).notNull(),
  source: text("source").notNull(),
});

/** Numeric history of a signal: written when it changes and at least every six hours; pruned after a year. */
export const signalSamples = sqliteTable(
  "signal_samples",
  {
    key: text("key").notNull(),
    at: integer("at", { mode: "timestamp_ms" }).notNull(),
    value: real("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.at] })],
);

/** Dates of calendar events an external calendar announced, per subscription key. */
export const externalDates = sqliteTable(
  "external_dates",
  {
    key: text("key").notNull(),
    date: text("date").notNull(),
    title: text("title").notNull().default(""),
  },
  (t) => [primaryKey({ columns: [t.key, t.date, t.title] })],
);

export const REACTION_STATUSES = ["pending", "sent", "cancelled"] as const;

/** Hint reactions waiting for their delay to pass; persisted so a restart loses none. */
export const pendingReactions = sqliteTable(
  "pending_reactions",
  {
    id: id(),
    hintId: text("hint_id")
      .notNull()
      .references(() => assetHints.id, { onDelete: "cascade" }),
    entityId: text("entity_id").notNull(),
    /** `<entityId>:<changedAt>`: one reaction per hint and transition. */
    transitionKey: text("transition_key").notNull(),
    fireAt: integer("fire_at", { mode: "timestamp_ms" }).notNull(),
    status: text("status", { enum: REACTION_STATUSES })
      .notNull()
      .default("pending"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("pending_reactions_transition_idx").on(
      t.hintId,
      t.transitionKey,
    ),
    index("pending_reactions_due_idx").on(t.status, t.fireAt),
  ],
);

/** One attempt to reach one recipient through one channel; carries the one-time action token (hash only). */
export const notificationDeliveries = sqliteTable(
  "notification_deliveries",
  {
    id: id(),
    notificationId: text("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    /** The person this delivery is for. */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    /** What the channel addressed (a notify service name); empty while deferred. */
    target: text("target").notNull().default(""),
    status: text("status", { enum: DELIVERY_STATUSES }).notNull(),
    errorCode: text("error_code"),
    attempts: integer("attempts").notNull().default(1),
    /** The task occurrence the notification was about; an action only settles that one. */
    occurrenceKey: text("occurrence_key"),
    /** Last attempt. */
    sentAt: integer("sent_at", { mode: "timestamp_ms" }).notNull(),
    actionTokenHash: text("action_token_hash"),
    actionExpiresAt: integer("action_expires_at", { mode: "timestamp_ms" }),
    actionUsedAt: integer("action_used_at", { mode: "timestamp_ms" }),
    /** The completion the token produced, so a repeated tap can answer with it. */
    actionCompletionId: text("action_completion_id"),
    ...timestamps,
  },
  (t) => [
    index("notification_deliveries_notification_idx").on(t.notificationId),
    index("notification_deliveries_token_idx").on(t.actionTokenHash),
    index("notification_deliveries_status_idx").on(t.status, t.sentAt),
  ],
);

/** Where a person wants outward notifications to go (one row per phone or speaker). */
export const notificationTargets = sqliteTable(
  "notification_targets",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: NOTIFICATION_TARGET_CHANNELS }).notNull(),
    /** For `ha_notify`: the notify service name, e.g. `mobile_app_example_phone`. */
    target: text("target").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("notification_targets_unique").on(
      t.userId,
      t.channel,
      t.target,
    ),
  ],
);

export const notificationPrefs = sqliteTable("notification_prefs", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  pushEnabled: integer("push_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  /** `HH:MM` in the household time zone; both null = no quiet hours. */
  quietStart: text("quiet_start"),
  quietEnd: text("quiet_end"),
  pushStages: text("push_stages", { mode: "json" }).$type<string[]>().notNull(),
  ...timestamps,
});

/**
 * Calendar subscription addresses (`/api/public/cal/<token>.ics`). The token's sha256 finds the
 * feed; `tokenEnc` (AES-GCM) lets the owner see the address again. A revoked feed keeps its row
 * (and its hash, so the address stays dead) until the purge removes it.
 */
export const icalFeeds = sqliteTable(
  "ical_feeds",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    tokenEnc: text("token_enc").notNull(),
    scope: text("scope", { enum: FEED_SCOPES }).notNull().default("mine"),
    includeEstimated: integer("include_estimated", { mode: "boolean" })
      .notNull()
      .default(false),
    includePreparations: integer("include_preparations", { mode: "boolean" })
      .notNull()
      .default(true),
    includeDefects: integer("include_defects", { mode: "boolean" })
      .notNull()
      .default(true),
    includeWarranties: integer("include_warranties", { mode: "boolean" })
      .notNull()
      .default(true),
    /** `HH:MM` in the household time zone; null = no alarm. */
    alarmTime: text("alarm_time"),
    /** Days before the event the alarm rings (0 = the day itself, 1 = the evening before). */
    alarmDaysBefore: integer("alarm_days_before").notNull().default(0),
    locale: text("locale", { enum: USER_LOCALES }).notNull().default("de"),
    lastFetchedAt: integer("last_fetched_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (t) => [index("ical_feeds_user_id_idx").on(t.userId)],
);

/**
 * Links for guests (house sitters, neighbours): `/g/<token>`. Only the token's sha256 is stored;
 * the address is shown once. `sectionsJson` is `{sections, pageIds}` (see `share/guest-links.ts`).
 */
export const guestLinks = sqliteTable(
  "guest_links",
  {
    id: id(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    label: text("label").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    startsAt: integer("starts_at", { mode: "timestamp_ms" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    /** Argon2 hash of the 4 to 8 digit PIN; null = no PIN. */
    pinHash: text("pin_hash"),
    /** Consecutive wrong PINs; the link closes at `MAX_PIN_FAILURES` until the PIN is set again. */
    pinFailures: integer("pin_failures").notNull().default(0),
    includeSecrets: integer("include_secrets", { mode: "boolean" })
      .notNull()
      .default(false),
    sectionsJson: text("sections_json", { mode: "json" })
      .$type<{
        sections: (typeof GUEST_SECTIONS)[number][];
        pageIds: string[];
      }>()
      .notNull(),
    locale: text("locale", { enum: USER_LOCALES }).notNull().default("de"),
    lastViewedAt: integer("last_viewed_at", { mode: "timestamp_ms" }),
    viewCount: integer("view_count").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("guest_links_expires_at_idx").on(t.expiresAt)],
);
