import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import type { CostEntry } from "$lib/api/schemas/costs";
import { hasCostFlags } from "./cost-flags";
import CostFlags from "./cost-flags.svelte";

type Flags = Pick<
  CostEntry,
  "amountMinor" | "countsAsExpense" | "source" | "reviewNeeded"
>;

const plain: Flags = {
  amountMinor: 1850,
  countsAsExpense: true,
  source: "manual",
  reviewNeeded: false,
};

const html = (over: Partial<Flags>) =>
  render(CostFlags as never, {
    props: { cost: { ...plain, ...over } } as never,
  }).body;

describe("cost flags", () => {
  it("shows nothing for an ordinary entry", () => {
    expect(hasCostFlags(plain)).toBe(false);
    expect(html({})).not.toContain("<span");
  });

  it("marks an entry that still has to be reviewed", () => {
    expect(hasCostFlags({ ...plain, reviewNeeded: true })).toBe(true);
    const body = html({ reviewNeeded: true });
    expect(body).toContain("Prüfen");
    expect(body).toContain("border-warning");
  });

  it("puts the review mark before the other badges", () => {
    const body = html({ reviewNeeded: true, amountMinor: -500 });
    expect(body.indexOf("Prüfen")).toBeGreaterThan(-1);
    expect(body.indexOf("Prüfen")).toBeLessThan(body.indexOf("Rückerstattung"));
  });

  it("keeps the other badges as they were", () => {
    expect(hasCostFlags({ ...plain, amountMinor: -1 })).toBe(true);
    expect(hasCostFlags({ ...plain, countsAsExpense: false })).toBe(true);
    expect(hasCostFlags({ ...plain, source: "finance_bill" })).toBe(true);
    expect(html({ source: "finance_bill" })).not.toContain("Prüfen");
  });
});
