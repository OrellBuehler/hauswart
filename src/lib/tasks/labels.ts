import type { Component } from "svelte";
import BellIcon from "@lucide/svelte/icons/bell";
import BotIcon from "@lucide/svelte/icons/bot";
import CloudIcon from "@lucide/svelte/icons/cloud";
import CogIcon from "@lucide/svelte/icons/cog";
import HouseWifiIcon from "@lucide/svelte/icons/house-wifi";
import ReceiptIcon from "@lucide/svelte/icons/receipt";
import QrCodeIcon from "@lucide/svelte/icons/qr-code";
import UserIcon from "@lucide/svelte/icons/user";
import type {
  AssignMode,
  CompletionSource,
  NotifyMode,
  PreparationKind,
  RotationStrategy,
  TaskCategory,
  TaskPriority,
} from "$lib/api/enums";
import { m } from "$lib/paraglide/messages";
import type { DueStatus, Reason } from "./engine/types";

export const categoryLabels: Record<TaskCategory, () => string> = {
  cleaning: () => m.category_cleaning(),
  maintenance: () => m.category_maintenance(),
  filter: () => m.category_filter(),
  plant: () => m.category_plant(),
  waste: () => m.category_waste(),
  inspection: () => m.category_inspection(),
  payment: () => m.category_payment(),
  order: () => m.category_order(),
  warranty: () => m.category_warranty(),
  defect: () => m.category_defect(),
  other: () => m.category_other(),
};

export const priorityLabels: Record<TaskPriority, () => string> = {
  low: () => m.priority_low(),
  normal: () => m.priority_normal(),
  high: () => m.priority_high(),
};

export const statusLabels: Record<DueStatus, () => string> = {
  ok: () => m.status_ok(),
  open: () => m.status_open(),
  due: () => m.status_due(),
  overdue: () => m.status_overdue(),
  snoozed: () => m.status_snoozed(),
  unknown: () => m.status_unknown(),
};

export const assignModeLabels: Record<AssignMode, () => string> = {
  none: () => m.assign_mode_none(),
  fixed: () => m.assign_mode_fixed(),
  rotate: () => m.assign_mode_rotate(),
};

export const rotationLabels: Record<RotationStrategy, () => string> = {
  alternate: () => m.rotation_alternate(),
  fair: () => m.rotation_fair(),
};

export const rotationHints: Record<RotationStrategy, () => string> = {
  alternate: () => m.rotation_alternate_hint(),
  fair: () => m.rotation_fair_hint(),
};

export const notifyModeLabels: Record<NotifyMode, () => string> = {
  assignee: () => m.notify_assignee(),
  all: () => m.notify_all(),
};

export const preparationKindLabels: Record<PreparationKind, () => string> = {
  generic: () => m.prep_kind_generic(),
  order_part: () => m.prep_kind_order_part(),
};

export const preparationStateLabels: Record<
  "not_yet" | "now" | "done" | "in_stock_skip",
  () => string
> = {
  not_yet: () => m.prep_state_not_yet(),
  now: () => m.prep_state_now(),
  done: () => m.prep_state_done(),
  in_stock_skip: () => m.prep_state_in_stock_skip(),
};

export const sourceLabels: Record<CompletionSource, () => string> = {
  manual: () => m.source_manual(),
  qr: () => m.source_qr(),
  api: () => m.source_api(),
  mcp: () => m.source_mcp(),
  ha: () => m.source_ha(),
  notification: () => m.source_notification(),
  kept: () => m.source_kept(),
  system: () => m.source_system(),
};

export const sourceIcons: Record<CompletionSource, Component> = {
  manual: UserIcon,
  qr: QrCodeIcon,
  api: CloudIcon,
  mcp: BotIcon,
  ha: HouseWifiIcon,
  notification: BellIcon,
  kept: ReceiptIcon,
  system: CogIcon,
};

export const reasonLabels: Record<Reason, () => string> = {
  never_completed: () => m.reason_never_completed(),
  completed: () => m.reason_completed(),
  skipped: () => m.reason_skipped(),
  snoozed: () => m.reason_snoozed(),
  seasonal_boundary: () => m.reason_seasonal_boundary(),
  missed_occurrences: () => m.reason_missed_occurrences(),
  period_satisfied: () => m.reason_period_satisfied(),
  missed_previous_period: () => m.reason_missed_previous_period(),
  signal_missing: () => m.reason_signal_missing(),
  signal_stale: () => m.reason_signal_stale(),
  signal_unavailable: () => m.reason_signal_unavailable(),
  baseline_missing: () => m.reason_baseline_missing(),
  counter_reset: () => m.reason_counter_reset(),
  condition_pending: () => m.reason_condition_pending(),
  condition_active: () => m.reason_condition_active(),
  acknowledged: () => m.reason_acknowledged(),
  estimate_from_history: () => m.reason_estimate_from_history(),
  no_upcoming_events: () => m.reason_no_upcoming_events(),
  no_occurrences: () => m.reason_no_occurrences(),
  bill_cancelled: () => m.reason_bill_cancelled(),
  bill_overdue: () => m.reason_bill_overdue(),
  warranty_expired: () => m.reason_warranty_expired(),
  expired_archive: () => m.reason_expired_archive(),
};
