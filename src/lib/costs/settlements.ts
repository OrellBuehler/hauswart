import {
  createSettlementRequestSchema,
  updateSettlementRequestSchema,
  type CreateSettlementRequest,
  type Settlement,
  type UpdateSettlementRequest,
} from "$lib/api/schemas/settlements";
import { MAX_COST_MINOR } from "$lib/api/schemas/costs";
import { currencySchema } from "$lib/api/schemas/household";
import { isValidDate } from "$lib/dates";
import { formatMoney, readMoney } from "$lib/format-money";
import { currencyExponent, minor, toDecimalString } from "$lib/money";
import { m } from "$lib/paraglide/messages";
import { issuesToErrors } from "$lib/tasks/field-errors";
import { bookParam, parseBookParam } from "./books";
import type { SuggestedPayment } from "./balances";
import { MAX_YEAR, MIN_YEAR } from "./filters";
import type { BuiltBody, ParsedAmount } from "./form";

/** What the settlement form edits. Text stays text until it is checked on submit. */
export type SettlementDraft = {
  fromUserId: string;
  toUserId: string;
  /** The amount as typed. */
  amount: string;
  currency: string;
  date: string;
  /** `""` settles across all books. */
  bookId: string;
  note: string;
};

export type SettlementDefaults = {
  today: string;
  currency: string;
  /** The book on screen, `""` for every book. */
  bookId: string;
};

export function emptySettlementDraft(
  defaults: SettlementDefaults & { fromUserId?: string },
): SettlementDraft {
  return {
    fromUserId: defaults.fromUserId ?? "",
    toUserId: "",
    amount: "",
    currency: defaults.currency,
    date: defaults.today,
    bookId: defaults.bookId,
    note: "",
  };
}

/** "Als bezahlt erfassen": the draft that records a suggested payment as it is, the person may still change it. */
export function draftFromSuggestion(
  payment: Pick<SuggestedPayment, "fromUserId" | "toUserId" | "amountMinor">,
  defaults: SettlementDefaults,
): SettlementDraft {
  return {
    fromUserId: payment.fromUserId,
    toUserId: payment.toUserId,
    amount: toDecimalString(
      minor(payment.amountMinor),
      currencyExponent(defaults.currency),
    ),
    currency: defaults.currency,
    date: defaults.today,
    bookId: defaults.bookId,
    note: "",
  };
}

export function draftFromSettlement(settlement: Settlement): SettlementDraft {
  return {
    fromUserId: settlement.fromUserId,
    toUserId: settlement.toUserId,
    amount: toDecimalString(
      minor(settlement.amountMinor),
      currencyExponent(settlement.currency),
    ),
    currency: settlement.currency,
    date: settlement.date,
    bookId: settlement.bookId ?? "",
    note: settlement.note ?? "",
  };
}

/** The other direction: who paid and who received change places. */
export function swapParties(draft: SettlementDraft): SettlementDraft {
  return {
    ...draft,
    fromUserId: draft.toUserId,
    toUserId: draft.fromUserId,
  };
}

/** A payment is always positive: who paid whom says the direction, so a minus sign is an error here. */
export function parseSettlementAmount(
  amount: string,
  currency: string,
): ParsedAmount {
  if (!currencySchema.safeParse(currency).success) {
    return { ok: false, error: m.cost_amount_needs_currency() };
  }
  const value = readMoney(amount, currency);
  if (value === null) return { ok: false, error: m.field_required() };
  if (value === undefined) {
    return {
      ok: false,
      error: m.cost_amount_invalid({ decimals: currencyExponent(currency) }),
    };
  }
  if (value <= 0) return { ok: false, error: m.settlement_amount_positive() };
  if (value > MAX_COST_MINOR) {
    return {
      ok: false,
      error: m.cost_amount_too_large({
        max: formatMoney(MAX_COST_MINOR, currency),
      }),
    };
  }
  return { ok: true, amountMinor: value };
}

function nullable(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

function check(draft: SettlementDraft) {
  const errors: Record<string, string> = {};
  if (!currencySchema.safeParse(draft.currency).success) {
    errors.currency = m.cost_currency_invalid();
  }
  const amount = parseSettlementAmount(draft.amount, draft.currency);
  if (!amount.ok && !errors.currency) errors.amountMinor = amount.error;
  if (!draft.date) errors.date = m.field_required();
  else if (!isValidDate(draft.date)) errors.date = m.field_invalid_date();
  if (!draft.fromUserId) errors.fromUserId = m.field_required();
  if (!draft.toUserId) errors.toUserId = m.field_required();
  if (
    draft.fromUserId &&
    draft.toUserId &&
    draft.fromUserId === draft.toUserId
  ) {
    errors.toUserId = m.settlement_same_person();
  }
  return { errors, amountMinor: amount.ok ? amount.amountMinor : undefined };
}

/** The request that records the payment, or the errors that stop it. */
export function buildSettlementBody(
  draft: SettlementDraft,
): BuiltBody<CreateSettlementRequest> {
  const { errors, amountMinor } = check(draft);
  if (amountMinor === undefined || Object.keys(errors).length > 0) {
    return { body: undefined, errors };
  }
  const body = {
    bookId: draft.bookId || null,
    fromUserId: draft.fromUserId,
    toUserId: draft.toUserId,
    amountMinor,
    currency: draft.currency,
    date: draft.date,
    note: nullable(draft.note),
  };
  const result = createSettlementRequestSchema.safeParse(body);
  if (!result.success) {
    return {
      body: undefined,
      errors: issuesToErrors(result.error.issues, body),
    };
  }
  return { body: result.data, errors };
}

/** The request that changes `settlement` into the draft, with only what differs; an empty body means nothing changed. */
export function buildSettlementUpdate(
  draft: SettlementDraft,
  settlement: Settlement,
): BuiltBody<UpdateSettlementRequest> {
  const { errors, amountMinor } = check(draft);
  if (amountMinor === undefined || Object.keys(errors).length > 0) {
    return { body: undefined, errors };
  }
  const patch: Record<string, unknown> = {};
  if (draft.fromUserId !== settlement.fromUserId) {
    patch.fromUserId = draft.fromUserId;
  }
  if (draft.toUserId !== settlement.toUserId) patch.toUserId = draft.toUserId;
  if (amountMinor !== settlement.amountMinor) patch.amountMinor = amountMinor;
  if (draft.currency !== settlement.currency) patch.currency = draft.currency;
  if (draft.date !== settlement.date) patch.date = draft.date;
  if ((draft.bookId || null) !== settlement.bookId) {
    patch.bookId = draft.bookId || null;
  }
  if (nullable(draft.note) !== settlement.note) {
    patch.note = nullable(draft.note);
  }
  if (Object.keys(patch).length === 0) return { body: {}, errors };
  const result = updateSettlementRequestSchema.safeParse(patch);
  if (!result.success) {
    return {
      body: undefined,
      errors: issuesToErrors(result.error.issues, patch),
    };
  }
  return { body: result.data, errors };
}

/** The filters of the payments list (the book follows the switcher above it). */
export type SettlementFilters = {
  /** `""` for every book. */
  bookId: string;
  /** `null` for every year. */
  year: number | null;
  /** A user id, or `me`; empty for everybody. */
  person: string;
};

export function parseSettlementFilters(
  params: URLSearchParams,
): SettlementFilters {
  const yearText = params.get("year") ?? "";
  const year = /^\d{4}$/.test(yearText) ? Number(yearText) : null;
  return {
    bookId: parseBookParam(params.get("book")) ?? "",
    year: year !== null && year >= MIN_YEAR && year <= MAX_YEAR ? year : null,
    person: (params.get("person") ?? "").trim(),
  };
}

export function settlementFilterQuery(filters: SettlementFilters): string {
  const params = new URLSearchParams();
  params.set("book", bookParam(filters.bookId));
  if (filters.year !== null) params.set("year", String(filters.year));
  if (filters.person) params.set("person", filters.person);
  return `?${params.toString()}`;
}

export function settlementsQuery(filters: SettlementFilters, cursor?: string) {
  return {
    limit: 200,
    ...(cursor ? { cursor } : {}),
    ...(filters.bookId ? { bookId: filters.bookId } : {}),
    ...(filters.year !== null ? { year: filters.year } : {}),
    ...(filters.person ? { userId: filters.person } : {}),
  };
}

/** Whether the list is narrowed by something besides the book. */
export function settlementFiltersActive(filters: SettlementFilters): boolean {
  return filters.year !== null || filters.person !== "";
}
