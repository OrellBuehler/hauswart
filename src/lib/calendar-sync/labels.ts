import type {
  CalendarItemKind,
  CalendarRemoteDeletePolicy,
  CalendarTimedMode,
} from "$lib/api/enums";
import type { CalendarTargetCapabilities } from "$lib/api/schemas/calendar-sync";
import { m } from "$lib/paraglide/messages";

export const calendarKindLabels: Record<CalendarItemKind, () => string> = {
  appointments: () => m.caltargets_kind_appointments(),
  task_due: () => m.caltargets_kind_task_due(),
  preparations: () => m.caltargets_kind_preparations(),
  defect_deadlines: () => m.caltargets_kind_defect_deadlines(),
  insurance_deadlines: () => m.caltargets_kind_insurance_deadlines(),
  warranty_ends: () => m.caltargets_kind_warranty_ends(),
};

export const calendarKindHints: Record<CalendarItemKind, () => string> = {
  appointments: () => m.caltargets_kind_appointments_hint(),
  task_due: () => m.caltargets_kind_task_due_hint(),
  preparations: () => m.caltargets_kind_preparations_hint(),
  defect_deadlines: () => m.caltargets_kind_defect_deadlines_hint(),
  insurance_deadlines: () => m.caltargets_kind_insurance_deadlines_hint(),
  warranty_ends: () => m.caltargets_kind_warranty_ends_hint(),
};

export const timedModeLabels: Record<CalendarTimedMode, () => string> = {
  all_day: () => m.caltargets_timed_all_day(),
  timed: () => m.caltargets_timed_timed(),
};

export const remoteDeleteLabels: Record<
  CalendarRemoteDeletePolicy,
  () => string
> = {
  recreate: () => m.caltargets_remote_delete_recreate(),
  forget: () => m.caltargets_remote_delete_forget(),
};

export const remoteDeleteHints: Record<
  CalendarRemoteDeletePolicy,
  () => string
> = {
  recreate: () => m.caltargets_remote_delete_recreate_hint(),
  forget: () => m.caltargets_remote_delete_forget_hint(),
};

/**
 * What a calendar lets hauswart do, as a level. `none`: it takes no new events at all, so it cannot
 * be a target. `unknown`: the system did not say (a calendar never opened).
 */
export type CapabilityLevel =
  "unknown" | "none" | "full" | "no_update" | "no_delete" | "create_only";

export function capabilityLevel(
  caps: CalendarTargetCapabilities | null | undefined,
): CapabilityLevel {
  if (!caps) return "unknown";
  if (!caps.create) return "none";
  if (caps.update && caps.delete) return "full";
  if (caps.delete) return "no_update";
  if (caps.update) return "no_delete";
  return "create_only";
}

/** A few words for a badge. */
export const capabilityLabels: Record<CapabilityLevel, () => string> = {
  unknown: () => m.caltargets_caps_unknown(),
  none: () => m.caltargets_caps_none(),
  full: () => m.caltargets_caps_full(),
  no_update: () => m.caltargets_caps_no_update(),
  no_delete: () => m.caltargets_caps_no_delete(),
  create_only: () => m.caltargets_caps_create_only(),
};

/** A sentence that says what the limits mean for the calendar's content; null when there is nothing to warn about. */
export const capabilityNotes: Record<CapabilityLevel, (() => string) | null> = {
  unknown: null,
  none: () => m.caltargets_caps_none_note(),
  full: null,
  no_update: () => m.caltargets_caps_no_update_note(),
  no_delete: () => m.caltargets_caps_no_delete_note(),
  create_only: () => m.caltargets_caps_create_only_note(),
};
