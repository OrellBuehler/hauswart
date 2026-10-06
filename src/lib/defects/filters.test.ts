import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  applyDefectFilters,
  DEFAULT_DEFECT_FILTERS,
  defectFilterQuery,
  exportQuery,
  parseDefectFilters,
} from "./filters";
import type { Defect } from "$lib/api/schemas/defects";

const parse = (qs: string) => parseDefectFilters(new URLSearchParams(qs));

describe("defect filters", () => {
  it("defaults to the statuses that need attention", () => {
    expect(parse("")).toEqual(DEFAULT_DEFECT_FILTERS);
    expect(defectFilterQuery(DEFAULT_DEFECT_FILTERS)).toBe("");
    expect(activeFilterCount(DEFAULT_DEFECT_FILTERS)).toBe(0);
  });

  it("round-trips a selection through the URL", () => {
    const filters = parse(
      "status=fixed,open&severity=high&room=r1&sort=number&q=riss",
    );
    expect(filters.statuses).toEqual(["open", "fixed"]);
    expect(filters.severity).toBe("high");
    expect(filters.sort).toBe("number");
    expect(parse(defectFilterQuery(filters).slice(1))).toEqual(filters);
    expect(activeFilterCount(filters)).toBe(4);
  });

  it("writes every status as all and ignores unknown values", () => {
    expect(parse("status=all").statuses).toHaveLength(5);
    expect(defectFilterQuery(parse("status=all"))).toBe("?status=all");
    expect(parse("status=nope&severity=x&sort=y")).toEqual(
      DEFAULT_DEFECT_FILTERS,
    );
  });

  it("exports a single status, otherwise every status", () => {
    expect(exportQuery(parse("status=fixed&room=r1"))).toEqual({
      status: "fixed",
      roomId: "r1",
    });
    expect(exportQuery(DEFAULT_DEFECT_FILTERS)).toEqual({});
  });

  it("filters by status and sorts by number on request", () => {
    const list = [
      { number: 1, status: "open" },
      { number: 2, status: "fixed" },
      { number: 3, status: "reported" },
    ] as Defect[];
    expect(
      applyDefectFilters(list, DEFAULT_DEFECT_FILTERS).map((d) => d.number),
    ).toEqual([1, 3]);
    expect(
      applyDefectFilters(list, parse("status=all&sort=number")).map(
        (d) => d.number,
      ),
    ).toEqual([3, 2, 1]);
  });
});
