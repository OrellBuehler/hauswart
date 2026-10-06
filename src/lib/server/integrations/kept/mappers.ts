import type { KeptBill, KeptTransaction } from "./schemas";

/**
 * Pure mappers from Kept DTOs to plain "seeds" that hauswart's services turn
 * into tasks, cost entries and asset suggestions later. They know nothing of
 * hauswart's database types and never touch the network.
 */

/** Longest text a seed carries (hauswart's title and name limit). */
export const SEED_TEXT_MAX = 200;

export type TaskSeedStatus = "open" | "paid" | "cancelled" | "overdue";

export interface TaskSeed {
  /** The Kept bill id, stored opaquely as `externalRef`. */
  externalRef: string;
  title: string;
  dueDate: string | null;
  /** The invoiced total in minor units; null for a bill without a fixed amount. */
  amountMinor: number | null;
  /** What is still to pay (minor units); null without a fixed amount. */
  remainingMinor: number | null;
  currency: string;
  status: TaskSeedStatus;
  kind: KeptBill["kind"];
  url: string;
}

export interface CostSeed<C extends string = string> {
  externalRef: string;
  /** Booking date, `YYYY-MM-DD`. */
  date: string;
  /** Expenses are positive, refunds and reimbursements negative. */
  amountMinor: number;
  currency: string;
  payee: string | null;
  description: string | null;
  category: C;
  billIds: string[];
  url: string;
}

export interface AssetSuggestion {
  externalRef: string;
  name: string;
  /** Booking date, `YYYY-MM-DD`. */
  purchaseDate: string;
  /** Always positive. */
  priceMinor: number;
  currency: string;
  url: string;
}

function clean(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text === "" ? null : text;
}

function clip(text: string, max = SEED_TEXT_MAX): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

/** `-x` that never yields `-0`. */
function negate(value: number): number {
  return value === 0 ? 0 : -value;
}

/**
 * Task status of a bill. Decisions:
 * - `cancelled` stays `cancelled`.
 * - A credit note is something to receive, never something to pay: it is
 *   `paid` (no action for the household) whatever its Kept status or due date.
 * - `paid` and `overpaid` are `paid`. `credit_due` (an overpaid invoice or a
 *   credit note awaiting its refund) is `paid` as well: nothing is left to
 *   pay; callers that care about the refund can read `kind` and `remainingMinor`.
 * - `open` and `partially_paid` are `overdue` when Kept flags the bill overdue,
 *   else `open`.
 */
export function taskStatusOf(bill: KeptBill): TaskSeedStatus {
  if (bill.status === "cancelled") return "cancelled";
  if (bill.kind === "credit_note") return "paid";
  switch (bill.status) {
    case "paid":
    case "overpaid":
    case "credit_due":
      return "paid";
    case "open":
    case "partially_paid":
      return bill.overdue ? "overdue" : "open";
  }
}

/** `Creditor: invoice number`, without a dangling colon; `?` when the creditor is unknown. */
export function billTitle(bill: KeptBill): string {
  const creditor = clean(bill.creditorName) ?? "?";
  const number = clean(bill.invoiceNumber);
  return clip(number === null ? creditor : `${creditor}: ${number}`);
}

export function billToTaskSeed(bill: KeptBill): TaskSeed {
  return {
    externalRef: bill.id,
    title: billTitle(bill),
    dueDate: bill.dueDate,
    amountMinor: bill.amount,
    remainingMinor: bill.remainingAmount,
    currency: bill.currency,
    status: taskStatusOf(bill),
    kind: bill.kind,
    url: bill.url,
  };
}

/**
 * A transaction as a cost entry, only when its Kept category is mapped.
 * `categoryMap` is keyed by Kept category id; other ids (and transactions
 * without a category) give null.
 */
export function transactionToCostSeed<C extends string>(
  tx: KeptTransaction,
  categoryMap: Readonly<Record<string, C>>,
): CostSeed<C> | null {
  if (tx.categoryId === null) return null;
  if (!Object.hasOwn(categoryMap, tx.categoryId)) return null;
  const category = categoryMap[tx.categoryId]!;
  return {
    externalRef: tx.id,
    date: tx.bookingDate,
    amountMinor: negate(tx.amount),
    currency: tx.currency,
    payee: clean(tx.counterpartyName),
    description: clean(tx.description),
    category,
    billIds: [...tx.billIds],
    url: tx.url,
  };
}

/** CHF 100 (minor units). */
export const DEFAULT_ASSET_MIN_PRICE_MINOR = 10_000;

export interface AssetSuggestionOptions {
  /** Smallest outgoing amount (minor units of the transaction's currency) worth suggesting. */
  minPriceMinor?: number;
}

/**
 * Heuristic: an outgoing payment of at least `minPriceMinor` in one of the
 * `purchaseCategoryIds` (Kept category ids the household treats as purchases)
 * may be a device or furniture worth an inventory entry. Refunds, small
 * amounts and other categories give null.
 */
export function transactionToAssetSuggestion(
  tx: KeptTransaction,
  purchaseCategoryIds: ReadonlySet<string> | readonly string[],
  options: AssetSuggestionOptions = {},
): AssetSuggestion | null {
  const min = options.minPriceMinor ?? DEFAULT_ASSET_MIN_PRICE_MINOR;
  if (tx.categoryId === null) return null;
  const isPurchase =
    purchaseCategoryIds instanceof Set
      ? purchaseCategoryIds.has(tx.categoryId)
      : (purchaseCategoryIds as readonly string[]).includes(tx.categoryId);
  if (!isPurchase) return null;
  if (tx.amount >= 0 || -tx.amount < min) return null;
  const name = clean(tx.description) ?? clean(tx.counterpartyName);
  if (name === null) return null;
  return {
    externalRef: tx.id,
    name: clip(name),
    purchaseDate: tx.bookingDate,
    priceMinor: -tx.amount,
    currency: tx.currency,
    url: tx.url,
  };
}
