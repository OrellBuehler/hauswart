import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  costFilterQuery,
  costsExportQuery,
  costsQuery,
  costsSummaryQuery,
  monthRange,
  narrowsBeyondBook,
  parseCostFilters,
  withYear,
  yearOptions,
} from "./filters";

const parse = (qs: string, year = 2026) =>
  parseCostFilters(new URLSearchParams(qs), year);

describe("cost filters", () => {
  it("defaults to the current year without any other filter", () => {
    const filters = parse("");
    expect(filters).toEqual({
      bookId: "",
      year: 2026,
      q: "",
      category: "",
      assetId: "",
      roomId: "",
      defectId: "",
      paidBy: "",
      month: "",
    });
    expect(costFilterQuery(filters, 2026)).toBe("?book=all");
    expect(activeFilterCount(filters)).toBe(0);
  });

  it("round-trips a selection through the URL", () => {
    const filters = parse(
      "book=b1&year=2025&q=lampe&category=repair&asset=a1&room=r1&defect=d1&paidBy=u1&month=03",
    );
    expect(filters.year).toBe(2025);
    expect(filters.bookId).toBe("b1");
    expect(filters.category).toBe("repair");
    expect(filters.month).toBe("03");
    expect(activeFilterCount(filters)).toBe(6);
    expect(parse(costFilterQuery(filters, 2026).slice(1))).toEqual(filters);
  });

  it("leaves the year out when it is the current one", () => {
    expect(costFilterQuery(parse("year=2026"), 2026)).toBe("?book=all");
    expect(costFilterQuery(parse("year=2024"), 2026)).toBe(
      "?book=all&year=2024",
    );
  });

  it("ignores values it does not know", () => {
    const filters = parse("year=abc&category=nope&month=13&q=%20%20");
    expect(filters.year).toBe(2026);
    expect(filters.category).toBe("");
    expect(filters.month).toBe("");
    expect(filters.q).toBe("");
    expect(parse("year=1800").year).toBe(2026);
    expect(parse("year=20260").year).toBe(2026);
  });

  it("covers a month from the first to the last day, leap years included", () => {
    expect(monthRange(2026, "01")).toEqual({
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(monthRange(2026, "02").to).toBe("2026-02-28");
    expect(monthRange(2024, "02").to).toBe("2024-02-29");
    expect(monthRange(2026, "04").to).toBe("2026-04-30");
  });

  it("keeps the book in the address, and every book as an explicit choice", () => {
    expect(parse("book=all").bookId).toBe("");
    expect(parse("book=b7").bookId).toBe("b7");
    expect(parse("").bookId).toBe("");
    expect(costFilterQuery(parse("book=b7"), 2026)).toBe("?book=b7");
    expect(costFilterQuery(parse("book=b7&year=2025"), 2026)).toBe(
      "?book=b7&year=2025",
    );
    expect(parse(costFilterQuery(parse("book=b7"), 2026).slice(1)).bookId).toBe(
      "b7",
    );
    expect(activeFilterCount(parse("book=b7"))).toBe(0);
  });

  it("tells a link that narrows the list from one that only picks a book", () => {
    const narrows = (qs: string) => narrowsBeyondBook(new URLSearchParams(qs));
    expect(narrows("")).toBe(false);
    expect(narrows("year=2025&book=b1")).toBe(false);
    expect(narrows("asset=a1")).toBe(true);
    expect(narrows("month=03")).toBe(true);
    expect(narrows("q=%20")).toBe(false);
    expect(narrows("paidBy=me")).toBe(true);
  });

  it("asks the list endpoint for the year and what is filtered", () => {
    expect(costsQuery(parse(""))).toEqual({ limit: 200, year: 2026 });
    expect(costsQuery(parse("book=b7"))).toEqual({
      limit: 200,
      year: 2026,
      bookId: "b7",
    });
    expect(
      costsQuery(parse("category=repair&paidBy=me&month=05&q=x"), "next"),
    ).toEqual({
      limit: 200,
      year: 2026,
      cursor: "next",
      from: "2026-05-01",
      to: "2026-05-31",
      q: "x",
      category: "repair",
      paidBy: "me",
    });
  });

  it("asks the summary for the year, the book and the device: nothing else narrows its totals", () => {
    expect(costsSummaryQuery(parse(""))).toEqual({
      year: 2026,
      assetId: undefined,
      bookId: undefined,
    });
    expect(
      costsSummaryQuery(
        parse("book=b7&year=2025&asset=a1&category=repair&month=05"),
      ),
    ).toEqual({ year: 2025, assetId: "a1", bookId: "b7" });
  });

  it("exports the year of the book on screen", () => {
    expect(costsExportQuery(parse("year=2025"))).toEqual({
      year: 2025,
      bookId: undefined,
    });
    expect(costsExportQuery(parse("book=b7&year=2025&q=x"))).toEqual({
      year: 2025,
      bookId: "b7",
    });
  });

  it("drops the month when the year changes", () => {
    expect(withYear(parse("month=05&category=repair"), 2025)).toMatchObject({
      year: 2025,
      month: "",
      category: "repair",
    });
  });

  it("offers the recent years and always the selected one", () => {
    const years = yearOptions(2026, 2026);
    expect(years[0]).toBe(2027);
    expect(years).toContain(2016);
    expect(years).not.toContain(2015);
    expect(yearOptions(2026, 2001)).toContain(2001);
    expect(yearOptions(2026, 2001)).toEqual(
      [...yearOptions(2026, 2001)].sort((a, b) => b - a),
    );
  });
});
