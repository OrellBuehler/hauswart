export const USER_ROLES = ["admin", "member"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_LOCALES = ["de", "en"] as const;
export type UserLocale = (typeof USER_LOCALES)[number];

export const TOKEN_KINDS = ["mobile", "integration", "ha", "mcp"] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

export const ASSET_KINDS = [
  "device",
  "plant",
  "fixture",
  "vehicle",
  "other",
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const VEHICLE_FUEL_TYPES = [
  "petrol",
  "diesel",
  "electric",
  "hybrid",
  "plugin_hybrid",
  "other",
] as const;
export type VehicleFuelType = (typeof VEHICLE_FUEL_TYPES)[number];

export const ODOMETER_UNITS = ["km", "mi"] as const;
export type OdometerUnit = (typeof ODOMETER_UNITS)[number];

export const TIRE_SEASONS = ["summer", "winter", "all_season"] as const;
export type TireSeason = (typeof TIRE_SEASONS)[number];

export const TIRE_EVENT_KINDS = [
  "mounted",
  "unmounted",
  "tread_measured",
] as const;
export type TireEventKind = (typeof TIRE_EVENT_KINDS)[number];

export const FUEL_UNITS = ["l", "kWh"] as const;
export type FuelUnit = (typeof FUEL_UNITS)[number];

/**
 * Where an odometer reading came from: typed in (`manual`) or written along with another record
 * (`completion`, `service_log`, `fuel_log`, `tire_change`), which then owns it. Every value has a
 * writer today; a feature that records readings on the side (`recordOdometer`) adds its source here.
 */
export const ODOMETER_SOURCES = [
  "manual",
  "completion",
  "service_log",
  "fuel_log",
  "tire_change",
] as const;
export type OdometerSource = (typeof ODOMETER_SOURCES)[number];

/**
 * Why a reading was refused with a 400 on its value field: lower than the reading before its date, or
 * higher than the one after it. Both can be lifted with `force` (a replaced instrument cluster).
 */
export const ODOMETER_REFUSAL_CODES = [
  "lower_than_previous",
  "higher_than_next",
] as const;
export type OdometerRefusalCode = (typeof ODOMETER_REFUSAL_CODES)[number];

/**
 * Which kind of 409 a cost endpoint answers, in `error.details.code`: the idempotency key stands for another entry,
 * payment or receipt; the finance suggestion named by `financeSuggestionId` (or being accepted or dismissed) is decided
 * already; the entry is tied to a finance item already; the receipt task is not waiting any more (its `details.status`
 * says what it is). A 409 without a code (a fuel log entry owns the entry, a book still has entries, ...) is told apart
 * by its other `details`.
 */
export const COST_CONFLICT_CODES = [
  "idempotency_key_reused",
  "suggestion_decided",
  "entry_tied",
  "receipt_task_closed",
] as const;
export type CostConflictCode = (typeof COST_CONFLICT_CODES)[number];

export const TASK_CATEGORIES = [
  "cleaning",
  "maintenance",
  "filter",
  "plant",
  "waste",
  "inspection",
  "payment",
  "order",
  "warranty",
  "defect",
  "other",
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const ASSIGN_MODES = ["none", "fixed", "rotate"] as const;
export type AssignMode = (typeof ASSIGN_MODES)[number];

export const ROTATION_STRATEGIES = ["alternate", "fair"] as const;
export type RotationStrategy = (typeof ROTATION_STRATEGIES)[number];

export const NOTIFY_MODES = ["assignee", "all"] as const;
export type NotifyMode = (typeof NOTIFY_MODES)[number];

export const TASK_SOURCES = [
  "manual",
  "seed",
  "kept",
  "paperless",
  "ha",
  "mcp",
  "system",
] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

export const COMPLETION_SOURCES = [
  "manual",
  "qr",
  "api",
  "mcp",
  "ha",
  "notification",
  "kept",
  "system",
] as const;
export type CompletionSource = (typeof COMPLETION_SOURCES)[number];

export const COMPLETION_KINDS = ["done", "skipped"] as const;
export type CompletionKind = (typeof COMPLETION_KINDS)[number];

export const PREPARATION_KINDS = ["generic", "order_part"] as const;
export type PreparationKind = (typeof PREPARATION_KINDS)[number];

export const PREPARATION_STATES = [
  "not_yet",
  "now",
  "done",
  "in_stock_skip",
] as const;

export const DUE_STATUSES = [
  "ok",
  "open",
  "due",
  "overdue",
  "snoozed",
  "unknown",
] as const;

export const DUE_KINDS = [
  "exact",
  "deadline",
  "estimated",
  "condition",
  "none",
] as const;

export const DUE_REASONS = [
  "never_completed",
  "completed",
  "skipped",
  "snoozed",
  "seasonal_boundary",
  "missed_occurrences",
  "period_satisfied",
  "missed_previous_period",
  "signal_missing",
  "signal_stale",
  "signal_unavailable",
  "baseline_missing",
  "counter_reset",
  "condition_pending",
  "condition_active",
  "acknowledged",
  "estimate_from_history",
  "no_upcoming_events",
  "no_occurrences",
  "bill_cancelled",
  "bill_overdue",
  "warranty_expired",
  "expired_archive",
] as const;

export const NOTIFICATION_KINDS = [
  "prep",
  "due_soon",
  "due",
  "overdue",
  "digest",
  "info",
  "comment",
  "hint",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Paraglide message keys for notification titles; `paramsJson` carries the ICU parameters. */
export const NOTIFICATION_TITLE_KEYS = [
  "notification_prep",
  "notification_due_soon",
  "notification_due",
  "notification_due_soon_notes",
  "notification_due_notes",
  "notification_overdue",
  "notification_digest",
  "notification_info",
  "notification_comment",
  "notification_hint",
] as const;
export type NotificationTitleKey = (typeof NOTIFICATION_TITLE_KEYS)[number];

export const DOC_SECTIONS = [
  "general",
  "device",
  "room",
  "emergency",
  "rules",
  "howto",
] as const;
export type DocSection = (typeof DOC_SECTIONS)[number];

/**
 * What an attachment can hang on. `asset`, `room`, `page` and `task` exist in the core; the other
 * owners are registered by their domain with `registerAttachmentOwner` (a type nobody registered
 * is refused at upload).
 */
export const ATTACHMENT_OWNER_TYPES = [
  "asset",
  "room",
  "page",
  "task",
  "defect",
  "service_log",
  "part",
  "asset_hint",
  "contact",
  "cost",
  "insurance_policy",
  "asset_note",
  "tire_set",
  "appointment",
  "ai_task",
] as const;
export type AttachmentOwnerType = (typeof ATTACHMENT_OWNER_TYPES)[number];

export const CONTACT_KINDS = [
  "installer",
  "property_mgmt",
  "manufacturer_support",
  "emergency",
  "utility",
  "insurance",
  "neighbor",
  "seller",
  "other",
] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

export const ASSET_CONTACT_ROLES = [
  "support",
  "installer",
  "seller",
  "service",
  "other",
] as const;
export type AssetContactRole = (typeof ASSET_CONTACT_ROLES)[number];

export const PART_MOVEMENT_REASONS = ["used", "bought", "correction"] as const;
export type PartMovementReason = (typeof PART_MOVEMENT_REASONS)[number];

export const SERVICE_LOG_KINDS = [
  "maintenance",
  "repair",
  "installation",
  "inspection",
  "replacement",
  "other",
] as const;
export type ServiceLogKind = (typeof SERVICE_LOG_KINDS)[number];

export const DEFECT_STATUSES = [
  "open",
  "reported",
  "in_progress",
  "fixed",
  "rejected",
] as const;
export type DefectStatus = (typeof DEFECT_STATUSES)[number];

export const DEFECT_SEVERITIES = ["low", "medium", "high"] as const;
export type DefectSeverity = (typeof DEFECT_SEVERITIES)[number];

export const DEFECT_DEADLINE_SOURCES = ["manual", "handover"] as const;
export type DefectDeadlineSource = (typeof DEFECT_DEADLINE_SOURCES)[number];

export const DEFECT_EVENT_TYPES = [
  "created",
  "status",
  "comment",
  "correspondence",
] as const;
export type DefectEventType = (typeof DEFECT_EVENT_TYPES)[number];

/** Who set the warranty dates of an asset: a person, or a linked receipt or warranty document. */
export const WARRANTY_SOURCES = ["manual", "document"] as const;
export type WarrantySource = (typeof WARRANTY_SOURCES)[number];

/** Systems that hold the household's documents; each is also an integration kind. */
export const DOCUMENT_PROVIDERS = ["paperless"] as const;
export type DocumentProviderKind = (typeof DOCUMENT_PROVIDERS)[number];

/** What a linked document is for. */
export const DOCUMENT_LINK_ROLES = [
  "manual",
  "receipt",
  "warranty",
  "datasheet",
  "correspondence",
  "invoice",
  "policy",
  "registration",
  "other",
] as const;
export type DocumentLinkRole = (typeof DOCUMENT_LINK_ROLES)[number];

/** What a document can be linked to (a subset of the attachment owner types; the owner registry checks existence). */
export const DOCUMENT_LINK_OWNER_TYPES = [
  "asset",
  "room",
  "page",
  "task",
  "defect",
  "service_log",
  "part",
  "contact",
  "cost",
  "insurance_policy",
] as const;
export type DocumentLinkOwnerType = (typeof DOCUMENT_LINK_OWNER_TYPES)[number];

export const DOCUMENT_UPLOAD_STATUSES = [
  "queued",
  "uploading",
  "processing",
  "done",
  "failed",
] as const;
export type DocumentUploadStatus = (typeof DOCUMENT_UPLOAD_STATUSES)[number];

export const WARRANTY_STATUSES = ["valid", "expiring", "expired"] as const;
export type WarrantyStatus = (typeof WARRANTY_STATUSES)[number];

export const COMMENT_ENTITY_TYPES = [
  "task",
  "defect",
  "asset",
  "room",
  "part",
  "contact",
  "service_log",
  "asset_hint",
  "doc_page",
  "cost",
  "insurance_policy",
  "appointment",
] as const;
export type CommentEntityType = (typeof COMMENT_ENTITY_TYPES)[number];

export const HINT_KINDS = ["tip", "rule", "warning"] as const;
export type HintKind = (typeof HINT_KINDS)[number];

export const FEED_SCOPES = ["mine", "all"] as const;
export type FeedScope = (typeof FEED_SCOPES)[number];

export const GUEST_SECTIONS = [
  "emergency",
  "rules",
  "contacts",
  "devices",
  "howto",
] as const;
export type GuestSection = (typeof GUEST_SECTIONS)[number];

export const GUEST_LINK_STATUSES = [
  "active",
  "scheduled",
  "expired",
  "revoked",
] as const;
export type GuestLinkStatus = (typeof GUEST_LINK_STATUSES)[number];

/** Outward systems a household can connect; the adapters live in `server/integrations/`. */
export const INTEGRATION_KINDS = [
  "homeassistant",
  "paperless",
  "kept",
] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

/** `household`: one connection for everybody, changed by administrators. `user`: each person connects their own. */
export const INTEGRATION_LEVELS: Record<IntegrationKind, "household" | "user"> =
  { homeassistant: "household", paperless: "user", kept: "user" };

export const INTEGRATION_STATUSES = ["ok", "error", "unknown"] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

/**
 * Calendar systems hauswart can push items into. Each is also an integration kind (its connection
 * decides the level of a target); the adapters register a provider under this name.
 */
export const CALENDAR_PROVIDERS = [
  "homeassistant",
] as const satisfies readonly IntegrationKind[];
export type CalendarProviderKind = (typeof CALENDAR_PROVIDERS)[number];

/** What a calendar target can carry; the order is the order they are listed in. */
export const CALENDAR_ITEM_KINDS = [
  "appointments",
  "task_due",
  "preparations",
  "defect_deadlines",
  "insurance_deadlines",
  "warranty_ends",
] as const;
export type CalendarItemKind = (typeof CALENDAR_ITEM_KINDS)[number];

/** Only `push` (hauswart writes, the calendar is never read back) exists; `pull` and `both` would join here. */
export const CALENDAR_DIRECTIONS = ["push"] as const;
export type CalendarDirection = (typeof CALENDAR_DIRECTIONS)[number];

/** Items that only have a date (due dates, deadlines) become all-day events or events at a fixed time of day. */
export const CALENDAR_TIMED_MODES = ["all_day", "timed"] as const;
export type CalendarTimedMode = (typeof CALENDAR_TIMED_MODES)[number];

/** What to do with an item whose event somebody deleted in the calendar: write it again or leave it deleted. */
export const CALENDAR_REMOTE_DELETE_POLICIES = ["recreate", "forget"] as const;
export type CalendarRemoteDeletePolicy =
  (typeof CALENDAR_REMOTE_DELETE_POLICIES)[number];

/** Who wins when both sides changed an event. Only hauswart can today; `remote_wins` needs the pull direction. */
export const CALENDAR_CONFLICT_POLICIES = ["hauswart_wins"] as const;
export type CalendarConflictPolicy =
  (typeof CALENDAR_CONFLICT_POLICIES)[number];

/** `synced`: hauswart wrote the event. `forgotten`: it was deleted in the calendar on purpose and is not written again. */
export const CALENDAR_LINK_STATUSES = ["synced", "forgotten"] as const;
export type CalendarLinkStatus = (typeof CALENDAR_LINK_STATUSES)[number];

/** Outward delivery paths a person can address (one target per phone, speaker, ...). */
export const NOTIFICATION_TARGET_CHANNELS = ["ha_notify"] as const;
export type NotificationTargetChannel =
  (typeof NOTIFICATION_TARGET_CHANNELS)[number];

/** Notification kinds a person can choose to receive outside the app. */
export const PUSH_STAGES = [
  "prep",
  "due_soon",
  "due",
  "overdue",
  "digest",
  "hint",
  "comment",
] as const;
export type PushStage = (typeof PUSH_STAGES)[number];
export const DEFAULT_PUSH_STAGES: readonly PushStage[] = [
  "prep",
  "due_soon",
  "due",
  "overdue",
  "hint",
  "comment",
];

export const DELIVERY_STATUSES = [
  "sent",
  "failed",
  "deferred",
  "skipped",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const COST_CATEGORIES = [
  "repair",
  "utilities",
  "renewal_fund",
  "purchase",
  "mortgage_interest",
  "mortgage_principal",
  "insurance",
  "renovation",
  "maintenance",
  "fuel",
  "taxes_fees",
  "groceries",
  "household",
  "dining",
  "leisure",
  "travel",
  "health",
  "gifts",
  "transport",
  "subscriptions",
  "other",
] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

/** Whether a category counts as an expense by default; a mortgage repayment is equity, not a cost. */
export const COST_CATEGORY_COUNTS_AS_EXPENSE: Record<CostCategory, boolean> = {
  repair: true,
  utilities: true,
  renewal_fund: true,
  purchase: true,
  mortgage_interest: true,
  mortgage_principal: false,
  insurance: true,
  renovation: true,
  maintenance: true,
  fuel: true,
  taxes_fees: true,
  groceries: true,
  household: true,
  dining: true,
  leisure: true,
  travel: true,
  health: true,
  gifts: true,
  transport: true,
  subscriptions: true,
  other: true,
};

/** How a cost is divided between the household's people: by ownership share, equally, by explicit shares, or not at all. */
export const COST_SPLIT_MODES = [
  "ownership",
  "equal",
  "custom",
  "none",
] as const;
export type CostSplitMode = (typeof COST_SPLIT_MODES)[number];

/**
 * How a book splits an entry that names no split. `custom` is left out: it needs explicit shares, which a default
 * cannot carry.
 */
export const COST_BOOK_SPLIT_MODES = ["ownership", "equal", "none"] as const;
export type CostBookSplitMode = (typeof COST_BOOK_SPLIT_MODES)[number];

/** Swiss tax distinction: value-preserving (maintenance) costs are deductible, value-increasing (investment) ones are not. */
export const COST_DEDUCTIBLE = [
  "unknown",
  "maintenance",
  "investment",
  "no",
] as const;
export type CostDeductible = (typeof COST_DEDUCTIBLE)[number];

export const COST_SOURCES = [
  "manual",
  "finance_transaction",
  "finance_bill",
  "recurring",
] as const;
export type CostSource = (typeof COST_SOURCES)[number];

/** Colour keys of a cost tag; the client maps them to classes. */
export const COST_TAG_COLORS = [
  "gray",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
] as const;
export type CostTagColor = (typeof COST_TAG_COLORS)[number];

/** What a budget covers: one calendar month or one calendar year. */
export const COST_BUDGET_PERIODS = ["month", "year"] as const;
export type CostBudgetPeriod = (typeof COST_BUDGET_PERIODS)[number];

/** How often a recurring cost falls due; `interval` stretches it ("every 2 months"). */
export const COST_RECURRENCE_FREQUENCIES = [
  "monthly",
  "quarterly",
  "yearly",
] as const;
export type CostRecurrenceFrequency =
  (typeof COST_RECURRENCE_FREQUENCIES)[number];

/** Why the last attempt to book a recurring cost failed; null while it works. */
export const COST_RECURRENCE_ERRORS = ["book_archived", "failed"] as const;
export type CostRecurrenceError = (typeof COST_RECURRENCE_ERRORS)[number];

/** `tasks.externalSource` of the tasks that follow a bill in a finance system. */
export const FINANCE_BILL_TASK_SOURCE = "finance_bill";

/**
 * `link`: a transaction of the finance system that looks like a cost entry somebody booked by hand; accepting it ties the
 * entry to the transaction instead of booking a second one.
 */
export const FINANCE_SUGGESTION_KINDS = [
  "cost",
  "bill_task",
  "asset",
  "link",
] as const;
export type FinanceSuggestionKind = (typeof FINANCE_SUGGESTION_KINDS)[number];

export const FINANCE_SUGGESTION_STATUSES = [
  "pending",
  "accepted",
  "dismissed",
] as const;
export type FinanceSuggestionStatus =
  (typeof FINANCE_SUGGESTION_STATUSES)[number];

/** `open`: to be mentioned at the next appointment. `resolved`: addressed, converted to a defect or dismissed. */
export const ASSET_NOTE_STATUSES = ["open", "resolved"] as const;
export type AssetNoteStatus = (typeof ASSET_NOTE_STATUSES)[number];
/** What a list of notes can be asked for. */
export const ASSET_NOTE_STATUS_FILTERS = ["open", "resolved", "all"] as const;

/**
 * `planned`: still to come (or not yet closed). `done`: it took place. `cancelled`: it will not take
 * place. Any status can be set from any other; completing through the API also completes the task.
 */
export const APPOINTMENT_STATUSES = ["planned", "done", "cancelled"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const INSURANCE_TYPES = [
  "motor_liability",
  "motor_partial_casco",
  "motor_full_casco",
  "household",
  "personal_liability",
  "building",
  "legal",
  "travel",
  "health",
  "life",
  "other",
] as const;
export type InsuranceType = (typeof INSURANCE_TYPES)[number];

export const INSURANCE_PREMIUM_PERIODS = [
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
] as const;
export type InsurancePremiumPeriod = (typeof INSURANCE_PREMIUM_PERIODS)[number];

/** `auto`: renews by itself unless cancelled in time. `fixed`: ends on its end date, nothing to cancel. */
export const INSURANCE_RENEWALS = ["auto", "fixed"] as const;
export type InsuranceRenewal = (typeof INSURANCE_RENEWALS)[number];

/**
 * The kinds of work the receipt queue (`ai_tasks`) holds. `receipt` is the only one a client can queue today; the
 * others are named so that adding one is a change of the request schema and the tools, not of the table.
 */
export const AI_TASK_KINDS = [
  "receipt",
  "fuel_receipt",
  "service_invoice",
  "insurance_policy",
] as const;
export type AiTaskKind = (typeof AI_TASK_KINDS)[number];

/** The kinds `POST /ai-tasks` accepts. */
export const AI_TASK_QUEUEABLE_KINDS = [
  "receipt",
] as const satisfies readonly AiTaskKind[];

/** `pending`: waiting to be processed. `done`: processed, its entries are marked for review. `dismissed`: nothing to book. */
export const AI_TASK_STATUSES = ["pending", "done", "dismissed"] as const;
export type AiTaskStatus = (typeof AI_TASK_STATUSES)[number];

/** How a task was closed: by a person in the browser (`session`) or by an API token of this kind. */
export const AI_TASK_CLOSED_VIA = ["session", ...TOKEN_KINDS] as const;
export type AiTaskClosedVia = (typeof AI_TASK_CLOSED_VIA)[number];
