import { describe, expect, it } from "vitest";
import type { InsurancePolicy } from "$lib/api/schemas/insurance";
import { deadlineInfo, termEnded } from "./deadline";
import { annualTotal, emptyFilter, filterPolicies, isFiltered } from "./list";

function policy(over: Partial<InsurancePolicy> = {}): InsurancePolicy {
  return {
    id: "p1",
    title: "Privathaftpflicht",
    type: "personal_liability",
    insurerContactId: null,
    insurerName: "Musterversicherung AG",
    policyNumber: "A-0000-00",
    premiumMinor: 24550,
    currency: "CHF",
    premiumPeriod: "annual",
    annualPremiumMinor: 24550,
    deductibleMinor: null,
    startDate: "2024-01-01",
    endDate: null,
    renewal: "auto",
    cancellationNoticeMonths: null,
    cancellationDeadline: null,
    assistancePhone: null,
    showOnEmergency: false,
    notes: null,
    assets: [],
    reminderTaskId: null,
    commentCount: 0,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("filterPolicies", () => {
  const policies = [
    policy({ id: "1" }),
    policy({
      id: "2",
      title: "Hausrat",
      type: "household",
      insurerName: "Beispiel Versicherungen",
      policyNumber: "H-1",
      assets: [{ id: "a1", name: "Familienauto", kind: "vehicle" }],
    }),
    policy({
      id: "3",
      title: "Alte Reise",
      type: "travel",
      archivedAt: "2026-01-01T00:00:00.000Z",
    }),
  ];
  const ids = (found: InsurancePolicy[]) => found.map((p) => p.id);

  it("shows the active policies, or the archived ones instead", () => {
    expect(ids(filterPolicies(policies, emptyFilter))).toEqual(["1", "2"]);
    expect(
      ids(filterPolicies(policies, { ...emptyFilter, archived: true })),
    ).toEqual(["3"]);
  });

  it("filters by type", () => {
    expect(
      ids(filterPolicies(policies, { ...emptyFilter, type: "household" })),
    ).toEqual(["2"]);
  });

  it("searches title, insurer, policy number and covered assets, every word", () => {
    const find = (q: string) =>
      ids(filterPolicies(policies, { ...emptyFilter, q }));
    expect(find("hausrat")).toEqual(["2"]);
    expect(find("beispiel")).toEqual(["2"]);
    expect(find("a-0000")).toEqual(["1"]);
    expect(find("familienauto")).toEqual(["2"]);
    expect(find("versicherung hausrat")).toEqual(["2"]);
    expect(find("versicherung nirgends")).toEqual([]);
  });

  it("knows whether a search or a type narrows the list (the archive switch is not a filter)", () => {
    expect(isFiltered(emptyFilter)).toBe(false);
    expect(isFiltered({ ...emptyFilter, archived: true })).toBe(false);
    expect(isFiltered({ ...emptyFilter, q: " " })).toBe(false);
    expect(isFiltered({ ...emptyFilter, q: "x" })).toBe(true);
    expect(isFiltered({ ...emptyFilter, type: "legal" })).toBe(true);
  });
});

describe("annualTotal", () => {
  it("adds the yearly premiums of the household currency", () => {
    expect(
      annualTotal(
        [
          policy({ annualPremiumMinor: 24550 }),
          policy({ annualPremiumMinor: 100000, premiumPeriod: "monthly" }),
        ],
        "CHF",
      ),
    ).toEqual({ totalMinor: 124550, otherCurrencyCount: 0 });
  });

  it("counts, but does not convert, other currencies", () => {
    expect(
      annualTotal(
        [
          policy({ annualPremiumMinor: 1000 }),
          policy({ annualPremiumMinor: 5000, currency: "EUR" }),
        ],
        "CHF",
      ),
    ).toEqual({ totalMinor: 1000, otherCurrencyCount: 1 });
  });

  it("is zero without policies", () => {
    expect(annualTotal([], "CHF")).toEqual({
      totalMinor: 0,
      otherCurrencyCount: 0,
    });
  });
});

describe("deadlineInfo", () => {
  const today = "2026-10-10";

  it("has nothing to say about a policy without a deadline", () => {
    expect(deadlineInfo(null, today)).toBeNull();
  });

  it.each([
    ["2026-10-09", -1, "overdue"],
    ["2026-10-10", 0, "soon"],
    ["2026-11-09", 30, "soon"],
    ["2026-11-10", 31, "ok"],
    ["2027-09-30", 355, "ok"],
  ] as const)("%s is %i days away: %s", (deadline, days, tone) => {
    expect(deadlineInfo(deadline, today)).toEqual({ days, tone });
  });
});

describe("termEnded", () => {
  it("is over after the last day of cover, not on it", () => {
    expect(termEnded("2026-10-09", "2026-10-10")).toBe(true);
    expect(termEnded("2026-10-10", "2026-10-10")).toBe(false);
    expect(termEnded("2026-10-11", "2026-10-10")).toBe(false);
    expect(termEnded(null, "2026-10-10")).toBe(false);
  });
});
