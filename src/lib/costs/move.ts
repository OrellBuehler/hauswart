import { isApiError } from "$lib/api/errors";
import type { CostBook } from "$lib/api/schemas/cost-books";
import {
  MOVE_COSTS_MAX_IDS,
  type CostEntry,
  type MoveCostsToBookRequest,
  type MoveCostsToBookResult,
} from "$lib/api/schemas/costs";
import { apiErrorMessage } from "$lib/error-message";
import { m } from "$lib/paraglide/messages";
import { apiFieldErrors } from "$lib/tasks/field-errors";
import { openBooks } from "./books";

/** What a move applies to: the entries picked in the list, or every entry of a device. */
export type MoveTarget = { ids: string[] } | { assetId: string };

/** The request for `POST /costs/move-to-book`; an entry named twice counts once. `dryRun` asks what it would do, no more. */
export function moveRequest(
  bookId: string,
  target: MoveTarget,
  options: { dryRun?: boolean } = {},
): MoveCostsToBookRequest {
  const request: MoveCostsToBookRequest =
    "assetId" in target
      ? { bookId, assetId: target.assetId }
      : { bookId, ids: [...new Set(target.ids)] };
  return options.dryRun ? { ...request, dryRun: true } : request;
}

/** Every entry of the list, as far as one request moves them; `truncated` says there were more. */
export function pickAll(entries: readonly Pick<CostEntry, "id">[]): {
  ids: string[];
  truncated: boolean;
} {
  return {
    ids: entries.slice(0, MOVE_COSTS_MAX_IDS).map((entry) => entry.id),
    truncated: entries.length > MOVE_COSTS_MAX_IDS,
  };
}

/** The book to start from: one that takes entries and that none of the entries is in, else the first that does. */
export function suggestedTarget(
  books: readonly CostBook[],
  entries: readonly Pick<CostEntry, "bookId">[],
): string {
  const open = openBooks(books);
  const taken = new Set(entries.map((entry) => entry.bookId));
  return (open.find((book) => !taken.has(book.id)) ?? open[0])?.id ?? "";
}

/** How many entries lose their tax class when moved into `book`: those that have one, when the book is not tax relevant. */
export function taxClassLost(
  entries: readonly Pick<CostEntry, "deductible">[],
  book: Pick<CostBook, "taxRelevant"> | undefined,
): number {
  if (!book || book.taxRelevant) return 0;
  return entries.filter((entry) => entry.deductible !== "unknown").length;
}

/** "2025" for one year, "2024–2026" for a span. */
export function yearsLabel(years: { from: number; to: number }): string {
  return years.from === years.to
    ? String(years.from)
    : `${years.from}\u2013${years.to}`;
}

/**
 * What a move would do, in one line, from the answer to a dry run: "23 Einträge aus 2024–2026, 5 verlieren ihre
 * Steuerklasse". What is zero is left out; everything there already, or nothing at all, is said plainly.
 */
export function movePreview(result: MoveCostsToBookResult): string {
  if (result.moved === 0) {
    return result.unchanged === 0
      ? m.costs_move_nothing()
      : m.costs_move_preview_none();
  }
  const parts = [
    m.costs_move_preview_entries({
      count: result.moved,
      years: result.years ? yearsLabel(result.years) : "",
    }),
  ];
  if (result.deductibleReset > 0) {
    parts.push(m.costs_move_preview_reset({ count: result.deductibleReset }));
  }
  if (result.unchanged > 0) {
    parts.push(m.costs_move_unchanged({ count: result.unchanged }));
  }
  return parts.join(", ");
}

/** What a move did in one line; what is zero is left out. */
export function moveSummary(
  result: MoveCostsToBookResult,
  bookName: string,
): string {
  if (result.moved === 0 && result.unchanged === 0) {
    return m.costs_move_nothing();
  }
  const parts = [
    result.moved > 0
      ? m.costs_move_moved({ count: result.moved, book: bookName })
      : m.costs_move_none({ book: bookName }),
  ];
  if (result.moved > 0 && result.unchanged > 0) {
    parts.push(m.costs_move_unchanged({ count: result.unchanged }));
  }
  if (result.deductibleReset > 0) {
    parts.push(m.costs_move_reset({ count: result.deductibleReset }));
  }
  return parts.join(" · ");
}

/** Why a move failed, in words, and the field it is about when there is one (400 on `bookId`, `ids` or `assetId`). */
export function moveFailure(err: unknown): { message: string; field?: string } {
  if (isApiError(err) && err.code === "invalid_request") {
    const fields = apiFieldErrors(err);
    if ("bookId" in fields) {
      return { message: m.costs_move_book_closed(), field: "bookId" };
    }
    if ("ids" in fields) return { message: m.costs_move_ids_gone() };
    if ("assetId" in fields) return { message: m.costs_move_asset_gone() };
  }
  return { message: apiErrorMessage(err) };
}
