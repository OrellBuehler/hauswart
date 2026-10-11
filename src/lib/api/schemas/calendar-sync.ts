import { z } from "zod";
import {
  CALENDAR_CONFLICT_POLICIES,
  CALENDAR_DIRECTIONS,
  CALENDAR_ITEM_KINDS,
  CALENDAR_PROVIDERS,
  CALENDAR_REMOTE_DELETE_POLICIES,
  CALENDAR_TIMED_MODES,
  FEED_SCOPES,
  INTEGRATION_STATUSES,
  USER_LOCALES,
} from "../enums";
import {
  atLeastOne,
  idSchema,
  isoTimestampSchema,
  paginated,
  queryBooleanSchema,
} from "./common";

export const MAX_TARGET_NAME = 100;
export const MAX_TITLE_PREFIX = 30;
export const MAX_ALARM_MINUTES = 40_320;
export const MIN_DUE_DURATION = 5;
export const MAX_DUE_DURATION = 480;

const providerSchema = z.enum(CALENDAR_PROVIDERS);
const kindSchema = z.enum(CALENDAR_ITEM_KINDS);
const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: "Expected HH:MM" });

/** What the calendar lets hauswart do with events. `alarms`: reminders written with an event are kept. */
export const calendarCapabilitiesSchema = z
  .object({
    create: z.boolean(),
    update: z.boolean(),
    delete: z.boolean(),
    alarms: z.boolean(),
  })
  .meta({ id: "CalendarCapabilities" });
export type CalendarTargetCapabilities = z.infer<
  typeof calendarCapabilitiesSchema
>;

const configFields = {
  /** What goes into the calendar: at least one kind, each once (stored in the order of `CALENDAR_ITEM_KINDS`). */
  kinds: z
    .array(kindSchema)
    .min(1)
    .refine((list) => new Set(list).size === list.length, {
      error: "Name each kind once.",
    }),
  /** Only `push` exists: hauswart writes, the calendar is never read back. */
  direction: z.enum(CALENDAR_DIRECTIONS),
  /** `mine`: tasks and appointments of the owner or of nobody; only for the target of one person. `all`: everything. */
  scope: z.enum(FEED_SCOPES),
  /** Items that only have a date: all-day events, or events of `dueDurationMinutes` from `dueTime` (household time zone). */
  timedMode: z.enum(CALENDAR_TIMED_MODES),
  dueTime: timeSchema,
  dueDurationMinutes: z
    .number()
    .int()
    .min(MIN_DUE_DURATION)
    .max(MAX_DUE_DURATION),
  /** A reminder this many minutes before the start, for calendars that keep reminders; null = none. */
  alarmMinutes: z.number().int().min(0).max(MAX_ALARM_MINUTES).nullable(),
  /** Put in front of every title, e.g. "hauswart: ". */
  titlePrefix: z.string().max(MAX_TITLE_PREFIX),
  /** An event somebody deleted in the calendar: write it again (`recreate`) or leave it deleted (`forget`). */
  onRemoteDelete: z.enum(CALENDAR_REMOTE_DELETE_POLICIES),
  /** Who wins when both changed an event. Only hauswart does today (changes in the calendar are not detected). */
  conflictPolicy: z.enum(CALENDAR_CONFLICT_POLICIES),
  /** The language of generated titles and descriptions. */
  locale: z.enum(USER_LOCALES),
};

export const calendarTargetConfigSchema = z.strictObject({
  kinds: configFields.kinds,
  direction: configFields.direction.default("push"),
  scope: configFields.scope.default("all"),
  timedMode: configFields.timedMode.default("all_day"),
  dueTime: configFields.dueTime.default("08:00"),
  dueDurationMinutes: configFields.dueDurationMinutes.default(30),
  alarmMinutes: configFields.alarmMinutes.default(null),
  titlePrefix: configFields.titlePrefix.default(""),
  onRemoteDelete: configFields.onRemoteDelete.default("recreate"),
  conflictPolicy: configFields.conflictPolicy.default("hauswart_wins"),
  locale: configFields.locale.default("de"),
});
export type CalendarTargetConfig = z.output<typeof calendarTargetConfigSchema>;

/** The fields of a change: whatever is given replaces the stored value, the rest stays. */
export const calendarTargetConfigChangeSchema = z.strictObject({
  kinds: configFields.kinds.optional(),
  direction: configFields.direction.optional(),
  scope: configFields.scope.optional(),
  timedMode: configFields.timedMode.optional(),
  dueTime: configFields.dueTime.optional(),
  dueDurationMinutes: configFields.dueDurationMinutes.optional(),
  alarmMinutes: configFields.alarmMinutes.optional(),
  titlePrefix: configFields.titlePrefix.optional(),
  onRemoteDelete: configFields.onRemoteDelete.optional(),
  conflictPolicy: configFields.conflictPolicy.optional(),
  locale: configFields.locale.optional(),
});
export type CalendarTargetConfigChange = z.output<
  typeof calendarTargetConfigChangeSchema
>;

/** What the last run did. `remaining`: work left for the next run (a run is limited in size). */
export const calendarSyncCountsSchema = z
  .object({
    created: z.number().int().min(0),
    updated: z.number().int().min(0),
    replaced: z.number().int().min(0),
    deleted: z.number().int().min(0),
    adopted: z.number().int().min(0),
    forgotten: z.number().int().min(0),
    skipped: z.number().int().min(0),
    failed: z.number().int().min(0),
    unconfirmed: z.number().int().min(0),
    remaining: z.number().int().min(0),
  })
  .meta({ id: "CalendarSyncCounts" });
export type CalendarSyncCounts = z.infer<typeof calendarSyncCountsSchema>;

export const calendarTargetSchema = z
  .object({
    id: idSchema,
    provider: providerSchema,
    /** `household`: one for everybody, managed by administrators. `user`: the person's own. */
    level: z.enum(["household", "user"]),
    /** The person a `user` target belongs to; null for household targets. */
    ownerId: z.string().nullable(),
    /** The calendar in the connected system, as its picker lists it (an entity id, a collection address). */
    remoteCalendarId: z.string(),
    /** The calendar's own name as its system last reported it (follows a rename there); null before the first contact. `name` is the target's, given when it was added. */
    remoteName: z.string().nullable(),
    name: z.string(),
    enabled: z.boolean(),
    config: calendarTargetConfigSchema.meta({ id: "CalendarTargetConfig" }),
    /** What the calendar allowed when it was last opened; null before the first contact. */
    capabilities: calendarCapabilitiesSchema.nullable(),
    status: z.enum(INTEGRATION_STATUSES),
    /** Short machine-readable code of the last failure (`unauthorized`, `unsupported`, `calendar_missing`, ...). */
    lastError: z.string().nullable(),
    lastOkAt: isoTimestampSchema.nullable(),
    /** The last attempt, successful or not. */
    lastCheckedAt: isoTimestampSchema.nullable(),
    consecutiveFailures: z.number().int().min(0),
    lastStats: calendarSyncCountsSchema.nullable(),
    /** Events hauswart keeps in the calendar (items it has written). */
    eventCount: z.number().int().min(0),
    /** Whether the caller may change, sync or delete it (administrators for household targets, the owner for the rest). */
    canManage: z.boolean(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .meta({ id: "CalendarTarget" });
export type CalendarTarget = z.infer<typeof calendarTargetSchema>;

export const listCalendarTargetsResponseSchema =
  paginated(calendarTargetSchema);

export const createCalendarTargetRequestSchema = z.strictObject({
  provider: providerSchema,
  /** From `GET /integrations/{provider}/calendars`. */
  remoteCalendarId: z.string().trim().min(1).max(255),
  /** Defaults to the name of the calendar. */
  name: z.string().trim().min(1).max(MAX_TARGET_NAME).optional(),
  enabled: z.boolean().default(true),
  config: calendarTargetConfigSchema,
});
export type CreateCalendarTargetRequest = z.output<
  typeof createCalendarTargetRequestSchema
>;

export const updateCalendarTargetRequestSchema = atLeastOne(
  z.strictObject({
    name: z.string().trim().min(1).max(MAX_TARGET_NAME).optional(),
    enabled: z.boolean().optional(),
    config: calendarTargetConfigChangeSchema.optional(),
  }),
);
export type UpdateCalendarTargetRequest = z.output<
  typeof updateCalendarTargetRequestSchema
>;

export const deleteCalendarTargetQuerySchema = z.object({
  /** Also delete the events hauswart wrote; needs a calendar that allows deleting. */
  removeRemote: queryBooleanSchema.optional(),
});

export const calendarSyncResponseSchema = z
  .object({
    /** False when the run failed (`error` says why); a failed run is a normal answer, not an HTTP error. */
    ok: z.boolean(),
    error: z.object({ code: z.string(), message: z.string() }).nullable(),
    counts: calendarSyncCountsSchema,
    target: calendarTargetSchema,
  })
  .meta({ id: "CalendarSync" });
