import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import type { CostBalances } from "$lib/api/schemas/costs";
import BalanceOverview from "./balance-overview.svelte";

function balances(over: Partial<CostBalances> = {}): CostBalances {
  return {
    currency: "CHF",
    people: [
      {
        userId: "u1",
        userName: "Anna Beispiel",
        paidMinor: 10000,
        shareMinor: 5000,
        sentMinor: 0,
        receivedMinor: 0,
        balanceMinor: 5000,
      },
      {
        userId: "u2",
        userName: "Ben Muster",
        paidMinor: 0,
        shareMinor: 5000,
        sentMinor: 0,
        receivedMinor: 0,
        balanceMinor: -5000,
      },
    ],
    otherCurrencyCount: 0,
    unassignedPayerCount: 0,
    crossBookSettlements: null,
    suggestedPayments: [
      {
        fromUserId: "u2",
        fromName: "Ben Muster",
        toUserId: "u1",
        toName: "Anna Beispiel",
        amountMinor: 5000,
      },
    ],
    ...over,
  } as CostBalances;
}

function html(value: CostBalances | null): string {
  return render(BalanceOverview as never, {
    props: { balances: value, userId: "u1", href: "/costs/balances" } as never,
  }).body.replace(/[\u00a0\u202f]/g, " ");
}

describe("BalanceOverview", () => {
  it("names the payments across all books that a single book's balances leave out", () => {
    const body = html(
      balances({ crossBookSettlements: { count: 1, totalMinor: 5000 } }),
    );
    expect(body).toContain(
      "1 Zahlung über alle Bücher (CHF 50.00) ist hier nicht eingerechnet.",
    );
  });

  it("says nothing of them in the view of all books", () => {
    expect(html(balances())).not.toContain("nicht eingerechnet");
    expect(
      html(balances({ crossBookSettlements: { count: 0, totalMinor: 0 } })),
    ).not.toContain("nicht eingerechnet");
  });

  it("still lists the suggested payment", () => {
    expect(html(balances())).toContain("Ben Muster schuldet Anna Beispiel");
  });
});
