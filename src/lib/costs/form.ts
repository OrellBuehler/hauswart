import {
  COST_CATEGORY_COUNTS_AS_EXPENSE,
  type CostCategory,
  type CostDeductible,
  type CostSplitMode,
} from "$lib/api/enums";
import {
  MAX_COST_MINOR,
  SHARE_BPS_TOTAL,
  createCostRequestSchema,
  updateCostRequestSchema,
  type CostEntry,
  type CreateCostRequest,
  type UpdateCostRequest,
} from "$lib/api/schemas/costs";
import type { CostBook } from "$lib/api/schemas/cost-books";
import { currencySchema } from "$lib/api/schemas/household";
import { isValidDate } from "$lib/dates";
import { formatMoney, readMoney } from "$lib/format-money";
import {
  allocate,
  currencyExponent,
  minor,
  parseSharePercent,
  shareToInput,
  toDecimalString,
} from "$lib/money";
import { m } from "$lib/paraglide/messages";
import { issuesToErrors } from "$lib/tasks/field-errors";
import { defaultBook, openBooks } from "./books";

export type CostShareItem = { userId: string; shareBps: number };

/** What the form edits. Text fields stay text until they are checked on submit. */
export type CostDraft = {
  /** The book the entry is booked into; empty only when no book is known (the server then takes its default). */
  bookId: string;
  title: string;
  /** The amount as typed. The sign comes from `refund`, or from a minus in the text. */
  amount: string;
  refund: boolean;
  currency: string;
  date: string;
  category: CostCategory;
  assetId: string;
  roomId: string;
  defectId: string;
  serviceLogId: string;
  payee: string;
  notes: string;
  paidByUserId: string;
  splitMode: CostSplitMode;
  /** The person chose the split by hand, so picking another book no longer changes it. */
  splitTouched: boolean;
  /** Who shares an equal split (user ids); everybody unless the person narrows it. */
  participants: string[];
  /** Percent as typed, per user id. Blank or 0 means the person bears nothing. */
  shares: Record<string, string>;
  countsAsExpense: boolean;
  /** The switch was set by hand (or the stored value differs from the category's default). */
  countsTouched: boolean;
  deductible: CostDeductible;
};

export type NewDraftDefaults = {
  today: string;
  currency: string;
  /** The person adding the cost, who is most likely the one who paid. */
  paidByUserId: string;
  userIds: string[];
  /** Every cost book; the entry goes to `bookId` when that one takes entries, else to the default book. */
  books?: readonly CostBook[] | undefined;
  bookId?: string | undefined;
  assetId?: string | undefined;
  roomId?: string | undefined;
  defectId?: string | undefined;
  serviceLogId?: string | undefined;
};

/** Percent texts that split 100% over the people as evenly as possible (the remainder goes to the first ones). */
export function equalShares(
  userIds: readonly string[],
): Record<string, string> {
  if (userIds.length === 0) return {};
  const parts = allocate(
    minor(SHARE_BPS_TOTAL),
    userIds.map(() => 1),
  );
  return Object.fromEntries(
    userIds.map((id, i) => [id, shareToInput(parts[i] as number)]),
  );
}

export function sharesToInputs(
  shares: readonly CostShareItem[],
  userIds: readonly string[],
): Record<string, string> {
  const byUser = new Map(shares.map((s) => [s.userId, s.shareBps]));
  return Object.fromEntries(
    userIds.map((id) => {
      const bps = byUser.get(id);
      return [id, bps === undefined ? "" : shareToInput(bps)];
    }),
  );
}

/**
 * The split after a book was picked. A new entry takes the book's default split unless the person already chose a
 * split by hand; an entry that exists keeps the split it has.
 */
export function splitAfterBook(
  current: Pick<CostDraft, "splitMode" | "splitTouched">,
  book: Pick<CostBook, "defaultSplitMode"> | undefined,
  isNew: boolean,
): CostSplitMode {
  return book && isNew && !current.splitTouched
    ? book.defaultSplitMode
    : current.splitMode;
}

/** The draft after a book was picked (see `splitAfterBook`). */
export function withBook(
  draft: CostDraft,
  book: Pick<CostBook, "id" | "defaultSplitMode"> | undefined,
  isNew: boolean,
): CostDraft {
  if (!book) return draft;
  return {
    ...draft,
    bookId: book.id,
    splitMode: splitAfterBook(draft, book, isNew),
  };
}

export function newDraft(defaults: NewDraftDefaults): CostDraft {
  const books = defaults.books ?? [];
  const wanted = openBooks(books).find((b) => b.id === defaults.bookId);
  const book = wanted ?? defaultBook(books);
  return {
    bookId: book?.id ?? "",
    title: "",
    amount: "",
    refund: false,
    currency: defaults.currency,
    date: defaults.today,
    category: "other",
    assetId: defaults.assetId ?? "",
    roomId: defaults.roomId ?? "",
    defectId: defaults.defectId ?? "",
    serviceLogId: defaults.serviceLogId ?? "",
    payee: "",
    notes: "",
    paidByUserId: defaults.paidByUserId,
    splitMode: book?.defaultSplitMode ?? "ownership",
    splitTouched: false,
    participants: [...defaults.userIds],
    shares: equalShares(defaults.userIds),
    countsAsExpense: COST_CATEGORY_COUNTS_AS_EXPENSE.other,
    countsTouched: false,
    deductible: "unknown",
  };
}

/** The people an equal split is among: those that carry a share of it; everybody for any other split. */
export function entryParticipants(
  entry: Pick<CostEntry, "splitMode" | "shares">,
  userIds: readonly string[],
): string[] {
  if (entry.splitMode !== "equal" || entry.shares.length === 0) {
    return [...userIds];
  }
  const sharing = new Set(entry.shares.map((share) => share.userId));
  return userIds.filter((id) => sharing.has(id));
}

export function draftFromEntry(
  entry: CostEntry,
  userIds: readonly string[],
): CostDraft {
  return {
    bookId: entry.bookId,
    title: entry.title,
    amount: toDecimalString(
      minor(Math.abs(entry.amountMinor)),
      currencyExponent(entry.currency),
    ),
    refund: entry.amountMinor < 0,
    currency: entry.currency,
    date: entry.date,
    category: entry.category,
    assetId: entry.assetId ?? "",
    roomId: entry.roomId ?? "",
    defectId: entry.defectId ?? "",
    serviceLogId: entry.serviceLogId ?? "",
    payee: entry.payee ?? "",
    notes: entry.notes ?? "",
    paidByUserId: entry.paidByUserId ?? "",
    splitMode: entry.splitMode,
    splitTouched: true,
    participants: entryParticipants(entry, userIds),
    shares:
      entry.shares.length > 0
        ? sharesToInputs(entry.shares, userIds)
        : equalShares(userIds),
    countsAsExpense: entry.countsAsExpense,
    countsTouched:
      entry.countsAsExpense !== COST_CATEGORY_COUNTS_AS_EXPENSE[entry.category],
    deductible: entry.deductible,
  };
}

const ZERO = /^(?:0+(?:[.,]0*)?|[.,]0+)\s*%?$/;

export type ParsedShares = {
  items: CostShareItem[];
  totalBps: number;
  /** People whose text is not a percentage. */
  invalid: string[];
};

/** Reads the percent texts of the given people, in that order. Blank and 0 mean "bears nothing". */
export function parseShares(
  inputs: Record<string, string>,
  userIds: readonly string[],
): ParsedShares {
  const items: CostShareItem[] = [];
  const invalid: string[] = [];
  for (const userId of userIds) {
    const text = (inputs[userId] ?? "").trim();
    if (text === "" || ZERO.test(text)) continue;
    try {
      items.push({ userId, shareBps: parseSharePercent(text) });
    } catch (err) {
      if (!(err instanceof SyntaxError || err instanceof RangeError)) throw err;
      invalid.push(userId);
    }
  }
  return {
    items,
    totalBps: items.reduce((sum, s) => sum + s.shareBps, 0),
    invalid,
  };
}

export type CheckedShares = { items: CostShareItem[]; error?: string };

/** Custom shares must be percentages that add up to exactly 100%. */
export function validateShares(
  inputs: Record<string, string>,
  userIds: readonly string[],
): CheckedShares {
  const parsed = parseShares(inputs, userIds);
  if (parsed.invalid.length > 0) {
    return { items: parsed.items, error: m.cost_shares_invalid() };
  }
  if (parsed.items.length === 0) {
    return { items: parsed.items, error: m.cost_shares_empty() };
  }
  if (parsed.totalBps !== SHARE_BPS_TOTAL) {
    return {
      items: parsed.items,
      error: m.cost_shares_sum({ total: shareToInput(parsed.totalBps) }),
    };
  }
  return { items: parsed.items };
}

export type ParsedAmount =
  { ok: true; amountMinor: number } | { ok: false; error: string };

/** The signed amount in minor units: a refund is negative, and so is anything typed with a minus. */
export function parseDraftAmount(
  amount: string,
  refund: boolean,
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
  if (value === 0) return { ok: false, error: m.cost_amount_zero() };
  if (Math.abs(value) > MAX_COST_MINOR) {
    return {
      ok: false,
      error: m.cost_amount_too_large({
        max: formatMoney(MAX_COST_MINOR, currency),
      }),
    };
  }
  return { ok: true, amountMinor: refund ? -Math.abs(value) : value };
}

/** Each person's part of an amount, the way the server divides it (by user id, largest remainder). */
export function sharePreview(
  amountMinor: number,
  items: readonly CostShareItem[],
): Map<string, number> {
  const sorted = [...items].sort((a, b) => a.userId.localeCompare(b.userId));
  if (sorted.length === 0) return new Map();
  const parts = allocate(
    minor(amountMinor),
    sorted.map((s) => s.shareBps),
  );
  return new Map(sorted.map((s, i) => [s.userId, parts[i] as number]));
}

/**
 * Each ticked person's part of an equal split, the way the server books it: the 10000 basis points are divided first
 * (largest remainder, the people in id order, so the first by id takes a leftover basis point), then the amount by those
 * shares. Dividing the amount by head count directly would show 100.00 three times for 300.00 where the entry gets
 * 100.02, 99.99 and 99.99.
 */
export function equalPreview(
  amountMinor: number,
  participantIds: readonly string[],
): Map<string, number> {
  const ids = [...participantIds].sort((a, b) => a.localeCompare(b));
  if (ids.length === 0) return new Map();
  const bps = allocate(
    minor(SHARE_BPS_TOTAL),
    ids.map(() => 1),
  );
  return sharePreview(
    amountMinor,
    ids.map((userId, i) => ({ userId, shareBps: bps[i] as number })),
  );
}

type Checked = {
  errors: Record<string, string>;
  amountMinor: number | undefined;
  shares: CostShareItem[];
  participants: string[];
};

function check(draft: CostDraft, userIds: readonly string[]): Checked {
  const errors: Record<string, string> = {};
  if (!draft.title.trim()) errors.title = m.field_required();
  if (!currencySchema.safeParse(draft.currency).success) {
    errors.currency = m.cost_currency_invalid();
  }
  const amount = parseDraftAmount(draft.amount, draft.refund, draft.currency);
  if (!amount.ok && !errors.currency) errors.amountMinor = amount.error;
  if (!draft.date) errors.date = m.field_required();
  else if (!isValidDate(draft.date)) errors.date = m.field_invalid_date();

  let shares: CostShareItem[] = [];
  if (draft.splitMode === "custom") {
    const checked = validateShares(draft.shares, userIds);
    shares = checked.items;
    if (checked.error) errors.shares = checked.error;
  }
  const participants = chosenParticipants(draft, userIds);
  if (draft.splitMode === "equal" && participants.length === 0) {
    errors.participantIds = m.cost_for_whom_none();
  }
  return {
    errors,
    amountMinor: amount.ok ? amount.amountMinor : undefined,
    shares,
    participants,
  };
}

/** The people ticked in "Für wen", in the order of the household. */
export function chosenParticipants(
  draft: Pick<CostDraft, "participants">,
  userIds: readonly string[],
): string[] {
  const ticked = new Set(draft.participants);
  return userIds.filter((id) => ticked.has(id));
}

/** `participantIds` of an equal split: only when it is narrowed, everybody otherwise (and so everybody who joins later). */
export function narrowedParticipants(
  participants: readonly string[],
  userIds: readonly string[],
): string[] | undefined {
  return participants.length > 0 && participants.length < userIds.length
    ? [...participants]
    : undefined;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/** The book a draft goes to: the one it names, else the one the server would pick (unknown when no books are loaded). */
function bookOf(
  draft: Pick<CostDraft, "bookId">,
  books: readonly CostBook[],
): CostBook | undefined {
  return (
    books.find((book) => book.id === draft.bookId) ??
    (draft.bookId === "" ? defaultBook(books) : undefined)
  );
}

/** Whether the tax class means anything for the draft's book; when the book is not known, the draft says. */
export function taxClassApplies(
  draft: Pick<CostDraft, "bookId">,
  books: readonly CostBook[],
): boolean {
  return bookOf(draft, books)?.taxRelevant ?? true;
}

export type BuiltBody<T> = {
  body: T | undefined;
  errors: Record<string, string>;
};

function nullable(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

/** The request for a new entry, or the errors that stop it. */
export function buildCreateBody(
  draft: CostDraft,
  userIds: readonly string[],
  books: readonly CostBook[] = [],
): BuiltBody<CreateCostRequest> {
  const { errors, amountMinor, shares, participants } = check(draft, userIds);
  if (amountMinor === undefined || Object.keys(errors).length > 0) {
    return { body: undefined, errors };
  }
  const narrowed =
    draft.splitMode === "equal"
      ? narrowedParticipants(participants, userIds)
      : undefined;
  const body = {
    ...(draft.bookId ? { bookId: draft.bookId } : {}),
    date: draft.date,
    title: draft.title.trim(),
    amountMinor,
    currency: draft.currency,
    category: draft.category,
    assetId: draft.assetId || null,
    roomId: draft.roomId || null,
    defectId: draft.defectId || null,
    serviceLogId: draft.serviceLogId || null,
    payee: nullable(draft.payee),
    notes: nullable(draft.notes),
    paidByUserId: draft.paidByUserId || null,
    splitMode: draft.splitMode,
    ...(draft.splitMode === "custom" ? { shares } : {}),
    ...(narrowed ? { participantIds: narrowed } : {}),
    countsAsExpense: draft.countsAsExpense,
    // A book that is not tax relevant refuses a tax class, whatever the form held before the book was changed.
    deductible: taxClassApplies(draft, books) ? draft.deductible : "unknown",
  };
  const result = createCostRequestSchema.safeParse(body);
  if (!result.success) {
    return {
      body: undefined,
      errors: issuesToErrors(result.error.issues, body),
    };
  }
  return { body: result.data, errors };
}

function sameShares(
  a: readonly CostShareItem[],
  b: readonly CostShareItem[],
): boolean {
  if (a.length !== b.length) return false;
  const byUser = new Map(a.map((s) => [s.userId, s.shareBps]));
  return b.every((s) => byUser.get(s.userId) === s.shareBps);
}

/**
 * The request that changes `entry` into the draft, with only what differs.
 * An empty body means nothing changed; the date, amount, currency and device of an entry a fuel log
 * entry booked (`fuelLogId`) are never sent. Sending the split again would divide
 * the amount by today's ownership shares, so it goes only when the person
 * changed the mode or the custom shares.
 */
export function buildUpdateBody(
  draft: CostDraft,
  entry: CostEntry,
  userIds: readonly string[],
  books: readonly CostBook[] = [],
): BuiltBody<UpdateCostRequest> {
  const { errors, amountMinor, shares, participants } = check(draft, userIds);
  if (amountMinor === undefined || Object.keys(errors).length > 0) {
    return { body: undefined, errors };
  }
  const patch: Record<string, unknown> = {};
  const title = draft.title.trim();
  // A fuel log entry owns the date, amount, currency and device of the entry it booked: they stay with it.
  const owned = Boolean(entry.fuelLogId);
  if (draft.bookId && draft.bookId !== entry.bookId) {
    patch.bookId = draft.bookId;
  }
  if (!owned && draft.date !== entry.date) patch.date = draft.date;
  if (title !== entry.title) patch.title = title;
  if (!owned && amountMinor !== entry.amountMinor) {
    patch.amountMinor = amountMinor;
  }
  if (!owned && draft.currency !== entry.currency) {
    patch.currency = draft.currency;
  }
  if (draft.category !== entry.category) patch.category = draft.category;
  if (!owned && (draft.assetId || null) !== entry.assetId) {
    patch.assetId = draft.assetId || null;
  }
  if ((draft.roomId || null) !== entry.roomId) {
    patch.roomId = draft.roomId || null;
  }
  if ((draft.defectId || null) !== entry.defectId) {
    patch.defectId = draft.defectId || null;
  }
  if ((draft.serviceLogId || null) !== entry.serviceLogId) {
    patch.serviceLogId = draft.serviceLogId || null;
  }
  if (nullable(draft.payee) !== entry.payee)
    patch.payee = nullable(draft.payee);
  if (nullable(draft.notes) !== entry.notes)
    patch.notes = nullable(draft.notes);
  if ((draft.paidByUserId || null) !== entry.paidByUserId) {
    patch.paidByUserId = draft.paidByUserId || null;
  }
  const narrowed =
    draft.splitMode === "equal"
      ? narrowedParticipants(participants, userIds)
      : undefined;
  if (draft.splitMode !== entry.splitMode) {
    patch.splitMode = draft.splitMode;
    if (draft.splitMode === "custom") patch.shares = shares;
    if (narrowed) patch.participantIds = narrowed;
  } else if (
    draft.splitMode === "custom" &&
    !sameShares(shares, entry.shares)
  ) {
    patch.shares = shares;
  } else if (
    draft.splitMode === "equal" &&
    !sameIds(participants, entryParticipants(entry, userIds))
  ) {
    // An equal split is divided again among the people now ticked; without `participantIds` that is everybody.
    patch.splitMode = "equal";
    if (narrowed) patch.participantIds = narrowed;
  }
  // The server moves the flag along with a category change unless it is sent,
  // so a category change always carries what the person sees.
  if (
    draft.countsAsExpense !== entry.countsAsExpense ||
    draft.category !== entry.category
  ) {
    patch.countsAsExpense = draft.countsAsExpense;
  }
  // In a book that is not tax relevant the class is not offered, and the server keeps or resets it by itself.
  if (draft.deductible !== entry.deductible && taxClassApplies(draft, books)) {
    patch.deductible = draft.deductible;
  }

  if (Object.keys(patch).length === 0) return { body: {}, errors };
  const result = updateCostRequestSchema.safeParse(patch);
  if (!result.success) {
    return {
      body: undefined,
      errors: issuesToErrors(result.error.issues, patch),
    };
  }
  return { body: result.data, errors };
}
