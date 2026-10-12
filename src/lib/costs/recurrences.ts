import {
  COST_CATEGORY_COUNTS_AS_EXPENSE,
  type CostRecurrenceFrequency,
  type UserLocale,
} from "$lib/api/enums";
import { isApiError } from "$lib/api/errors";
import type { CostBook } from "$lib/api/schemas/cost-books";
import {
  createCostRecurrenceRequestSchema,
  updateCostRecurrenceRequestSchema,
  type CostRecurrence,
  type CostRecurrenceRun,
  type CreateCostRecurrenceRequest,
  type UpdateCostRecurrenceRequest,
} from "$lib/api/schemas/cost-recurrences";
import { compareDates, daysInMonth, isValidDate, parseDate } from "$lib/dates";
import {
  formatDay,
  formatList,
  formatOrdinalDay,
  monthInDate,
  monthName,
} from "$lib/format";
import { m } from "$lib/paraglide/messages";
import { issuesToErrors } from "$lib/tasks/field-errors";
import { currencySchema } from "$lib/api/schemas/household";
import { currencyExponent, minor, toDecimalString } from "$lib/money";
import {
  chosenParticipants,
  equalShares,
  newDraft,
  parseDraftAmount,
  sharesToInputs,
  splitPatch,
  taxClassApplies,
  validateShares,
  type BuiltBody,
  type CostDraft,
  type NewDraftDefaults,
} from "./form";
import { sameTagIds, tagIdsOf } from "./tags";
import {
  RECURRENCE_BOOKING_CAP,
  dueOccurrences,
  firstOccurrence,
  nextOccurrenceAfter,
  type RecurrenceRule,
} from "./recurrence";

/** How many dates the preview of a rule shows. */
export const PREVIEW_DATES = 3;

export type RecurrenceRuleInput = Pick<
  CostRecurrence,
  "frequency" | "interval" | "dayOfMonth" | "startDate" | "endDate"
>;

/** The rule of a recurring cost as `lib/costs/recurrence.ts` takes it. */
export function ruleOf(recurrence: RecurrenceRuleInput): RecurrenceRule {
  return {
    frequency: recurrence.frequency,
    interval: recurrence.interval,
    dayOfMonth: recurrence.dayOfMonth,
    startDate: recurrence.startDate,
    endDate: recurrence.endDate,
  };
}

/** The months (1 to 12) the rule books in, which are the start month and then every step on. */
function bookingMonths(rule: RecurrenceRule): number[] {
  const step =
    (rule.frequency === "yearly"
      ? 12
      : rule.frequency === "quarterly"
        ? 3
        : 1) * rule.interval;
  const start = parseDate(rule.startDate).month - 1;
  const months = new Set<number>();
  for (let k = 0; k < 12; k += 1) months.add(((start + k * step) % 12) + 1);
  return [...months].sort((a, b) => a - b);
}

/**
 * The months in which the rule's day is not always there, so that the booking falls on the last day of the month instead:
 * a month with fewer days (in a year without a leap day), and February when the day is the 29th. Empty for a day up to
 * the 28th.
 */
export function clampedMonths(rule: RecurrenceRule): number[] {
  return bookingMonths(rule).filter(
    (month) =>
      rule.dayOfMonth > daysInMonth(2027, month) ||
      (month === 2 && rule.dayOfMonth === 29),
  );
}

/**
 * "Monatlich am 1.", "Alle 3 Monate am 15.", "Jährlich am 31. Jan." - the rule in words. A yearly rule names the month
 * of its start date, since occurrences are counted from there.
 */
export function ruleWording(
  rule: Pick<
    RecurrenceRule,
    "frequency" | "interval" | "dayOfMonth" | "startDate"
  >,
  locale?: UserLocale,
): string {
  const options = locale ? { locale } : undefined;
  const params = { interval: rule.interval };
  const day = formatOrdinalDay(rule.dayOfMonth, locale);
  switch (rule.frequency) {
    case "monthly":
      return m.recurrence_rule_monthly({ ...params, day }, options);
    case "quarterly":
      return m.recurrence_rule_quarterly({ ...params, day }, options);
    case "yearly":
      return m.recurrence_rule_yearly(
        {
          ...params,
          dayNumber: rule.dayOfMonth,
          month: monthInDate(parseDate(rule.startDate).month, locale),
        },
        options,
      );
  }
}

/**
 * Why a rule with a day beyond the 28th books on the last day of some months, in words; `null` for a day that every month
 * has. A rule that books every month says it in general, another names the months it books in where the day is missing.
 */
export function clampNote(
  rule: RecurrenceRule,
  locale?: UserLocale,
): string | null {
  const months = clampedMonths(rule);
  if (months.length === 0) return null;
  const options = locale ? { locale } : undefined;
  const day = formatOrdinalDay(rule.dayOfMonth, locale);
  if (rule.frequency === "monthly" && rule.interval === 1) {
    return m.recurrence_clamp_every_month({ day }, options);
  }
  return m.recurrence_clamp_some_months(
    {
      day,
      months: formatList(
        months.map((month) => monthName(month, "long", locale)),
        locale,
      ),
    },
    options,
  );
}

export type RecurrenceState = "active" | "paused" | "finished";

/** A series with no next date is over (its end date is behind it); one that is switched off is paused. */
export function recurrenceState(
  recurrence: Pick<CostRecurrence, "active" | "nextDate">,
): RecurrenceState {
  if (recurrence.nextDate === null) return "finished";
  return recurrence.active ? "active" : "paused";
}

/** Whether the next booking is due and only waits for the scheduler (or a tap on "book now"). */
export function isDue(
  recurrence: Pick<CostRecurrence, "active" | "nextDate">,
  today: string,
): boolean {
  return (
    recurrence.active &&
    recurrence.nextDate !== null &&
    compareDates(recurrence.nextDate, today) <= 0
  );
}

export const recurrenceStateLabels: Record<RecurrenceState, () => string> = {
  active: () => m.recurrence_state_active(),
  paused: () => m.recurrence_state_paused(),
  finished: () => m.recurrence_state_finished(),
};

/** Why the last booking failed, in words and with what to do about it; `null` while the recurring cost works. */
export function recurrenceErrorMessage(
  recurrence: Pick<CostRecurrence, "lastError" | "bookName">,
): string | null {
  switch (recurrence.lastError) {
    case "book_archived":
      return m.recurrence_error_book_archived({ book: recurrence.bookName });
    case "failed":
      return m.recurrence_error_failed();
    case null:
      return null;
  }
}

/** The next dates after `today` the rule books on: what the preview shows, at most `count` of them. */
export function upcomingDates(
  rule: RecurrenceRule,
  today: string,
  count: number = PREVIEW_DATES,
): string[] {
  const dates: string[] = [];
  let next = nextOccurrenceAfter(rule, today);
  while (next !== null && dates.length < count) {
    dates.push(next);
    next = nextOccurrenceAfter(rule, next);
  }
  return dates;
}

export type ImmediateBookings = {
  /** How many entries are booked at once (at most `RECURRENCE_BOOKING_CAP`). */
  count: number;
  /** More are due than one run books: the rest follows in the next runs. */
  capped: boolean;
  first: string | null;
  last: string | null;
};

/**
 * What saving books at once: every occurrence after the newest one that was booked (all of them for a new one) up to and
 * including today, at most `RECURRENCE_BOOKING_CAP` per run. A start date in the past therefore books everything since.
 */
export function immediateBookings(
  rule: RecurrenceRule,
  lastBooked: string | null,
  today: string,
): ImmediateBookings {
  const due = dueOccurrences(
    rule,
    lastBooked,
    today,
    RECURRENCE_BOOKING_CAP + 1,
  );
  const count = Math.min(due.length, RECURRENCE_BOOKING_CAP);
  return {
    count,
    capped: due.length > RECURRENCE_BOOKING_CAP,
    first: due[0] ?? null,
    last: due[count - 1] ?? null,
  };
}

/** The warning under the start date: how many entries saving books at once, and since when; `null` when none. */
export function immediateWarning(
  bookings: ImmediateBookings,
  today: string,
): string | null {
  if (bookings.count === 0 || bookings.first === null) return null;
  if (bookings.first === today && bookings.count === 1) {
    return m.recurrence_immediate_today();
  }
  const text = m.recurrence_immediate({
    count: bookings.count,
    date: formatDay(bookings.first),
  });
  return bookings.capped
    ? `${text} ${m.recurrence_immediate_capped({ max: RECURRENCE_BOOKING_CAP })}`
    : text;
}

/** What the rule fields of the form edit. */
export type RuleDraft = {
  frequency: CostRecurrenceFrequency;
  /** As typed: 1 to 12. */
  interval: string;
  /** As typed: 1 to 31. Follows the day of the start date until the person types one. */
  dayOfMonth: string;
  dayTouched: boolean;
  startDate: string;
  /** Empty = no end. */
  endDate: string;
};

/** What the form of a recurring cost edits: the fields of an entry's form that a template has, and the rule. */
export type RecurrenceDraft = Omit<
  CostDraft,
  "date" | "defectId" | "serviceLogId" | "financeSuggestionId"
> &
  RuleDraft;

export function newRecurrenceDraft(
  defaults: NewDraftDefaults,
): RecurrenceDraft {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the fields a template does not have
  const { date, defectId, serviceLogId, financeSuggestionId, ...template } =
    newDraft(defaults);
  return {
    ...template,
    frequency: "monthly",
    interval: "1",
    dayOfMonth: String(parseDate(defaults.today).day),
    dayTouched: false,
    startDate: defaults.today,
    endDate: "",
  };
}

/** The draft after the start date changed: the day of the month follows it until the person typed a day. */
export function withStartDate(
  draft: RecurrenceDraft,
  startDate: string,
): RecurrenceDraft {
  return {
    ...draft,
    startDate,
    dayOfMonth:
      !draft.dayTouched && isValidDate(startDate)
        ? String(parseDate(startDate).day)
        : draft.dayOfMonth,
  };
}

export function draftFromRecurrence(
  recurrence: CostRecurrence,
  userIds: readonly string[],
): RecurrenceDraft {
  return {
    bookId: recurrence.bookId,
    title: recurrence.title,
    amount: toDecimalString(
      minor(Math.abs(recurrence.amountMinor)),
      currencyExponent(recurrence.currency),
    ),
    refund: recurrence.amountMinor < 0,
    currency: recurrence.currency,
    category: recurrence.category,
    assetId: recurrence.assetId ?? "",
    roomId: recurrence.roomId ?? "",
    payee: recurrence.payee ?? "",
    notes: recurrence.notes ?? "",
    paidByUserId: recurrence.paidByUserId ?? "",
    splitMode: recurrence.splitMode,
    splitTouched: true,
    participants: recurrenceParticipants(recurrence, userIds),
    shares: recurrence.shares
      ? sharesToInputs(recurrence.shares, userIds)
      : equalShares(userIds),
    countsAsExpense: recurrence.countsAsExpense,
    countsTouched:
      recurrence.countsAsExpense !==
      COST_CATEGORY_COUNTS_AS_EXPENSE[recurrence.category],
    deductible: recurrence.deductible,
    tagIds: tagIdsOf(recurrence.tags),
    frequency: recurrence.frequency,
    interval: String(recurrence.interval),
    dayOfMonth: String(recurrence.dayOfMonth),
    dayTouched: true,
    startDate: recurrence.startDate,
    endDate: recurrence.endDate ?? "",
  };
}

/** The people an equal split of the recurring cost is among: the ones named, else everybody. */
export function recurrenceParticipants(
  recurrence: Pick<CostRecurrence, "splitMode" | "participantIds">,
  userIds: readonly string[],
): string[] {
  if (recurrence.splitMode !== "equal" || recurrence.participantIds === null) {
    return [...userIds];
  }
  const named = new Set(recurrence.participantIds);
  return userIds.filter((id) => named.has(id));
}

function nullable(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

type Checked = {
  errors: Record<string, string>;
  amountMinor: number | undefined;
  shares: ReturnType<typeof validateShares>["items"];
  participants: string[];
  rule: RecurrenceRule | undefined;
};

function whole(text: string): number | undefined {
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : undefined;
}

function check(draft: RecurrenceDraft, userIds: readonly string[]): Checked {
  const errors: Record<string, string> = {};
  if (!draft.title.trim()) errors.title = m.field_required();
  if (!currencySchema.safeParse(draft.currency).success) {
    errors.currency = m.cost_currency_invalid();
  }
  const amount = parseDraftAmount(draft.amount, draft.refund, draft.currency);
  if (!amount.ok && !errors.currency) errors.amountMinor = amount.error;

  let shares: Checked["shares"] = [];
  if (draft.splitMode === "custom") {
    const checked = validateShares(draft.shares, userIds);
    shares = checked.items;
    if (checked.error) errors.shares = checked.error;
  }
  const participants = chosenParticipants(draft, userIds);
  if (draft.splitMode === "equal" && participants.length === 0) {
    errors.participantIds = m.cost_for_whom_none();
  }

  const interval = whole(draft.interval);
  if (interval === undefined || interval < 1 || interval > 12) {
    errors.interval = m.recurrence_error_interval();
  }
  const day = whole(draft.dayOfMonth);
  if (day === undefined || day < 1 || day > 31) {
    errors.dayOfMonth = m.recurrence_error_day();
  }
  if (!draft.startDate) errors.startDate = m.field_required();
  else if (!isValidDate(draft.startDate)) {
    errors.startDate = m.field_invalid_date();
  }
  if (draft.endDate) {
    if (!isValidDate(draft.endDate)) errors.endDate = m.field_invalid_date();
    else if (
      isValidDate(draft.startDate) &&
      compareDates(draft.endDate, draft.startDate) < 0
    ) {
      errors.endDate = m.recurrence_error_end_before_start();
    }
  }

  const rule =
    !errors.interval &&
    !errors.dayOfMonth &&
    !errors.startDate &&
    !errors.endDate
      ? {
          frequency: draft.frequency,
          interval: interval as number,
          dayOfMonth: day as number,
          startDate: draft.startDate,
          endDate: draft.endDate || null,
        }
      : undefined;
  if (rule && firstOccurrence(rule) === null) {
    errors.endDate = m.recurrence_error_no_occurrence();
  }
  return {
    errors,
    amountMinor: amount.ok ? amount.amountMinor : undefined,
    shares,
    participants,
    rule,
  };
}

/** The rule of a draft when its rule fields are valid (what the preview works on), else `null`. */
export function ruleOfDraft(draft: RecurrenceDraft): RecurrenceRule | null {
  const interval = whole(draft.interval);
  const day = whole(draft.dayOfMonth);
  if (
    interval === undefined ||
    interval < 1 ||
    interval > 12 ||
    day === undefined ||
    day < 1 ||
    day > 31 ||
    !isValidDate(draft.startDate)
  ) {
    return null;
  }
  if (draft.endDate) {
    if (
      !isValidDate(draft.endDate) ||
      compareDates(draft.endDate, draft.startDate) < 0
    ) {
      return null;
    }
  }
  return {
    frequency: draft.frequency,
    interval,
    dayOfMonth: day,
    startDate: draft.startDate,
    endDate: draft.endDate || null,
  };
}

/** The request for a new recurring cost, or the errors that stop it. */
export function buildRecurrenceCreateBody(
  draft: RecurrenceDraft,
  userIds: readonly string[],
  books: readonly CostBook[] = [],
): BuiltBody<CreateCostRecurrenceRequest> {
  const { errors, amountMinor, shares, participants, rule } = check(
    draft,
    userIds,
  );
  if (amountMinor === undefined || !rule || Object.keys(errors).length > 0) {
    return { body: undefined, errors };
  }
  const narrowed =
    draft.splitMode === "equal" &&
    participants.length > 0 &&
    participants.length < userIds.length
      ? participants
      : undefined;
  const body = {
    ...(draft.bookId ? { bookId: draft.bookId } : {}),
    title: draft.title.trim(),
    amountMinor,
    currency: draft.currency,
    category: draft.category,
    assetId: draft.assetId || null,
    roomId: draft.roomId || null,
    payee: nullable(draft.payee),
    notes: nullable(draft.notes),
    paidByUserId: draft.paidByUserId || null,
    splitMode: draft.splitMode,
    ...(draft.splitMode === "custom" ? { shares } : {}),
    ...(narrowed ? { participantIds: narrowed } : {}),
    countsAsExpense: draft.countsAsExpense,
    deductible: taxClassApplies(draft, books) ? draft.deductible : "unknown",
    ...(draft.tagIds.length > 0 ? { tagIds: draft.tagIds } : {}),
    frequency: rule.frequency,
    interval: rule.interval,
    dayOfMonth: rule.dayOfMonth,
    startDate: rule.startDate,
    ...(rule.endDate ? { endDate: rule.endDate } : {}),
  };
  const result = createCostRecurrenceRequestSchema.safeParse(body);
  if (!result.success) {
    return {
      body: undefined,
      errors: issuesToErrors(result.error.issues, body),
    };
  }
  return { body: result.data, errors };
}

/** The request that changes `recurrence` into the draft, with only what differs; an empty body means nothing changed. */
export function buildRecurrenceUpdateBody(
  draft: RecurrenceDraft,
  recurrence: CostRecurrence,
  userIds: readonly string[],
  books: readonly CostBook[] = [],
): BuiltBody<UpdateCostRecurrenceRequest> {
  const { errors, amountMinor, shares, participants, rule } = check(
    draft,
    userIds,
  );
  if (amountMinor === undefined || !rule || Object.keys(errors).length > 0) {
    return { body: undefined, errors };
  }
  const patch: Record<string, unknown> = {};
  const title = draft.title.trim();
  if (draft.bookId && draft.bookId !== recurrence.bookId) {
    patch.bookId = draft.bookId;
  }
  if (title !== recurrence.title) patch.title = title;
  if (amountMinor !== recurrence.amountMinor) patch.amountMinor = amountMinor;
  if (draft.currency !== recurrence.currency) patch.currency = draft.currency;
  if (draft.category !== recurrence.category) patch.category = draft.category;
  if ((draft.assetId || null) !== recurrence.assetId) {
    patch.assetId = draft.assetId || null;
  }
  if ((draft.roomId || null) !== recurrence.roomId) {
    patch.roomId = draft.roomId || null;
  }
  if (nullable(draft.payee) !== recurrence.payee) {
    patch.payee = nullable(draft.payee);
  }
  if (nullable(draft.notes) !== recurrence.notes) {
    patch.notes = nullable(draft.notes);
  }
  if ((draft.paidByUserId || null) !== recurrence.paidByUserId) {
    patch.paidByUserId = draft.paidByUserId || null;
  }
  Object.assign(
    patch,
    splitPatch({
      splitMode: draft.splitMode,
      shares,
      participants,
      userIds,
      current: {
        splitMode: recurrence.splitMode,
        shares: recurrence.shares ?? [],
        participants: recurrenceParticipants(recurrence, userIds),
      },
    }),
  );
  if (
    draft.countsAsExpense !== recurrence.countsAsExpense ||
    draft.category !== recurrence.category
  ) {
    patch.countsAsExpense = draft.countsAsExpense;
  }
  if (
    draft.deductible !== recurrence.deductible &&
    taxClassApplies(draft, books)
  ) {
    patch.deductible = draft.deductible;
  }
  if (!sameTagIds(draft.tagIds, tagIdsOf(recurrence.tags))) {
    patch.tagIds = draft.tagIds;
  }
  if (rule.frequency !== recurrence.frequency) patch.frequency = rule.frequency;
  if (rule.interval !== recurrence.interval) patch.interval = rule.interval;
  if (rule.dayOfMonth !== recurrence.dayOfMonth) {
    patch.dayOfMonth = rule.dayOfMonth;
  }
  if (rule.startDate !== recurrence.startDate) patch.startDate = rule.startDate;
  if (rule.endDate !== recurrence.endDate) patch.endDate = rule.endDate;

  if (Object.keys(patch).length === 0) return { body: {}, errors };
  const result = updateCostRecurrenceRequestSchema.safeParse(patch);
  if (!result.success) {
    return {
      body: undefined,
      errors: issuesToErrors(result.error.issues, patch),
    };
  }
  return { body: result.data, errors };
}

/**
 * Whether saving this change touches the rule (the series continues after the newest booking and books what is already
 * due at once) - what the preview should warn about on an edit.
 */
export function changesRule(
  draft: RecurrenceDraft,
  recurrence: CostRecurrence,
): boolean {
  const rule = ruleOfDraft(draft);
  if (!rule) return false;
  return (
    rule.frequency !== recurrence.frequency ||
    rule.interval !== recurrence.interval ||
    rule.dayOfMonth !== recurrence.dayOfMonth ||
    rule.startDate !== recurrence.startDate ||
    rule.endDate !== recurrence.endDate
  );
}

/** What a tap on "book now" answered, as one sentence for a toast. */
export function runNowMessage(
  result: Pick<CostRecurrenceRun, "recurrence" | "entry">,
): { kind: "booked" | "nothing"; text: string } {
  if (result.entry) {
    return {
      kind: "booked",
      text: m.recurrence_run_booked({
        title: result.entry.title,
        date: formatDay(result.entry.date),
      }),
    };
  }
  const { recurrence } = result;
  switch (recurrenceState(recurrence)) {
    case "finished":
      return { kind: "nothing", text: m.recurrence_run_finished() };
    case "paused":
      return { kind: "nothing", text: m.recurrence_run_paused() };
    case "active":
      return {
        kind: "nothing",
        text: m.recurrence_run_not_due({
          date: formatDay(recurrence.nextDate as string),
        }),
      };
  }
}

/** What a tap on "resume" answered: when the next booking is, and that what fell due while it was paused is skipped. */
export function resumeMessage(
  recurrence: Pick<CostRecurrence, "title" | "nextDate">,
): string {
  return recurrence.nextDate
    ? m.recurrence_resumed_toast({
        title: recurrence.title,
        date: formatDay(recurrence.nextDate),
      })
    : m.recurrence_resumed_finished_toast({ title: recurrence.title });
}

/**
 * Whether the API refused because the book is closed to new entries (a 400 on `bookId`): on saving a template that names
 * one, and on a booking when the book was archived since.
 */
export function recurrenceBookClosed(err: unknown): boolean {
  if (!isApiError(err) || err.code !== "invalid_request") return false;
  const fields = (
    err.details as
      { body?: { fieldErrors?: Record<string, unknown> } } | undefined
  )?.body?.fieldErrors;
  return fields !== undefined && "bookId" in fields;
}
