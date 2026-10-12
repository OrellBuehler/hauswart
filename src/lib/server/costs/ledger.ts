import type { CostSplitMode } from "$lib/api/enums";
import { amountsFor, type Share } from "./split";

/**
 * Who paid what and who bears what, over any set of cost entries and settlements. The year summary and the
 * running balances both count this way, so the numbers cannot drift apart.
 */
export interface Ledger {
  paid: Map<string, number>;
  share: Map<string, number>;
  /** Payments the person handed over (settlements). */
  sent: Map<string, number>;
  /** Payments the person received (settlements). */
  received: Map<string, number>;
  /** Split entries without a payer: they cannot be settled until somebody is named. */
  unassigned: number;
}

export const newLedger = (): Ledger => ({
  paid: new Map(),
  share: new Map(),
  sent: new Map(),
  received: new Map(),
  unassigned: 0,
});

const add = (map: Map<string, number>, key: string, amount: number) =>
  map.set(key, (map.get(key) ?? 0) + amount);

/**
 * Books one entry in the household currency: the payer paid the whole amount, each person in the frozen shares bears their
 * part (the parts add up to the amount exactly). An entry that is not split is nobody's business; a split one without a
 * payer is only counted.
 */
export function bookEntry(
  ledger: Ledger,
  entry: {
    amountMinor: number;
    splitMode: CostSplitMode;
    paidByUserId: string | null;
  },
  shares: readonly Share[],
): void {
  if (entry.splitMode === "none" || shares.length === 0) return;
  if (entry.paidByUserId === null) {
    ledger.unassigned++;
    return;
  }
  add(ledger.paid, entry.paidByUserId, entry.amountMinor);
  for (const part of amountsFor(entry.amountMinor, shares)) {
    add(ledger.share, part.userId, part.amountMinor);
  }
}

/** Books a payment between two people: it moves the balances, it is not a cost. */
export function bookSettlement(
  ledger: Ledger,
  payment: { fromUserId: string; toUserId: string; amountMinor: number },
): void {
  add(ledger.sent, payment.fromUserId, payment.amountMinor);
  add(ledger.received, payment.toUserId, payment.amountMinor);
}

export interface PersonBalance {
  userId: string;
  userName: string | null;
  paidMinor: number;
  shareMinor: number;
  sentMinor: number;
  receivedMinor: number;
  /** paid - share + sent - received: positive means the others owe this person. */
  balanceMinor: number;
}

/** One row per person, by name. The balances of one currency add up to zero. */
export function personBalances(
  ledger: Ledger,
  people: readonly { id: string; name: string | null }[],
): PersonBalance[] {
  return people
    .map((p) => {
      const paidMinor = ledger.paid.get(p.id) ?? 0;
      const shareMinor = ledger.share.get(p.id) ?? 0;
      const sentMinor = ledger.sent.get(p.id) ?? 0;
      const receivedMinor = ledger.received.get(p.id) ?? 0;
      return {
        userId: p.id,
        userName: p.name,
        paidMinor,
        shareMinor,
        sentMinor,
        receivedMinor,
        balanceMinor: paidMinor - shareMinor + sentMinor - receivedMinor,
      };
    })
    .sort(
      (a, b) =>
        (a.userName ?? "").localeCompare(b.userName ?? "", "de") ||
        a.userId.localeCompare(b.userId),
    );
}
