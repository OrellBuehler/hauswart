import type { z } from "zod";
import {
  CALENDAR_ITEM_KINDS,
  type CalendarItemKind,
  type CalendarProviderKind,
  type CalendarRemoteDeletePolicy,
  type CalendarTimedMode,
  type FeedScope,
  type UserLocale,
} from "$lib/api/enums";
import {
  MAX_ALARM_MINUTES,
  MAX_DUE_DURATION,
  MAX_TARGET_NAME,
  MIN_DUE_DURATION,
  type CalendarTarget,
  type CalendarTargetCapabilities,
  type CalendarTargetConfigChange,
  type createCalendarTargetRequestSchema,
  type updateCalendarTargetRequestSchema,
} from "$lib/api/schemas/calendar-sync";
import { m } from "$lib/paraglide/messages";

export type CreateTargetBody = z.input<
  typeof createCalendarTargetRequestSchema
>;
export type UpdateTargetBody = z.input<
  typeof updateCalendarTargetRequestSchema
>;

/**
 * What the form edits. `direction` (hauswart writes, the calendar is never read back) and
 * `conflictPolicy` (hauswart wins) are fixed by the server and not part of it.
 */
export type TargetDraft = {
  name: string;
  kinds: CalendarItemKind[];
  /** Only a person's own target has a choice; the household's carries everything. */
  scope: FeedScope;
  timedMode: CalendarTimedMode;
  dueTime: string;
  dueDurationMinutes: number | undefined;
  alarmOn: boolean;
  alarmMinutes: number | undefined;
  titlePrefix: string;
  onRemoteDelete: CalendarRemoteDeletePolicy;
  locale: UserLocale;
};

/** The deadlines nobody wants to miss and the visits; preparations and warranties are noisier and stay off until asked for. */
export const DEFAULT_KINDS: readonly CalendarItemKind[] = [
  "appointments",
  "task_due",
  "defect_deadlines",
  "insurance_deadlines",
];

export const DEFAULT_DUE_TIME = "08:00";
export const DEFAULT_DUE_DURATION = 30;
export const DEFAULT_ALARM_MINUTES = 60;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The kinds in the order the server stores and lists them. */
export function orderedKinds(
  kinds: readonly CalendarItemKind[],
): CalendarItemKind[] {
  return CALENDAR_ITEM_KINDS.filter((kind) => kinds.includes(kind));
}

export function defaultDraft(locale: UserLocale): TargetDraft {
  return {
    name: "",
    kinds: orderedKinds(DEFAULT_KINDS),
    scope: "mine",
    timedMode: "all_day",
    dueTime: DEFAULT_DUE_TIME,
    dueDurationMinutes: DEFAULT_DUE_DURATION,
    alarmOn: false,
    alarmMinutes: DEFAULT_ALARM_MINUTES,
    titlePrefix: "",
    onRemoteDelete: "recreate",
    locale,
  };
}

export function draftFromTarget(target: CalendarTarget): TargetDraft {
  const { config } = target;
  return {
    name: target.name,
    kinds: orderedKinds(config.kinds),
    scope: config.scope,
    timedMode: config.timedMode,
    dueTime: config.dueTime,
    dueDurationMinutes: config.dueDurationMinutes,
    alarmOn: config.alarmMinutes !== null,
    alarmMinutes: config.alarmMinutes ?? DEFAULT_ALARM_MINUTES,
    titlePrefix: config.titlePrefix,
    onRemoteDelete: config.onRemoteDelete,
    locale: config.locale,
  };
}

/** Whether reminders written with an event are kept by the calendar (only a calendar that said so). */
export function alarmsSupported(
  capabilities: CalendarTargetCapabilities | null | undefined,
): boolean {
  return capabilities?.alarms === true;
}

export type DraftOptions = {
  /** `household`: the connection is the household's, so the target carries everything. */
  level: "household" | "user";
  capabilities: CalendarTargetCapabilities | null;
};

const isInt = (value: number | undefined): value is number =>
  value !== undefined && Number.isInteger(value);

/** The time of day as typed, when it is a valid one. */
const validTime = (draft: TargetDraft): string | undefined =>
  TIME.test(draft.dueTime) ? draft.dueTime : undefined;

/** The duration as typed, when it is a whole number of minutes the server accepts. */
const validDuration = (draft: TargetDraft): number | undefined =>
  isInt(draft.dueDurationMinutes) &&
  draft.dueDurationMinutes >= MIN_DUE_DURATION &&
  draft.dueDurationMinutes <= MAX_DUE_DURATION
    ? draft.dueDurationMinutes
    : undefined;

/** Field errors of the draft in the person's language, keyed by field; empty when it can be sent. */
export function validateDraft(
  draft: TargetDraft,
  options: { creating: boolean; remoteCalendarId: string } & DraftOptions,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (options.creating && options.remoteCalendarId === "") {
    errors.remoteCalendarId = m.caltargets_error_calendar_required();
  }
  const name = draft.name.trim();
  if (!options.creating && name === "") errors.name = m.field_required();
  else if (name.length > MAX_TARGET_NAME) {
    errors.name = m.field_too_long({ max: MAX_TARGET_NAME });
  }
  if (draft.kinds.length === 0) errors.kinds = m.caltargets_error_kinds();
  if (draft.timedMode === "timed") {
    if (!TIME.test(draft.dueTime)) errors.dueTime = m.caltargets_error_time();
    if (!isInt(draft.dueDurationMinutes)) {
      errors.dueDurationMinutes = m.field_number();
    } else if (draft.dueDurationMinutes < MIN_DUE_DURATION) {
      errors.dueDurationMinutes = m.field_min({ min: MIN_DUE_DURATION });
    } else if (draft.dueDurationMinutes > MAX_DUE_DURATION) {
      errors.dueDurationMinutes = m.field_max({ max: MAX_DUE_DURATION });
    }
  }
  if (draft.alarmOn && alarmsSupported(options.capabilities)) {
    if (!isInt(draft.alarmMinutes)) {
      errors.alarmMinutes = m.field_number();
    } else if (draft.alarmMinutes < 0) {
      errors.alarmMinutes = m.field_min({ min: 0 });
    } else if (draft.alarmMinutes > MAX_ALARM_MINUTES) {
      errors.alarmMinutes = m.field_max({ max: MAX_ALARM_MINUTES });
    }
  }
  return errors;
}

type FullConfig = Required<
  Omit<CalendarTargetConfigChange, "direction" | "conflictPolicy">
>;

/**
 * The settings the draft stands for. The time of day and the duration only matter for events with a
 * time; a half-typed value that was left behind in an all-day target is replaced by the default.
 */
function configOf(draft: TargetDraft, options: DraftOptions): FullConfig {
  return {
    kinds: orderedKinds(draft.kinds),
    scope: options.level === "user" ? draft.scope : "all",
    timedMode: draft.timedMode,
    dueTime: validTime(draft) ?? DEFAULT_DUE_TIME,
    dueDurationMinutes: validDuration(draft) ?? DEFAULT_DUE_DURATION,
    alarmMinutes:
      draft.alarmOn &&
      alarmsSupported(options.capabilities) &&
      isInt(draft.alarmMinutes)
        ? draft.alarmMinutes
        : null,
    titlePrefix: draft.titlePrefix,
    onRemoteDelete: draft.onRemoteDelete,
    locale: draft.locale,
  };
}

/**
 * The request that adds a calendar. A blank name is left out (the server then takes the calendar's
 * own), and so are `direction` and `conflictPolicy`, which have a single value.
 */
export function createBody(
  provider: CalendarProviderKind,
  remoteCalendarId: string,
  draft: TargetDraft,
  options: DraftOptions,
): CreateTargetBody {
  const name = draft.name.trim();
  return {
    provider,
    remoteCalendarId,
    ...(name === "" ? {} : { name }),
    config: configOf(draft, options),
  };
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * The request that saves the draft over `target`: only what differs, so a change somebody else
 * made to another setting in the meantime is not written back, and a reminder the calendar cannot
 * keep is left as it is. `null` when nothing differs.
 */
export function updateBody(
  target: CalendarTarget,
  draft: TargetDraft,
  options: Pick<DraftOptions, "capabilities">,
): UpdateTargetBody | null {
  const next = configOf(draft, {
    level: target.level,
    capabilities: options.capabilities,
  });
  const current = target.config;
  const config: CalendarTargetConfigChange = {};
  if (!sameList(next.kinds, orderedKinds(current.kinds)))
    config.kinds = next.kinds;
  if (target.level === "user" && next.scope !== current.scope) {
    config.scope = next.scope;
  }
  if (next.timedMode !== current.timedMode) config.timedMode = next.timedMode;
  const time = validTime(draft);
  if (time !== undefined && time !== current.dueTime) config.dueTime = time;
  const duration = validDuration(draft);
  if (duration !== undefined && duration !== current.dueDurationMinutes) {
    config.dueDurationMinutes = duration;
  }
  if (
    alarmsSupported(options.capabilities) &&
    next.alarmMinutes !== current.alarmMinutes
  ) {
    config.alarmMinutes = next.alarmMinutes;
  }
  if (next.titlePrefix !== current.titlePrefix)
    config.titlePrefix = next.titlePrefix;
  if (next.onRemoteDelete !== current.onRemoteDelete) {
    config.onRemoteDelete = next.onRemoteDelete;
  }
  if (next.locale !== current.locale) config.locale = next.locale;

  const name = draft.name.trim();
  const body: UpdateTargetBody = {
    ...(name !== target.name ? { name } : {}),
    ...(Object.keys(config).length > 0 ? { config } : {}),
  };
  return Object.keys(body).length === 0 ? null : body;
}
