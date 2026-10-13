import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import type { FinanceSuggestion } from "$lib/api/schemas/finance";
import SuggestionCard from "./suggestion-card.svelte";

const transaction = {
  source: "finance_transaction" as const,
  date: "2026-06-10",
  amountMinor: 4250,
  currency: "CHF",
  title: "BEISPIEL MARKT ZUERICH",
  payee: "Beispiel Markt",
  category: "groceries" as const,
  url: "https://finance.example.org/tx/1",
  assetId: null,
  bookId: null,
};

const common = {
  id: "s1",
  status: "pending" as const,
  acceptedEntityId: null,
  createdAt: "2026-06-11T08:00:00.000Z",
  updatedAt: "2026-06-11T08:00:00.000Z",
};

const html = (suggestion: FinanceSuggestion) =>
  render(SuggestionCard as never, {
    props: {
      suggestion,
      onaccept: () => {},
      onadjust: () => {},
      ondismiss: () => {},
    } as never,
  }).body;

describe("SuggestionCard", () => {
  const entry = {
    id: "e1",
    title: "Einkauf Beispiel Markt",
    date: "2026-06-09",
    amountMinor: 4250,
    currency: "CHF",
    payee: null,
    bookId: "b1",
    bookName: "Wohnung",
  };

  it("shows a link with the transaction, the entry it looks like and a button to tie them", () => {
    const body = html({
      ...common,
      kind: "link",
      payload: { entryId: "e1", entry, transaction },
    });
    expect(body).toContain("BEISPIEL MARKT ZUERICH");
    expect(body).toContain("Banktransaktion vom");
    expect(body).toContain("Passender Eintrag");
    expect(body).toContain("Einkauf Beispiel Markt");
    expect(body).toContain('href="/costs/e1"');
    expect(body).toContain("Wohnung");
    expect(body).toContain("nichts wird doppelt gebucht");
    expect(body).toContain("Mit Eintrag verknüpfen");
    expect(body).toContain("Nicht verknüpfen");
    expect(body).not.toContain("Verwerfen");
    expect(body).not.toContain("Anpassen");
    expect(body).toContain("42.50");
  });

  it("copes with an entry that is gone: nothing to tie, only the way back to an ordinary suggestion", () => {
    const body = html({
      ...common,
      kind: "link",
      payload: { entryId: "e1", entry: null, transaction },
    });
    expect(body).toContain("BEISPIEL MARKT ZUERICH");
    expect(body).toContain("Der Eintrag wurde gelöscht");
    expect(body).not.toContain("Mit Eintrag verknüpfen");
    expect(body).toContain("Nicht verknüpfen");
  });

  it("still offers to adjust a cost", () => {
    const body = html({ ...common, kind: "cost", payload: transaction });
    expect(body).toContain("Anpassen");
    expect(body).toContain("Als Kosten buchen");
  });
});
