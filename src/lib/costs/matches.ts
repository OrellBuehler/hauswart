import { isApiError } from "$lib/api/errors";
import type { FinanceSuggestion } from "$lib/api/schemas/finance";
import { currencySchema } from "$lib/api/schemas/household";
import { diffDays, isValidDate } from "$lib/dates";
import { m } from "$lib/paraglide/messages";
import { apiFieldErrors } from "$lib/tasks/field-errors";
import { MATCH_DAYS } from "./match";

/** A pending cost suggestion of the person's finance app that may be the entry being typed. */
export type FinanceMatch = Extract<FinanceSuggestion, { kind: "cost" }>;

/** The facts of the entry being typed that `GET /finance/matches` asks for. */
export type MatchQuery = {
  amountMinor: number;
  currency: string;
  /** `YYYY-MM-DD` */
  date: string;
};

/** How long the form waits after the last keystroke before it asks. */
export const MATCH_DEBOUNCE_MS = 400;

/**
 * What to ask for, or `null` while the form does not know enough: the amount has to be a valid, non-zero amount, the
 * currency three letters and the date a real calendar date. The amount keeps its sign (a refund only matches a refund).
 */
export function matchQuery(input: {
  amountMinor: number | undefined;
  currency: string;
  date: string;
}): MatchQuery | null {
  if (input.amountMinor === undefined || input.amountMinor === 0) return null;
  if (!currencySchema.safeParse(input.currency).success) return null;
  if (!isValidDate(input.date)) return null;
  return {
    amountMinor: input.amountMinor,
    currency: input.currency,
    date: input.date,
  };
}

/** The same address for the same question, so an unchanged form does not ask again. */
export function matchKey(query: MatchQuery | null): string {
  return query ? `${query.amountMinor}|${query.currency}|${query.date}` : "";
}

/**
 * Whether the transaction still fits the entry as typed: the same amount (sign included) and currency, booked at most
 * `MATCH_DAYS` days from the entry's date. It is the server's rule for `GET /finance/matches` and for tying, so a
 * choice that stops fitting can be dropped at once instead of being sent and refused.
 */
export function matchFits(match: FinanceMatch, query: MatchQuery): boolean {
  return (
    match.payload.amountMinor === query.amountMinor &&
    match.payload.currency === query.currency &&
    Math.abs(diffDays(match.payload.date, query.date)) <= MATCH_DAYS
  );
}

/** The matches that fit the entry as typed now, in the order the server gave them (nearest date first). */
export function fittingMatches(
  matches: readonly FinanceMatch[],
  query: MatchQuery | null,
): FinanceMatch[] {
  return query ? matches.filter((match) => matchFits(match, query)) : [];
}

/**
 * The choice the form may send: the id of the chosen match while it is among the fitting ones, else empty. A choice
 * made for an amount or date that was changed since is not sent.
 */
export function chosenId(
  selectedId: string,
  matches: readonly FinanceMatch[],
  query: MatchQuery | null,
): string {
  return selectedId !== "" &&
    fittingMatches(matches, query).some((match) => match.id === selectedId)
    ? selectedId
    : "";
}

/** How the bank's booking date lies to the date of the entry, in words ("am selben Tag", "1 Tag später"). */
export function matchWhen(match: FinanceMatch, query: MatchQuery): string {
  const days = diffDays(match.payload.date, query.date);
  if (days === 0) return m.match_same_day();
  return days > 0
    ? m.match_days_later({ count: days })
    : m.match_days_earlier({ count: -days });
}

/** The title of a match as the bank wrote it, with the payee when that says more. */
export function matchTitle(match: FinanceMatch): string {
  const { title, payee } = match.payload;
  return payee && !title.toLocaleLowerCase().includes(payee.toLocaleLowerCase())
    ? `${title} · ${payee}`
    : title;
}

export type TieRefusal = "changed" | "gone" | "decided";

/**
 * Whether the API refused the bank transaction that was sent with an entry, and why: the amount, currency or date moved
 * away from the transaction (400 on the field), the transaction is not there for this person (404), or it was decided in
 * the meantime (409). `undefined` when no transaction was sent or the failure is about something else.
 */
export function tieRefused(
  err: unknown,
  sent: boolean,
): TieRefusal | undefined {
  if (!sent || !isApiError(err)) return undefined;
  if (
    err.code === "invalid_request" &&
    "financeSuggestionId" in apiFieldErrors(err)
  ) {
    return "changed";
  }
  if (err.code === "not_found") return "gone";
  if (err.code === "conflict") return "decided";
  return undefined;
}

/** `tieRefused` in words, or `undefined` when the failure is not about the transaction. */
export function tieFailure(err: unknown, sent: boolean): string | undefined {
  switch (tieRefused(err, sent)) {
    case "changed":
      return m.match_error_changed();
    case "gone":
      return m.match_error_gone();
    case "decided":
      return m.match_error_decided();
    default:
      return undefined;
  }
}
