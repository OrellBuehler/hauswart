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
      "across the turn of the year, the end of February to the end of October",
      { endDate: "2027-02-28", cancellationNoticeMonths: 4 },
      "2026-10-31",
    ],
    [
      "across the turn of the year, a day in the middle of the month",
      { endDate: "2027-02-20", cancellationNoticeMonths: 4 },
      "2026-10-20",
    ],
    [
      "the end of a 30-day month is the end of a longer one (30 June, 3 months)",
      { endDate: "2026-06-30" },
      "2026-03-31",
    ],
    [
      "30 September, 6 months",
      { endDate: "2026-09-30", cancellationNoticeMonths: 6 },
      "2026-03-31",
    ],
    [
      "30 April, 1 month",
      { endDate: "2026-04-30", cancellationNoticeMonths: 1 },
      "2026-03-31",
    ],
    [
      "29 February to the end of January",
      { endDate: "2028-02-29", cancellationNoticeMonths: 1 },
      "2028-01-31",
    ],
    [
      "29 February a year back is the end of February",
      { endDate: "2028-02-29", cancellationNoticeMonths: 12 },
      "2027-02-28",
    ],
    [
      "28 February in a year that is not a leap year, back into a leap year",
      { endDate: "2027-02-28", cancellationNoticeMonths: 12 },
      "2026-02-28",
    ],
    [
      "the 30th is not the end of a long month",
      { endDate: "2026-07-30", cancellationNoticeMonths: 1 },
      "2026-06-30",
    ],
    [
      "28 February two years on to a leap year's end of February",
      { endDate: "2030-02-28", cancellationNoticeMonths: 24 },
      "2028-02-29",
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
