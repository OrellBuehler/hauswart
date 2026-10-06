export const USER_ROLES = ["admin", "member"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_LOCALES = ["de", "en"] as const;
export type UserLocale = (typeof USER_LOCALES)[number];

export const TOKEN_KINDS = ["mobile", "integration", "ha", "mcp"] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

export const ASSET_KINDS = ["device", "plant", "fixture", "other"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

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
] as const;
export type NotificationTitleKey = (typeof NOTIFICATION_TITLE_KEYS)[number];
