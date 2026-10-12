import type { CostBalances } from "$lib/api/schemas/costs";
import { formatMoney } from "$lib/format-money";
import { m } from "$lib/paraglide/messages";

export type BalancePerson = CostBalances["people"][number];
export type SuggestedPayment = CostBalances["suggestedPayments"][number];

/** Where a person stands: the others owe them (`credit`), they owe the others (`debit`) or neither. */
export type BalanceTone = "credit" | "debit" | "even";

export function balanceTone(balanceMinor: number): BalanceTone {
  return balanceMinor > 0 ? "credit" : balanceMinor < 0 ? "debit" : "even";
}

/** The name of a person the API could not name (a user without a display name is rare, but possible). */
export function personName(name: string | null): string {
  return name ?? m.cost_person_unknown();
}

/** A person's balance in a few words: "bekommt CHF 25.00", "schuldet CHF 12.50" or "ausgeglichen". */
export function balanceWording(
  balanceMinor: number,
  currency: string,
): { tone: BalanceTone; text: string } {
  const tone = balanceTone(balanceMinor);
  const amount = formatMoney(Math.abs(balanceMinor), currency);
  return {
    tone,
    text:
      tone === "credit"
        ? m.balances_gets({ amount })
        : tone === "debit"
          ? m.balances_owes({ amount })
          : m.balances_even(),
  };
}

/** The same for the person looking: "Du bekommst CHF 25.00", "Du schuldest CHF 12.50" or "Du bist ausgeglichen". */
export function youWording(
  balanceMinor: number,
  currency: string,
): { tone: BalanceTone; text: string } {
  const tone = balanceTone(balanceMinor);
  const amount = formatMoney(Math.abs(balanceMinor), currency);
  return {
    tone,
    text:
      tone === "credit"
        ? m.balances_you_get({ amount })
        : tone === "debit"
          ? m.balances_you_owe({ amount })
          : m.balances_you_even(),
  };
}

/** A suggested payment as a sentence: "Anna schuldet Ben CHF 12.50". */
export function paymentSentence(
  payment: Pick<SuggestedPayment, "fromName" | "toName" | "amountMinor">,
  currency: string,
): string {
  return m.balances_owes_sentence({
    from: personName(payment.fromName),
    to: personName(payment.toName),
    amount: formatMoney(payment.amountMinor, currency),
  });
}

/** Whether anything was ever paid, shared or settled, so that "all square" means something. */
export function hasBalanceData(
  balances: Pick<CostBalances, "people">,
): boolean {
  return balances.people.some(
    (p) =>
      p.paidMinor !== 0 ||
      p.shareMinor !== 0 ||
      p.sentMinor !== 0 ||
      p.receivedMinor !== 0,
  );
}

/** `empty`: nothing to settle yet, `square`: everything is even, `open`: somebody owes somebody. */
export function balanceState(
  balances: Pick<CostBalances, "people" | "suggestedPayments">,
): "empty" | "square" | "open" {
  if (balances.suggestedPayments.length > 0) return "open";
  return hasBalanceData(balances) ? "square" : "empty";
}

/** The viewer's own line, or `undefined` when they are not among the people (cannot happen for a member). */
export function personOf(
  balances: Pick<CostBalances, "people">,
  userId: string,
): BalancePerson | undefined {
  return balances.people.find((p) => p.userId === userId);
}

/**
 * The line for the person looking ("Du bekommst CHF 25.00"); `null` before anything happened or when they are not
 * among the people (cannot happen for a member).
 */
export function viewerLine(
  balances: Pick<CostBalances, "people" | "suggestedPayments" | "currency">,
  userId: string,
): { tone: BalanceTone; text: string } | null {
  const person = personOf(balances, userId);
  if (!person || balanceState(balances) === "empty") return null;
  return youWording(person.balanceMinor, balances.currency);
}

/**
 * The note of a single book's balances about the recorded payments across all books, which they cannot attribute and so
 * leave out: how many there are and what they add up to. `null` for the view of all books, which includes them, and
 * when there are none.
 */
export function crossBookNote(
  balances: Pick<CostBalances, "crossBookSettlements" | "currency">,
): string | null {
  const cross = balances.crossBookSettlements;
  if (!cross || cross.count <= 0) return null;
  return m.balances_cross_book({
    count: cross.count,
    amount: formatMoney(cross.totalMinor, balances.currency),
  });
}
