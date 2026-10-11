import type { z } from "zod";
import {
  APPOINTMENT_LOCATION_MAX,
  APPOINTMENT_NOTES_MAX,
  APPOINTMENT_TITLE_MAX,
  MAX_APPOINTMENT_DAYS,
  createAppointmentRequestSchema,
  updateAppointmentRequestSchema,
  type Appointment,
} from "$lib/api/schemas/appointments";
import { isValidDate, localDateOf, zonedTimeToInstant } from "$lib/dates";
import { m } from "$lib/paraglide/messages";
import { issuesToErrors } from "$lib/tasks/field-errors";
import { spanOf, whenOf, type WhenFields } from "./format";
import { pinnableOccurrenceKey } from "./occurrence";
import { defaultEnd, whenProblem, type AppointmentWhen } from "./when";

export type CreateBody = z.input<typeof createAppointmentRequestSchema>;
export type UpdateBody = z.input<typeof updateAppointmentRequestSchema>;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** What the form edits. Dates and times stay text until they are checked on submit. */
export type AppointmentDraft = {
  title: string;
  allDay: boolean;
  /** `YYYY-MM-DD` in the household zone: the first day of either kind. */
  startDate: string;
  /** `HH:MM`; timed appointments only. */
  startTime: string;
  /** Empty: the same day as the start. */
  endDate: string;
  /** `HH:MM`; empty: an hour after the start (timed appointments only). */
  endTime: string;
  location: string;
  notes: string;
  taskId: string | null;
  assetId: string | null;
  contactId: string | null;
  /**
   * The occurrence of the task the appointment is for; only a new appointment sends it, and without
   * one the server takes the occurrence the task shows.
   */
  occurrenceKey: string | null;
};

export type NewDraftDefaults = {
  /** Today in the household zone: the day a new appointment starts on. */
  today: string;
  title?: string | undefined;
  taskId?: string | null | undefined;
  assetId?: string | null | undefined;
  contactId?: string | null | undefined;
  occurrenceKey?: string | null | undefined;
};

/** What a new appointment starts with, and the names of what is prefilled (shown while the lists load). */
export type AppointmentDefaults = Omit<NewDraftDefaults, "today"> & {
  taskTitle?: string | null | undefined;
  assetName?: string | null | undefined;
};

export function newDraft(defaults: NewDraftDefaults): AppointmentDraft {
  return {
    title: defaults.title ?? "",
    allDay: false,
    startDate: defaults.today,
    startTime: "",
    endDate: "",
    endTime: "",
    location: "",
    notes: "",
    taskId: defaults.taskId ?? null,
    assetId: defaults.assetId ?? null,
    contactId: defaults.contactId ?? null,
    occurrenceKey: defaults.taskId
      ? pinnableOccurrenceKey(defaults.occurrenceKey)
      : null,
  };
}

/** The form for an appointment as it is, in the wall-clock times of the household zone. */
export function draftFromAppointment(
  a: Appointment,
  timeZone: string,
): AppointmentDraft {
  const { first, startTime, endTime } = spanOf(a, timeZone);
  const when = whenOf(a);
  const endDay = when.allDay
    ? when.endDate
    : localDateOf(timeZone, when.endsAt);
  return {
    title: a.title,
    allDay: a.allDay,
    startDate: first,
    startTime: startTime ?? "",
    endDate: endDay === first ? "" : endDay,
    endTime: endTime ?? "",
    location: a.location ?? "",
    notes: a.notes ?? "",
    taskId: a.taskId,
    assetId: a.assetId,
    contactId: a.contactId,
    occurrenceKey: a.occurrenceKey,
  };
}

export type DraftWhen = {
  /** Null while the dates and times do not make a valid span. */
  when: AppointmentWhen | null;
  /** By form field: `startDate`, `startTime`, `endDate`, `endTime`. */
  errors: Record<string, string>;
  /** The end is the default of an hour after the start, not one the person gave. */
  endIsDefault: boolean;
};

function describeProblem(when: AppointmentWhen): string {
  if (when.allDay) {
    return when.endDate < when.startDate
      ? m.appointment_error_end_before_start_date()
      : m.appointment_error_too_long({ days: MAX_APPOINTMENT_DAYS });
  }
  return when.endsAt <= when.startsAt
    ? m.appointment_error_end_before_start()
    : m.appointment_error_too_long({ days: MAX_APPOINTMENT_DAYS });
}

function checkDate(value: string): string | undefined {
  if (value === "") return m.field_required();
  return isValidDate(value) ? undefined : m.field_invalid_date();
}

function checkTime(value: string): string | undefined {
  if (value === "") return m.field_required();
  return TIME_RE.test(value) ? undefined : m.appointment_error_time_invalid();
}

/**
 * The span the form describes, in the household zone. The end defaults as the API does: an hour after
 * the start of a timed appointment, the same day for an all-day one. The same rules as the server
 * (`whenProblem`), worded for the form.
 */
export function draftWhen(
  draft: AppointmentDraft,
  timeZone: string,
): DraftWhen {
  const errors: Record<string, string> = {};
  const startDateError = checkDate(draft.startDate);
  if (startDateError) errors.startDate = startDateError;
  const endDateError =
    draft.endDate === "" ? undefined : checkDate(draft.endDate);
  if (endDateError) errors.endDate = endDateError;

  if (draft.allDay) {
    if (Object.keys(errors).length > 0) {
      return { when: null, errors, endIsDefault: false };
    }
    const when: AppointmentWhen = {
      allDay: true,
      startDate: draft.startDate,
      endDate: draft.endDate || draft.startDate,
    };
    if (whenProblem(when)) {
      return {
        when: null,
        errors: { endDate: describeProblem(when) },
        endIsDefault: false,
      };
    }
    return { when, errors, endIsDefault: draft.endDate === "" };
  }

  const startTimeError = checkTime(draft.startTime);
  if (startTimeError) errors.startTime = startTimeError;
  const endIsDefault = draft.endTime === "" && draft.endDate === "";
  if (!endIsDefault) {
    const endTimeError = checkTime(draft.endTime);
    if (endTimeError) errors.endTime = endTimeError;
  }
  if (Object.keys(errors).length > 0) {
    return { when: null, errors, endIsDefault };
  }
  const startsAt = zonedTimeToInstant(
    draft.startDate,
    draft.startTime,
    timeZone,
  );
  const endsAt = endIsDefault
    ? defaultEnd(startsAt)
    : zonedTimeToInstant(
        draft.endDate || draft.startDate,
        draft.endTime,
        timeZone,
      );
  const when: AppointmentWhen = { allDay: false, startsAt, endsAt };
  if (whenProblem(when)) {
    return {
      when: null,
      errors: { endTime: describeProblem(when) },
      endIsDefault,
    };
  }
  return { when, errors, endIsDefault };
}

/** The `when` as the fields of an appointment, to word it with `formatWhen`. */
export function fieldsOfWhen(when: AppointmentWhen): WhenFields {
  return when.allDay
    ? {
        allDay: true,
        startsAt: null,
        endsAt: null,
        startDate: when.startDate,
        endDate: when.endDate,
      }
    : {
        allDay: false,
        startsAt: new Date(when.startsAt).toISOString(),
        endsAt: new Date(when.endsAt).toISOString(),
        startDate: null,
        endDate: null,
      };
}

export type BuiltBody<T> = {
  body: T | undefined;
  errors: Record<string, string>;
};

const nullable = (text: string) => {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
};

/** Length and shape problems of the text fields, worded for the form. */
function checkTexts(draft: AppointmentDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  const title = draft.title.trim();
  if (title === "") errors.title = m.field_required();
  else if (title.length > APPOINTMENT_TITLE_MAX) {
    errors.title = m.field_too_long({ max: APPOINTMENT_TITLE_MAX });
  }
  if (draft.location.trim().length > APPOINTMENT_LOCATION_MAX) {
    errors.location = m.field_too_long({ max: APPOINTMENT_LOCATION_MAX });
  }
  if (draft.notes.trim().length > APPOINTMENT_NOTES_MAX) {
    errors.notes = m.field_too_long({ max: APPOINTMENT_NOTES_MAX });
  }
  return errors;
}

/** The request field a problem of the schema is reported on, as the form's field. */
const FORM_FIELD: Record<string, string> = {
  startsAt: "startTime",
  endsAt: "endTime",
};

function remap(errors: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(errors).map(([key, message]) => [
      FORM_FIELD[key] ?? key,
      message,
    ]),
  );
}

/** The instants of a timed `when` as the request sends them. */
const instant = (ms: number) => new Date(ms).toISOString();

/** The request for a new appointment, or the errors that stop it. */
export function buildCreateBody(
  draft: AppointmentDraft,
  timeZone: string,
): BuiltBody<CreateBody> {
  const { when, errors: whenErrors, endIsDefault } = draftWhen(draft, timeZone);
  const errors = { ...checkTexts(draft), ...whenErrors };
  if (Object.keys(errors).length > 0 || !when) {
    return { body: undefined, errors };
  }
  const candidate: CreateBody = {
    title: draft.title.trim(),
    ...(nullable(draft.location) ? { location: nullable(draft.location) } : {}),
    ...(nullable(draft.notes) ? { notes: nullable(draft.notes) } : {}),
    ...(when.allDay
      ? {
          allDay: true,
          startDate: when.startDate,
          ...(draft.endDate === "" ? {} : { endDate: when.endDate }),
        }
      : {
          startsAt: instant(when.startsAt),
          ...(endIsDefault ? {} : { endsAt: instant(when.endsAt) }),
        }),
    ...(draft.taskId ? { taskId: draft.taskId } : {}),
    ...(draft.taskId && draft.occurrenceKey
      ? { occurrenceKey: draft.occurrenceKey }
      : {}),
    // Without an asset the server takes the task's: a cleared field has to say so.
    ...(draft.assetId
      ? { assetId: draft.assetId }
      : draft.taskId
        ? { assetId: null }
        : {}),
    ...(draft.contactId ? { contactId: draft.contactId } : {}),
  };
  const result = createAppointmentRequestSchema.safeParse(candidate);
  if (!result.success) {
    return {
      body: undefined,
      errors: remap(issuesToErrors(result.error.issues, candidate)),
    };
  }
  return { body: candidate, errors };
}

/** Whether the form changed what says when: the kind, the days and the times that apply to it. */
function whenChanged(draft: AppointmentDraft, base: AppointmentDraft): boolean {
  if (draft.allDay !== base.allDay) return true;
  if (draft.startDate !== base.startDate || draft.endDate !== base.endDate) {
    return true;
  }
  return (
    !draft.allDay &&
    (draft.startTime !== base.startTime || draft.endTime !== base.endTime)
  );
}

/**
 * The request that changes `original` into the draft, with only what differs; an empty body means
 * nothing changed. A changed start or end sends both ends, as the server keeps the stored end
 * otherwise and refuses a start behind it. A new task forgets the occurrence on the server.
 */
export function buildUpdateBody(
  draft: AppointmentDraft,
  original: Appointment,
  timeZone: string,
): BuiltBody<UpdateBody> {
  const base = draftFromAppointment(original, timeZone);
  const { when, errors: whenErrors } = draftWhen(draft, timeZone);
  const changesWhen = whenChanged(draft, base);
  const errors = {
    ...checkTexts(draft),
    ...(changesWhen ? whenErrors : {}),
  };
  if (Object.keys(errors).length > 0) return { body: undefined, errors };

  const patch: UpdateBody = {};
  const title = draft.title.trim();
  if (title !== original.title) patch.title = title;
  const location = nullable(draft.location);
  if (location !== original.location) patch.location = location;
  const notes = nullable(draft.notes);
  if (notes !== original.notes) patch.notes = notes;
  if (changesWhen && when) {
    if (draft.allDay !== base.allDay) patch.allDay = draft.allDay;
    if (when.allDay) {
      patch.startDate = when.startDate;
      patch.endDate = when.endDate;
    } else {
      patch.startsAt = instant(when.startsAt);
      patch.endsAt = instant(when.endsAt);
    }
  }
  if (draft.taskId !== original.taskId) patch.taskId = draft.taskId;
  if (draft.assetId !== original.assetId) patch.assetId = draft.assetId;
  if (draft.contactId !== original.contactId) patch.contactId = draft.contactId;

  if (Object.keys(patch).length === 0) return { body: {}, errors };
  const result = updateAppointmentRequestSchema.safeParse(patch);
  if (!result.success) {
    return {
      body: undefined,
      errors: remap(issuesToErrors(result.error.issues, patch)),
    };
  }
  return { body: patch, errors };
}

/** Field errors of an `invalid_request` from the server, as the form's fields. */
export function mapFieldErrors(
  errors: Record<string, string>,
): Record<string, string> {
  return remap(errors);
}
