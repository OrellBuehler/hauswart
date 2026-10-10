import { describe, expect, it } from "vitest";
import {
  annualPremiumMinor,
  cancellationDeadline,
  type CancellationTerms,
} from "./policy";

describe("annualPremiumMinor", () => {
  it.each([
    [10_000, "annual", 10_000],
    [5_050, "semiannual", 10_100],
    [2_525, "quarterly", 10_100],
    [841, "monthly", 10_092],
    [0, "monthly", 0],
  ] as const)("%i per %s is %i a year", (premium, period, expected) => {
    expect(annualPremiumMinor(premium, period)).toBe(expected);
  });
});

describe("cancellationDeadline", () => {
  const terms = (over: Partial<CancellationTerms>): CancellationTerms => ({
    renewal: "auto",
    endDate: "2026-12-31",
    cancellationNoticeMonths: 3,
    ...over,
  });

  it.each([
    ["three months before the end of the year", {}, "2026-09-30"],
    ["one month", { cancellationNoticeMonths: 1 }, "2026-11-30"],
    [
      "no notice period is the end date itself",
      { cancellationNoticeMonths: 0 },
      "2026-12-31",
    ],
    ["six months", { cancellationNoticeMonths: 6 }, "2026-06-30"],
    [
      "clamped to the end of a shorter month",
      { endDate: "2026-05-31" },
      "2026-02-28",
    ],
    [
      "clamped to 29 February in a leap year",
      { endDate: "2028-05-31" },
      "2028-02-29",
    ],
    ["mid-month terms keep the day", { endDate: "2027-06-14" }, "2027-03-14"],
    [
      "across the turn of the year",
      { endDate: "2027-02-28", cancellationNoticeMonths: 4 },
      "2026-10-28",
    ],
    [
      "a notice period of years",
      { endDate: "2030-12-31", cancellationNoticeMonths: 24 },
      "2028-12-31",
    ],
  ] as [string, Partial<CancellationTerms>, string][])(
    "%s",
    (_name, over, expected) => {
      expect(cancellationDeadline(terms(over))).toBe(expected);
    },
  );

  it.each([
    ["a fixed term ends by itself", { renewal: "fixed" as const }],
    ["no end date", { endDate: null }],
    ["no notice period", { cancellationNoticeMonths: null }],
    [
      "neither end date nor notice period",
      { endDate: null, cancellationNoticeMonths: null },
    ],
  ])("is null for %s", (_name, over) => {
    expect(cancellationDeadline(terms(over))).toBeNull();
  });
});
