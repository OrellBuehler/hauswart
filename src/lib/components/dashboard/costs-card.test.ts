import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import type { Dashboard } from "$lib/api/schemas/dashboard";
import CostsCard from "./costs-card.svelte";

type Costs = Dashboard["costsYearToDate"];
type Balances = Dashboard["balances"];

const book = (over: Partial<Costs["byBook"][number]> = {}) => ({
  bookId: "b1",
  bookName: "Wohnung",
  taxRelevant: true,
  archived: false,
  totalMinor: 30000,
  count: 3,
  ...over,
});

const costs = (over: Partial<Costs> = {}): Costs => ({
  year: 2026,
  currency: "CHF",
  totalMinor: 42000,
  byCategory: [],
  byBook: [
    book(),
    book({ bookId: "b2", bookName: "Haushalt", totalMinor: 12000 }),
  ],
  ...over,
});

const balances = (over: Partial<Balances> = {}): Balances => ({
  currency: "CHF",
  myBalanceMinor: 2500,
  hasActivity: true,
  suggestedPayments: [
    {
      fromUserId: "u2",
      fromName: "Ben Muster",
      toUserId: "u1",
      toName: "Anna Beispiel",
      amountMinor: 2500,
    },
  ],
  suggestedPaymentCount: 1,
  ...over,
});

function html(c: Costs, b: Balances | null, canWrite = false): string {
  return render(CostsCard as never, {
    props: { costs: c, balances: b, canWrite } as never,
  }).body.replace(/[\u00a0\u202f]/g, " ");
}

describe("the dashboard's costs card", () => {
  it("says where the caller stands from the dashboard's own balances", () => {
    const body = html(costs(), balances());
    expect(body).toContain("Du bekommst CHF 25.00");
    expect(body).toContain("Ben Muster schuldet Anna Beispiel");
    expect(body).toContain("Saldo über alle Bücher");
  });

  it("offers the quick entry to people who may book costs", () => {
    expect(html(costs(), balances(), true)).toContain('href="/costs/quick"');
    expect(html(costs(), balances(), true)).toContain("Ausgabe erfassen");
    expect(html(costs(), balances())).not.toContain("/costs/quick");
  });

  it("still shows the year and says so when the balances could not be worked out", () => {
    const body = html(costs(), null);
    expect(body).toContain("Ausgaben 2026, alle Bücher");
    expect(body).toContain("CHF 420.00");
    expect(body).toContain("Der Saldo konnte nicht geladen werden.");
    expect(body).not.toContain("Du bekommst");
    expect(body).not.toContain("Du schuldest");
    expect(body).not.toContain("schuldet");
    expect(body).toContain("/costs/balances");
  });

  it("shows the notice for the balances even when nothing was spent this year", () => {
    const body = html(costs({ totalMinor: 0, byBook: [] }), null);
    expect(body).toContain("Der Saldo konnte nicht geladen werden.");
  });

  it("labels the year as all books together and lists the books under it", () => {
    const body = html(costs(), balances());
    expect(body).toContain("Ausgaben 2026, alle Bücher");
    expect(body).toContain("CHF 420.00");
    expect(body).toContain("Wohnung");
    expect(body).toContain("CHF 300.00");
    expect(body).toContain("Haushalt");
    expect(body).toContain("CHF 120.00");
    expect(body).toContain("/costs?book=b1");
  });

  it("skips the list for a single book, which would repeat the total", () => {
    const body = html(
      costs({ byBook: [book({ totalMinor: 42000 })] }),
      balances(),
    );
    expect(body).not.toContain("/costs?book=");
  });

  it("marks an archived book and says how many more there are", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      book({
        bookId: `b${i}`,
        bookName: `Buch ${i}`,
        archived: i === 0,
        totalMinor: 6000 - i,
      }),
    );
    const body = html(costs({ byBook: many }), balances());
    expect(body).toContain("Buch 0");
    expect(body).toContain("(Archiviert)");
    expect(body).not.toContain("Buch 4");
    expect(body).toContain("und 2 weitere Bücher");
  });

  it("says how many more payments there are than the three it shows", () => {
    const body = html(costs(), balances({ suggestedPaymentCount: 4 }));
    expect(body).toContain("und 3 weitere Zahlungen");
  });

  it("says everything is square, and shows nothing without any costs or payments", () => {
    const square = html(
      costs(),
      balances({
        myBalanceMinor: 0,
        suggestedPayments: [],
        suggestedPaymentCount: 0,
      }),
    );
    expect(square).toContain("Alles ausgeglichen");
    const nothing = html(
      costs({ totalMinor: 0, byBook: [] }),
      balances({
        hasActivity: false,
        suggestedPayments: [],
        suggestedPaymentCount: 0,
      }),
    );
    expect(nothing).not.toContain("Ausgaben");
  });
});
