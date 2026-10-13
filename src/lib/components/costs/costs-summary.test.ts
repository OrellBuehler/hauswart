import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import type { CostsSummary } from "$lib/api/schemas/costs";
import CostsSummaryCard from "./costs-summary.svelte";

const summary = (reviewNeededCount: number): CostsSummary => ({
  year: 2026,
  currency: "CHF",
  otherCurrencyCount: 0,
  expenseTotalMinor: 42000,
  equityTotalMinor: 0,
  byCategory: [],
  byMonth: [],
  byAsset: [],
  byDeductible: [],
  people: [],
  settlement: [],
  unassignedPayerCount: 0,
  reviewNeededCount,
});

const html = (count: number, reviewHref?: string, tagName?: string) =>
  render(CostsSummaryCard as never, {
    props: {
      summary: summary(count),
      balances: null,
      userId: "u1",
      balancesHref: "/costs/balances",
      reviewHref,
      tagName,
    } as never,
  }).body;

describe("costs summary", () => {
  it("links to the entries to review while the summary counts some", () => {
    const body = html(2, "/costs?book=all&review=1");
    expect(body).toContain("2 Einträge zu prüfen");
    expect(body).toContain('href="/costs?book=all&amp;review=1"');
  });

  it("says nothing when no entry waits for a review", () => {
    expect(html(0, "/costs?book=all&review=1")).not.toContain("zu prüfen");
  });

  it("leaves the link out where the list is on screen already", () => {
    expect(html(2)).not.toContain("zu prüfen");
  });

  it("says that the totals only cover the entries of the tag on screen", () => {
    expect(html(0, undefined, "Ferien")).toContain(
      "Die Ausgaben zählen nur Einträge mit dem Tag «Ferien». Der Saldo gilt weiterhin für alle Einträge.",
    );
    expect(html(0)).not.toContain("mit dem Tag");
  });
});
