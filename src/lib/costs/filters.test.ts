import { describe, expect, it } from "vitest";
import {
  REVIEW_ALL_HREF,
  activeFilterCount,
  costFilterQuery,
  costsExportQuery,
  costsQuery,
  costsSummaryQuery,
  isFiltered,
  monthRange,
  narrowsBeyondBook,
  parseCostFilters,
  reviewFilters,
  withKnownTag,
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
      tagId: "",
      month: "",
      reviewNeeded: false,
      allYears: false,
    });
    expect(costFilterQuery(filters, 2026)).toBe("?book=all");
    expect(activeFilterCount(filters)).toBe(0);
  });

  it("round-trips a selection through the URL", () => {
    const filters = parse(
      "book=b1&year=2025&q=lampe&category=repair&asset=a1&room=r1&defect=d1&paidBy=u1&tag=t1&month=03",
    );
    expect(filters.year).toBe(2025);
    expect(filters.bookId).toBe("b1");
    expect(filters.category).toBe("repair");
    expect(filters.tagId).toBe("t1");
    expect(filters.month).toBe("03");
    expect(activeFilterCount(filters)).toBe(7);
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
    expect(narrows("tag=t1")).toBe(true);
    expect(narrows("tag=%20")).toBe(false);
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

  it("asks the summary for the year, the book, the device and the tag: nothing else narrows its totals", () => {
    expect(costsSummaryQuery(parse(""))).toEqual({
      year: 2026,
      assetId: undefined,
      bookId: undefined,
      tagId: undefined,
    });
    expect(
      costsSummaryQuery(
        parse("book=b7&year=2025&asset=a1&category=repair&month=05&tag=t1"),
      ),
    ).toEqual({ year: 2025, assetId: "a1", bookId: "b7", tagId: "t1" });
  });

  it("exports the year of the book and the tag on screen", () => {
    expect(costsExportQuery(parse("year=2025"))).toEqual({
      year: 2025,
      bookId: undefined,
      tagId: undefined,
    });
    expect(costsExportQuery(parse("book=b7&year=2025&q=x&tag=t1"))).toEqual({
      year: 2025,
      bookId: "b7",
      tagId: "t1",
    });
  });

  describe("the tag filter", () => {
    it("is part of the address and of every query that follows it", () => {
      const filters = parse("book=b7&year=2025&tag=t1");
      expect(filters.tagId).toBe("t1");
      expect(costFilterQuery(filters, 2026)).toBe("?book=b7&year=2025&tag=t1");
      expect(costsQuery(filters)).toEqual({
        limit: 200,
        year: 2025,
        bookId: "b7",
        tagId: "t1",
      });
      expect(costsSummaryQuery(filters).tagId).toBe("t1");
      expect(costsExportQuery(filters).tagId).toBe("t1");
      expect(isFiltered(filters)).toBe(true);
      expect(activeFilterCount(filters)).toBe(1);
    });

    it("leaves the tag out of a list without one", () => {
      expect(costsQuery(parse(""))).not.toHaveProperty("tagId");
      expect(costFilterQuery(parse(""), 2026)).not.toContain("tag");
      expect(parse("tag=%20%20").tagId).toBe("");
    });

    it("is dropped when the tag does not exist any more, which the server would answer with a 404", () => {
      const tags = [{ id: "t1" }, { id: "t2" }];
      expect(withKnownTag(parse("tag=t2"), tags).tagId).toBe("t2");
      expect(withKnownTag(parse("tag=t9"), tags).tagId).toBe("");
      expect(withKnownTag(parse(""), tags).tagId).toBe("");
      expect(withKnownTag(parse("tag=t1&book=b7"), []).bookId).toBe("b7");
    });

    it("keeps the summary's scope when the entries to review are opened", () => {
      const scope = reviewFilters(parse("book=b7&year=2025&tag=t1&q=x"));
      expect(scope.tagId).toBe("t1");
      expect(costFilterQuery(scope, 2026)).toBe(
        "?book=b7&year=2025&review=1&tag=t1",
      );
    });
  });

  it("drops the month when the year changes", () => {
    expect(withYear(parse("month=05&category=repair"), 2025)).toMatchObject({
      year: 2025,
      month: "",
      category: "repair",
    });
  });

  describe("the review filter", () => {
    it("is part of the address and of the list query", () => {
      const filters = parse("book=b7&year=2025&review=1");
      expect(filters).toMatchObject({ reviewNeeded: true, allYears: false });
      expect(costFilterQuery(filters, 2026)).toBe(
        "?book=b7&year=2025&review=1",
      );
      expect(costsQuery(filters)).toEqual({
        limit: 200,
        year: 2025,
        bookId: "b7",
        reviewNeeded: "true",
      });
      expect(isFiltered(filters)).toBe(true);
      expect(activeFilterCount(filters)).toBe(0);
    });

    it("lists every year when the address says so, and only together with the review filter", () => {
      const all = parse("book=all&year=all&review=1");
      expect(all).toMatchObject({ reviewNeeded: true, allYears: true });
      expect(costFilterQuery(all, 2026)).toBe("?book=all&year=all&review=1");
      expect(costFilterQuery(all, 2026)).toBe(
        REVIEW_ALL_HREF.slice("/costs".length),
      );
      expect(costsQuery(all)).toEqual({
        limit: 200,
        reviewNeeded: "true",
      });
      // The unbounded list is never offered without the filter.
      expect(parse("year=all")).toMatchObject({
        year: 2026,
        allYears: false,
      });
    });

    it("ignores a month while every year is listed", () => {
      const all = parse("year=all&review=1&month=05");
      expect(costsQuery(all)).toEqual({ limit: 200, reviewNeeded: "true" });
      expect(costFilterQuery(all, 2026)).toBe("?book=all&year=all&review=1");
    });

    it("keeps a link that carries it from falling back to the remembered book", () => {
      expect(narrowsBeyondBook(new URLSearchParams("review=1"))).toBe(true);
    });

    it("leaves the year alone for the summary", () => {
      expect(costsSummaryQuery(parse("book=b7&year=all&review=1"))).toEqual({
        year: 2026,
        assetId: undefined,
        bookId: "b7",
        tagId: undefined,
      });
    });

    it("opens the entries a summary counted: its year, book and device, nothing else", () => {
      const summaryScope = reviewFilters(
        parse(
          "book=b7&year=2025&asset=a1&category=repair&q=x&month=05&paidBy=u1",
        ),
      );
      expect(costFilterQuery(summaryScope, 2026)).toBe(
        "?book=b7&year=2025&review=1&asset=a1",
      );
    });

    it("leaves every-year mode when a year is picked", () => {
      expect(withYear(parse("year=all&review=1"), 2025)).toMatchObject({
        year: 2025,
        allYears: false,
        reviewNeeded: true,
      });
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
