import { describe, expect, it } from "vitest";
import { ApiError } from "$lib/api/errors";
import type { CostBook } from "$lib/api/schemas/cost-books";
import {
  MOVE_COSTS_MAX_IDS,
  type MoveCostsToBookResult,
} from "$lib/api/schemas/costs";
import {
  moveFailure,
  movePreview,
  moveRequest,
  moveSummary,
  pickAll,
  suggestedTarget,
  taxClassLost,
  yearsLabel,
} from "./move";

const book = (over: Partial<CostBook> = {}): CostBook => ({
  id: "b1",
  name: "Wohnung",
  slug: "wohnung",
  icon: null,
  defaultSplitMode: "ownership",
  taxRelevant: true,
  archivedAt: null,
  sortOrder: 0,
  isDefault: true,
  entryCount: 0,
  settlementCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

const result = (
  over: Partial<MoveCostsToBookResult> = {},
): MoveCostsToBookResult => ({
  bookId: "b2",
  moved: 0,
  unchanged: 0,
  deductibleReset: 0,
  dryRun: false,
  years: null,
  ...over,
});

const BOOKS = [
  book(),
  book({ id: "b2", name: "Haushalt", isDefault: false, taxRelevant: false }),
  book({
    id: "b3",
    name: "Alt",
    isDefault: false,
    archivedAt: "2026-06-01T00:00:00.000Z",
  }),
];

describe("moveRequest", () => {
  it("names the entries once each, or the device", () => {
    expect(moveRequest("b2", { ids: ["c1", "c2", "c1"] })).toEqual({
      bookId: "b2",
      ids: ["c1", "c2"],
    });
    expect(moveRequest("b2", { assetId: "a1" })).toEqual({
      bookId: "b2",
      assetId: "a1",
    });
  });
});

describe("moveRequest for a preview", () => {
  it("asks for a dry run only when told to", () => {
    expect(moveRequest("b2", { assetId: "a1" }, { dryRun: true })).toEqual({
      bookId: "b2",
      assetId: "a1",
      dryRun: true,
    });
    expect(moveRequest("b2", { ids: ["c1"] }, { dryRun: true })).toEqual({
      bookId: "b2",
      ids: ["c1"],
      dryRun: true,
    });
    expect(moveRequest("b2", { assetId: "a1" }, { dryRun: false })).toEqual({
      bookId: "b2",
      assetId: "a1",
    });
  });
});

describe("yearsLabel", () => {
  it("names one year, or the first and the last", () => {
    expect(yearsLabel({ from: 2025, to: 2025 })).toBe("2025");
    expect(yearsLabel({ from: 2024, to: 2026 })).toBe("2024\u20132026");
  });
});

describe("movePreview", () => {
  it("says how many entries from which years move and how many lose their tax class", () => {
    expect(
      movePreview(
        result({
          dryRun: true,
          moved: 23,
          deductibleReset: 5,
          years: { from: 2024, to: 2026 },
        }),
      ),
    ).toBe("23 Einträge aus 2024\u20132026, 5 verlieren ihre Steuerklasse");
  });

  it("is singular for one, leaves out a tax class nobody loses and adds those that are there already", () => {
    expect(
      movePreview(
        result({
          moved: 1,
          years: { from: 2025, to: 2025 },
          deductibleReset: 1,
        }),
      ),
    ).toBe("1 Eintrag aus 2025, 1 verliert seine Steuerklasse");
    expect(
      movePreview(
        result({ moved: 4, unchanged: 3, years: { from: 2023, to: 2026 } }),
      ),
    ).toBe("4 Einträge aus 2023\u20132026, 3 waren schon dort");
  });

  it("says when everything is in the book already, or there is nothing", () => {
    expect(movePreview(result({ unchanged: 6 }))).toBe(
      "Alles ist schon in diesem Buch.",
    );
    expect(movePreview(result())).toBe("Es gab nichts zu verschieben.");
  });
});

describe("pickAll", () => {
  it("takes every entry of the list", () => {
    expect(pickAll([{ id: "c1" }, { id: "c2" }])).toEqual({
      ids: ["c1", "c2"],
      truncated: false,
    });
  });

  it("stops at what one request moves and says so", () => {
    const many = Array.from({ length: MOVE_COSTS_MAX_IDS + 3 }, (_, i) => ({
      id: `c${i}`,
    }));
    const picked = pickAll(many);
    expect(picked.ids).toHaveLength(MOVE_COSTS_MAX_IDS);
    expect(picked.truncated).toBe(true);
  });
});

describe("suggestedTarget", () => {
  it("is a book that takes entries and that none of the entries is in", () => {
    expect(suggestedTarget(BOOKS, [{ bookId: "b1" }])).toBe("b2");
    expect(suggestedTarget(BOOKS, [{ bookId: "b2" }, { bookId: "b2" }])).toBe(
      "b1",
    );
  });

  it("falls back to the first book that takes entries", () => {
    expect(suggestedTarget(BOOKS, [{ bookId: "b1" }, { bookId: "b2" }])).toBe(
      "b1",
    );
    expect(suggestedTarget(BOOKS, [])).toBe("b1");
    expect(suggestedTarget([], [])).toBe("");
  });
});

describe("taxClassLost", () => {
  const entries = [
    { deductible: "maintenance" as const },
    { deductible: "unknown" as const },
    { deductible: "no" as const },
  ];

  it("counts the entries that have a tax class when the book is not tax relevant", () => {
    expect(taxClassLost(entries, book({ taxRelevant: false }))).toBe(2);
  });

  it("is none for a tax relevant book or a book that is not known", () => {
    expect(taxClassLost(entries, book({ taxRelevant: true }))).toBe(0);
    expect(taxClassLost(entries, undefined)).toBe(0);
  });
});

describe("moveSummary", () => {
  it("says how many moved, how many were there already and how many lost their tax class", () => {
    expect(
      moveSummary(
        result({ moved: 3, unchanged: 1, deductibleReset: 2 }),
        "Haushalt",
      ),
    ).toBe(
      "3 Einträge nach «Haushalt» verschoben · 1 war schon dort · bei 2 Einträgen wurde die steuerliche Behandlung zurückgesetzt",
    );
  });

  it("leaves out what is zero", () => {
    expect(
      moveSummary(
        result({ moved: 1, unchanged: 0, deductibleReset: 0 }),
        "Haushalt",
      ),
    ).toBe("1 Eintrag nach «Haushalt» verschoben");
    expect(
      moveSummary(
        result({ moved: 2, unchanged: 5, deductibleReset: 0 }),
        "Haushalt",
      ),
    ).toBe("2 Einträge nach «Haushalt» verschoben · 5 waren schon dort");
  });

  it("says there was nothing when there was nothing at all", () => {
    expect(
      moveSummary(
        result({ moved: 0, unchanged: 0, deductibleReset: 0 }),
        "Haushalt",
      ),
    ).toBe("Es gab nichts zu verschieben.");
  });

  it("says plainly when everything was there already", () => {
    expect(
      moveSummary(
        result({ moved: 0, unchanged: 4, deductibleReset: 0 }),
        "Haushalt",
      ),
    ).toBe("Nichts verschoben: alles war schon in «Haushalt»");
  });
});

describe("moveFailure", () => {
  const invalid = (field: string) =>
    new ApiError("invalid_request", "x", {
      status: 400,
      details: { body: { fieldErrors: { [field]: ["x"] } } },
    });

  it("says a book that no longer takes entries is the problem, on the book field", () => {
    const failure = moveFailure(invalid("bookId"));
    expect(failure.field).toBe("bookId");
    expect(failure.message).toContain("Buch");
  });

  it("says an entry or device that is gone is the problem", () => {
    expect(moveFailure(invalid("ids")).message).toContain("Eintrag");
    expect(moveFailure(invalid("assetId")).message).toContain("Gerät");
  });

  it("leaves every other error to the generic wording", () => {
    expect(moveFailure(new Error("boom")).message).toBeTruthy();
    expect(
      moveFailure(new ApiError("not_found", "x", { status: 404 })).field,
    ).toBeUndefined();
  });
});
