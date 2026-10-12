import type { z } from "zod";
import type { CostCategory, CostSplitMode } from "$lib/api/enums";
import { isApiError } from "$lib/api/errors";
import {
  AI_TASK_NOTE_MAX,
  createAiTaskRequestSchema,
} from "$lib/api/schemas/ai-tasks";
import type { CostBook } from "$lib/api/schemas/cost-books";
import {
  COST_TITLE_MAX,
  createCostRequestSchema,
  type CostEntry,
  type CreateCostRequest,
} from "$lib/api/schemas/costs";
import { isValidDate } from "$lib/dates";
import { apiErrorMessage } from "$lib/error-message";
import { formatList } from "$lib/format";
import { m } from "$lib/paraglide/messages";
import { issuesToErrors } from "$lib/tasks/field-errors";
import { defaultBook, openBooks } from "./books";
import { parseDraftAmount, type BuiltBody } from "./form";

/** The two things the quick page does: book an expense now, or put a receipt in the queue for later. */
export type QuickMode = "expense" | "receipt";

/** `?mode=receipt` opens the receipt; anything else is the expense. */
export function parseQuickMode(value: string | null | undefined): QuickMode {
  return value === "receipt" ? "receipt" : "expense";
}

/** What the quick entry reads of the recent entries to rank the categories. */
export type CategoryHistory = Pick<CostEntry, "bookId" | "category">;

/** Everyday spending first, for a book that has no history of its own yet. */
const EVERYDAY_ORDER: readonly CostCategory[] = [
  "groceries",
  "household",
  "dining",
  "transport",
  "leisure",
  "health",
  "gifts",
  "travel",
  "subscriptions",
  "fuel",
  "repair",
  "maintenance",
  "utilities",
  "insurance",
  "purchase",
  "renovation",
  "taxes_fees",
  "renewal_fund",
  "mortgage_interest",
  "mortgage_principal",
  "other",
];

/** The same for a tax relevant book (the apartment): the costs of owning it first. */
const APARTMENT_ORDER: readonly CostCategory[] = [
  "repair",
  "maintenance",
  "utilities",
  "insurance",
  "renovation",
  "purchase",
  "taxes_fees",
  "renewal_fund",
  "mortgage_interest",
  "mortgage_principal",
  "household",
  "groceries",
  "dining",
  "transport",
  "leisure",
  "health",
  "gifts",
  "travel",
  "subscriptions",
  "fuel",
  "other",
];

/** The orders every category appears in exactly once (a test pins that against `COST_CATEGORIES`). */
export const CATEGORY_ORDERS = {
  everyday: EVERYDAY_ORDER,
  apartment: APARTMENT_ORDER,
} as const;

export type RankOptions = {
  /** The book the entry goes to: what it was used for there counts first. */
  bookId?: string | undefined;
  /** Without history the order depends on the kind of book. */
  taxRelevant?: boolean | undefined;
};

/**
 * Every category, the most used first: by how often the recent entries of the book used it, then how often all recent
 * entries did, then the fixed order for the kind of book. Categories never used keep that order behind the used ones.
 */
export function rankCategories(
  history: readonly CategoryHistory[],
  options: RankOptions = {},
): CostCategory[] {
  const inBook = new Map<CostCategory, number>();
  const overall = new Map<CostCategory, number>();
  for (const entry of history) {
    overall.set(entry.category, (overall.get(entry.category) ?? 0) + 1);
    if (options.bookId !== undefined && entry.bookId === options.bookId) {
      inBook.set(entry.category, (inBook.get(entry.category) ?? 0) + 1);
    }
  }
  const order = options.taxRelevant ? APARTMENT_ORDER : EVERYDAY_ORDER;
  return [...order].sort(
    (a, b) =>
      (inBook.get(b) ?? 0) - (inBook.get(a) ?? 0) ||
      (overall.get(b) ?? 0) - (overall.get(a) ?? 0) ||
      order.indexOf(a) - order.indexOf(b),
  );
}

/** How many category chips show before "more". */
export const VISIBLE_CATEGORIES = 8;

/**
 * The chips on screen: the first few of the ranking (all of it once expanded), and the chosen category even when it is
 * not among them, so a pick made from the long list does not disappear when it is folded away again.
 */
export function chipCategories(
  ranked: readonly CostCategory[],
  options: {
    selected: CostCategory | "";
    expanded: boolean;
    visible?: number;
  },
): CostCategory[] {
  if (options.expanded) return [...ranked];
  const top = ranked.slice(0, options.visible ?? VISIBLE_CATEGORIES);
  return options.selected !== "" && !top.includes(options.selected)
    ? [...top, options.selected]
    : top;
}

/**
 * The book a quick entry starts in: the one the address names, else the one the last quick entry went to, else the one
 * the costs page showed last, else the default book. Only books that take entries count.
 */
export function chooseQuickBook(input: {
  requested?: string | null | undefined;
  lastUsed?: string | null | undefined;
  remembered?: string | null | undefined;
  books: readonly CostBook[];
}): string {
  const open = openBooks(input.books);
  for (const id of [input.requested, input.lastUsed, input.remembered]) {
    if (id && open.some((book) => book.id === id)) return id;
  }
  return defaultBook(input.books)?.id ?? "";
}

/** Who the entry is for when nobody changed the chips: everybody, or nobody in a book that does not share. */
export function defaultParticipants(
  book: Pick<CostBook, "defaultSplitMode"> | undefined,
  userIds: readonly string[],
): string[] {
  return book?.defaultSplitMode === "none" ? [] : [...userIds];
}

/** What the "for whom" chips ask the server for. */
export type QuickSplit =
  /** Nothing is sent: the entry gets the split of its book. */
  | { kind: "book_default" }
  /** Equal among the chosen people (`participantIds` left out: among everybody). */
  | { kind: "equal"; participantIds: string[] | undefined }
  /** The person chose "not shared" on purpose. */
  | { kind: "none" }
  /** Nobody is ticked in a book that shares and "not shared" was not chosen: not a choice, so nothing is sent yet. */
  | { kind: "unchosen" };

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/**
 * The split for the chips. The chips as they stand when the book is picked mean "the book's own split" and send nothing,
 * so an ownership book keeps splitting by ownership. Any other choice is an equal split among the people chosen
 * (everybody chosen in a book that does not share is an equal split too). Nobody ticked in a book that shares is not
 * guessed: it is `unchosen` until the person picks somebody or says "not shared" (`notShared`); in a book that does not
 * share, nobody ticked simply is the book's own "not shared".
 */
export function quickSplit(
  book: Pick<CostBook, "defaultSplitMode"> | undefined,
  participants: readonly string[],
  userIds: readonly string[],
  notShared = false,
): QuickSplit {
  const chosen = userIds.filter((id) => participants.includes(id));
  if (sameSet(chosen, defaultParticipants(book, userIds))) {
    return { kind: "book_default" };
  }
  if (chosen.length === 0)
    return notShared ? { kind: "none" } : { kind: "unchosen" };
  return {
    kind: "equal",
    participantIds: chosen.length < userIds.length ? chosen : undefined,
  };
}

/** The split in one sentence under the chips. */
export function splitSummary(
  split: QuickSplit,
  book: Pick<CostBook, "defaultSplitMode"> | undefined,
  chosenNames: readonly string[],
): string {
  const equalAll = m.quick_split_equal_all();
  switch (split.kind) {
    case "none":
      return m.quick_split_none();
    case "unchosen":
      return m.quick_split_unchosen();
    case "equal":
      return split.participantIds
        ? m.quick_split_equal_some({ names: formatList([...chosenNames]) })
        : equalAll;
    case "book_default": {
      const mode: CostSplitMode = book?.defaultSplitMode ?? "ownership";
      return mode === "none"
        ? m.quick_split_none()
        : mode === "equal"
          ? equalAll
          : m.quick_split_ownership();
    }
  }
}

export type QuickDraft = {
  /** The amount as typed; always an expense (a refund goes through the full form). */
  amount: string;
  category: CostCategory | "";
  /** Left empty, the title is the payee, else the category. */
  title: string;
  payee: string;
  date: string;
  bookId: string;
  paidByUserId: string;
  /** User ids ticked under "for whom". */
  participants: string[];
  /** The person ticked or cleared a chip, so picking another book no longer resets them. */
  participantsTouched: boolean;
  /** The person chose "not shared" (nobody ticked, on purpose); in a book that shares, nobody ticked is no choice. */
  notShared: boolean;
  assetId: string;
};

export function newQuickDraft(input: {
  today: string;
  bookId: string;
  paidByUserId: string;
  userIds: readonly string[];
  books: readonly CostBook[];
}): QuickDraft {
  const book = input.books.find((b) => b.id === input.bookId);
  return {
    amount: "",
    category: "",
    title: "",
    payee: "",
    date: input.today,
    bookId: input.bookId,
    paidByUserId: input.paidByUserId,
    participants: defaultParticipants(book, input.userIds),
    participantsTouched: false,
    notShared: false,
    assetId: "",
  };
}

/** The draft after another book was picked: who it is for follows the book unless the chips were touched. */
export function withQuickBook(
  draft: QuickDraft,
  bookId: string,
  books: readonly CostBook[],
  userIds: readonly string[],
): QuickDraft {
  if (draft.participantsTouched) return { ...draft, bookId };
  return {
    ...draft,
    bookId,
    participants: defaultParticipants(
      books.find((b) => b.id === bookId),
      userIds,
    ),
    notShared: false,
  };
}

/** The draft after the person ticked or cleared people: that is theirs now, and "not shared" ends (clearing the last one is no choice). */
export function withTicked(
  draft: QuickDraft,
  participants: readonly string[],
): QuickDraft {
  return {
    ...draft,
    participants: [...participants],
    participantsTouched: true,
    notShared: false,
  };
}

/** The draft after the person chose "not shared": nobody ticked, on purpose. */
export function withNotShared(draft: QuickDraft): QuickDraft {
  return {
    ...draft,
    participants: [],
    participantsTouched: true,
    notShared: true,
  };
}

/**
 * A typed amount with the separator left dangling ("12." or "12,") is read as the whole number; anything else is left to
 * the amount parser of the full form.
 */
export function cleanAmount(text: string): string {
  return text.trim().replace(/[.,]$/, "");
}

/** The title of an entry: what was typed, else the payee, else the name of the category; never longer than the API takes. */
export function quickTitle(
  draft: Pick<QuickDraft, "title" | "payee" | "category">,
  categoryLabel: (category: CostCategory) => string,
): string {
  const text =
    draft.title.trim() ||
    draft.payee.trim() ||
    (draft.category ? categoryLabel(draft.category) : "");
  return text.slice(0, COST_TITLE_MAX);
}

export type QuickContext = {
  currency: string;
  userIds: readonly string[];
  books: readonly CostBook[];
  categoryLabel: (category: CostCategory) => string;
  /** The key of this draft: the same save sent again returns the entry it booked the first time. */
  idempotencyKey?: string | undefined;
};

/** The request for a quick entry, or the errors that stop it (keyed by field: `amountMinor`, `category`, `date`, ...). */
export function buildQuickCostBody(
  draft: QuickDraft,
  context: QuickContext,
): BuiltBody<CreateCostRequest> {
  const errors: Record<string, string> = {};
  const amount = parseDraftAmount(
    cleanAmount(draft.amount),
    false,
    context.currency,
  );
  if (!amount.ok) errors.amountMinor = amount.error;
  if (draft.category === "") errors.category = m.quick_category_required();
  if (!draft.date) errors.date = m.field_required();
  else if (!isValidDate(draft.date)) errors.date = m.field_invalid_date();
  if (!amount.ok || draft.category === "" || Object.keys(errors).length > 0) {
    return { body: undefined, errors };
  }

  const book = context.books.find((b) => b.id === draft.bookId);
  const split = quickSplit(
    book,
    draft.participants,
    context.userIds,
    draft.notShared,
  );
  if (split.kind === "unchosen") {
    return {
      body: undefined,
      errors: { participants: m.quick_split_unchosen() },
    };
  }
  const payee = draft.payee.trim();
  const body = {
    ...(draft.bookId ? { bookId: draft.bookId } : {}),
    date: draft.date,
    title: quickTitle(draft, context.categoryLabel),
    amountMinor: amount.amountMinor,
    currency: context.currency,
    category: draft.category,
    ...(draft.assetId ? { assetId: draft.assetId } : {}),
    ...(payee ? { payee } : {}),
    paidByUserId: draft.paidByUserId || null,
    ...(context.idempotencyKey
      ? { idempotencyKey: context.idempotencyKey }
      : {}),
    ...(split.kind === "none" ? { splitMode: "none" as const } : {}),
    ...(split.kind === "equal"
      ? {
          splitMode: "equal" as const,
          ...(split.participantIds
            ? { participantIds: split.participantIds }
            : {}),
        }
      : {}),
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

export type ReceiptDraft = {
  note: string;
  /** The book the receipt is probably for; empty leaves it to whoever reads the receipt. */
  bookId: string;
  assetId: string;
};

export type ReceiptTaskInput = z.input<typeof createAiTaskRequestSchema>;

/** The multipart fields for putting a receipt in the queue, or the errors that stop it (`file`, `note`). */
export function buildReceiptTaskBody(
  draft: ReceiptDraft,
  file: File | null,
  idempotencyKey?: string,
): BuiltBody<ReceiptTaskInput> {
  const errors: Record<string, string> = {};
  if (!file) errors.file = m.quick_receipt_required();
  const note = draft.note.trim();
  if (note.length > AI_TASK_NOTE_MAX) {
    errors.note = m.field_too_long({ max: AI_TASK_NOTE_MAX });
  }
  if (!file || Object.keys(errors).length > 0) {
    return { body: undefined, errors };
  }
  return {
    body: {
      file,
      ...(note ? { note } : {}),
      ...(draft.bookId ? { bookId: draft.bookId } : {}),
      ...(draft.assetId ? { assetId: draft.assetId } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
    },
    errors,
  };
}

/** Whether the API refused because the draft's key already stands for another entry or receipt (a 409). */
export function isKeyConflict(err: unknown): boolean {
  return isApiError(err) && err.code === "conflict";
}

/**
 * Why a save failed. A request that never got an answer (the browser's own `TypeError`) may or may not have arrived, but
 * the key it carried makes sending it again safe, and the words say so. A key that stands for something else by now
 * (the draft was changed after a first attempt that did arrive) says where to look. A receipt only queues a photo, so
 * nothing is booked and the words point to the receipt list instead of the cost list.
 */
export function quickErrorMessage(
  err: unknown,
  mode: QuickMode = "expense",
): string {
  if (!isApiError(err) && err instanceof TypeError) {
    return mode === "receipt"
      ? m.quick_error_network_receipt()
      : m.quick_error_network();
  }
  if (isKeyConflict(err)) {
    return mode === "receipt"
      ? m.quick_error_key_used_receipt()
      : m.quick_error_key_used();
  }
  return apiErrorMessage(err);
}

/** The fields behind "Datum, Titel und mehr". */
const FOLDED_FIELDS = ["date", "title", "payee", "assetId"] as const;

/** Whether an error sits on a field that is folded away, so the section has to be opened for the person to see it. */
export function needsMoreSection(errors: Record<string, string>): boolean {
  return FOLDED_FIELDS.some((field) => field in errors);
}

/** The costs page for the book (and year, when it is not this one) an entry was booked into. */
export function savedCostsQuery(
  saved: Pick<CostEntry, "bookId" | "date">,
  today: string,
): string {
  const params = new URLSearchParams({ book: saved.bookId });
  const year = saved.date.slice(0, 4);
  if (year !== today.slice(0, 4)) params.set("year", year);
  return `?${params.toString()}`;
}
