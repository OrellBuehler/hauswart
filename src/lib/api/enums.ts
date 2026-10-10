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

/**
 * Where an odometer reading came from. `fuel_log`, `tire_change` and `signal` are written by
 * features that build on `recordOdometer`; the first three exist today.
 */
export const ODOMETER_SOURCES = [
  "manual",
  "completion",
  "service_log",
  "fuel_log",
  "tire_change",
  "signal",
] as const;
export type OdometerSource = (typeof ODOMETER_SOURCES)[number];

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
  "taxes_fees",
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
  taxes_fees: true,
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
] as const;
export type CostSource = (typeof COST_SOURCES)[number];

/** `tasks.externalSource` of the tasks that follow a bill in a finance system. */
export const FINANCE_BILL_TASK_SOURCE = "finance_bill";

export const FINANCE_SUGGESTION_KINDS = ["cost", "bill_task", "asset"] as const;
export type FinanceSuggestionKind = (typeof FINANCE_SUGGESTION_KINDS)[number];

export const FINANCE_SUGGESTION_STATUSES = [
  "pending",
  "accepted",
  "dismissed",
] as const;
export type FinanceSuggestionStatus =
  (typeof FINANCE_SUGGESTION_STATUSES)[number];

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
