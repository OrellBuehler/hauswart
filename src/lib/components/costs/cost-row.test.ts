import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import type { CostEntry } from "$lib/api/schemas/costs";
import CostRow from "./cost-row.svelte";

const cost: CostEntry = {
  id: "c1",
  bookId: "b1",
  bookName: "Wohnung",
  bookTaxRelevant: true,
  date: "2026-10-01",
  title: "Wasserhahn",
  amountMinor: 18950,
  currency: "CHF",
  category: "repair",
  assetId: null,
  assetName: null,
  roomId: null,
  roomName: null,
  defectId: null,
  defectNumber: null,
  defectTitle: null,
  serviceLogId: null,
  serviceLogTitle: null,
  payee: null,
  notes: null,
  paidByUserId: "u1",
  paidByName: "Anna Beispiel",
  splitMode: "ownership",
  shares: [],
  countsAsExpense: true,
  deductible: "unknown",
  source: "manual",
  providerUrl: null,
  fuelLogId: null,
  reviewNeeded: false,
  reviewedAt: null,
  reviewedByUserId: null,
  commentCount: 0,
  createdBy: "u1",
  createdAt: "2026-10-01T08:00:00.000Z",
  updatedAt: "2026-10-01T08:00:00.000Z",
};

const html = (props: Record<string, unknown>) =>
  render(CostRow as never, { props: { cost, ...props } as never }).body;

describe("CostRow", () => {
  it("opens the entry", () => {
    const body = html({});
    expect(body).toContain('href="/costs/c1"');
    expect(body).not.toContain('role="checkbox"');
  });

  it("is ticked instead of opened while the list is picked from", () => {
    const body = html({ selecting: true, selected: true });
    expect(body).not.toContain("href=");
    expect(body).toContain('role="checkbox"');
    expect(body).toContain("«Wasserhahn» auswählen");
    expect(body).toContain('aria-checked="true"');
    expect(body).toContain("Wasserhahn");
  });

  it("shows an entry that is not picked as unticked", () => {
    expect(html({ selecting: true })).toContain('aria-checked="false"');
  });
});
