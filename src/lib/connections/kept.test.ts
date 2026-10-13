import { describe, expect, it } from "vitest";
import { ApiError } from "$lib/api/errors";
import type { CostBook } from "$lib/api/schemas/cost-books";
import {
  KEPT_LIMITS,
  categoryRows,
  keptBookOptions,
  isArchivedBook,
  keptConfigOf,
  keptErrorMessage,
  keptSaveError,
  keptSettingsError,
  keptSettingsSignature,
  offersWaiting,
  readCategoryCount,
  readKeptSettings,
  readKeptTestInfo,
  syncStatLines,
  withAutoAccept,
  withCategoryBook,
  withCostCategory,
  withCreditor,
  withDefaultBook,
  withPurchase,
  withoutCreditor,
  type KeptCategory,
  type KeptSettings,
} from "./kept";

const empty = readKeptSettings({});

function category(over: Partial<KeptCategory> & { id: string }): KeptCategory {
  return { name: over.id, parentId: null, kind: "expense", ...over };
}

describe("readKeptSettings", () => {
  it("reads nothing from an empty config", () => {
    expect(empty).toEqual({
      categoryMap: {},
      purchaseCategoryIds: [],
      autoAcceptCategoryIds: [],
      categoryBookMap: {},
      defaultBookId: "",
      billTasks: false,
      billCreditorFilter: [],
      billCostCategory: null,
      syncFrom: "",
    });
  });

  it("reads a stored config and drops what is not valid", () => {
    const settings = readKeptSettings({
      categoryMap: { c1: "repair", c2: "nonsense", c3: 7 },
      purchaseCategoryIds: ["c1", "c1", "", 4],
      autoAcceptCategoryIds: ["c1", "c9"],
      billTasks: true,
      billCreditorFilter: [" Muster Verwaltung AG ", "Muster Verwaltung AG"],
      billCostCategory: "utilities",
      syncFrom: "2026-01-01",
      unknownKey: true,
    });
    expect(settings).toEqual({
      categoryMap: { c1: "repair" },
      purchaseCategoryIds: ["c1"],
      autoAcceptCategoryIds: ["c1"],
      categoryBookMap: {},
      defaultBookId: "",
      billTasks: true,
      billCreditorFilter: ["Muster Verwaltung AG"],
      billCostCategory: "utilities",
      syncFrom: "2026-01-01",
    });
  });

  it("reads the cost books: those of mapped categories and the default one", () => {
    const settings = readKeptSettings({
      categoryMap: { c1: "repair", c2: "utilities" },
      categoryBookMap: { c1: "book-1", c3: "book-3", c2: "", c4: 7 },
      defaultBookId: "book-2",
    });
    expect(settings.categoryBookMap).toEqual({ c1: "book-1" });
    expect(settings.defaultBookId).toBe("book-2");
    expect(readKeptSettings({ defaultBookId: 4 }).defaultBookId).toBe("");
  });

  it("ignores values of the wrong type", () => {
    const settings = readKeptSettings({
      categoryMap: [],
      purchaseCategoryIds: "c1",
      billTasks: "yes",
      billCostCategory: "other-thing",
      syncFrom: "yesterday",
    });
    expect(settings).toEqual(empty);
  });
});

describe("keptConfigOf", () => {
  it("leaves out an unset invoice category and date", () => {
    const config = keptConfigOf(empty);
    expect(config).not.toHaveProperty("billCostCategory");
    expect(config).not.toHaveProperty("syncFrom");
    expect(config.billTasks).toBe(false);
  });

  it("only lets mapped categories book automatically", () => {
    const settings: KeptSettings = {
      ...empty,
      categoryMap: { c1: "repair" },
      autoAcceptCategoryIds: ["c1", "c2"],
      billCostCategory: "insurance",
      syncFrom: "2026-03-01",
    };
    expect(keptConfigOf(settings)).toMatchObject({
      autoAcceptCategoryIds: ["c1"],
      billCostCategory: "insurance",
      syncFrom: "2026-03-01",
    });
  });

  it("sends the books of mapped categories and the default book, and none that nothing maps", () => {
    const settings: KeptSettings = {
      ...empty,
      categoryMap: { c1: "repair" },
      categoryBookMap: { c1: "book-1", c2: "book-2" },
      defaultBookId: "book-3",
    };
    expect(keptConfigOf(settings)).toMatchObject({
      categoryBookMap: { c1: "book-1" },
      defaultBookId: "book-3",
    });
    expect(keptConfigOf(empty)).not.toHaveProperty("defaultBookId");
  });

  it("round-trips through readKeptSettings", () => {
    const settings: KeptSettings = {
      categoryMap: { c1: "repair", c2: "utilities" },
      purchaseCategoryIds: ["c2"],
      autoAcceptCategoryIds: ["c2"],
      categoryBookMap: { c1: "book-1" },
      defaultBookId: "book-2",
      billTasks: true,
      billCreditorFilter: ["Beispiel Strom AG"],
      billCostCategory: "utilities",
      syncFrom: "2026-02-01",
    };
    expect(readKeptSettings(keptConfigOf(settings))).toEqual(settings);
  });
});

describe("withCostCategory", () => {
  it("lets go of the book of a category that is not read any more", () => {
    const settings = {
      ...withCostCategory(empty, "c1", "repair"),
      categoryBookMap: { c1: "book-1" },
    };
    expect(
      withCostCategory(settings, "c1", "utilities").categoryBookMap,
    ).toEqual({
      c1: "book-1",
    });
    expect(withCostCategory(settings, "c1", null).categoryBookMap).toEqual({});
  });
});

describe("keptSettingsSignature", () => {
  it("ignores the order of lists", () => {
    const a = { ...empty, billCreditorFilter: ["A", "B"] };
    const b = { ...empty, billCreditorFilter: ["B", "A"] };
    expect(keptSettingsSignature(a)).toBe(keptSettingsSignature(b));
  });

  it("sees every kind of change", () => {
    const base = keptSettingsSignature(empty);
    const changed: KeptSettings[] = [
      withCostCategory(empty, "c1", "repair"),
      withPurchase(empty, "c1", true),
      { ...empty, billTasks: true },
      withCreditor(empty, "Muster AG"),
      { ...empty, billCostCategory: "other" },
      { ...empty, syncFrom: "2026-01-01" },
      { ...empty, defaultBookId: "book-1" },
      {
        ...withCostCategory(empty, "c1", "repair"),
        categoryBookMap: { c1: "book-1" },
      },
    ];
    for (const settings of changed) {
      expect(keptSettingsSignature(settings)).not.toBe(base);
    }
  });

  it("does not count automatic booking of an unmapped category", () => {
    const settings = { ...empty, autoAcceptCategoryIds: ["c1"] };
    expect(keptSettingsSignature(settings)).toBe(keptSettingsSignature(empty));
  });
});

describe("editing helpers", () => {
  it("maps a category and stops reading it", () => {
    let settings = withCostCategory(empty, "c1", "repair");
    expect(settings.categoryMap).toEqual({ c1: "repair" });
    settings = withCostCategory(settings, "c1", "insurance");
    expect(settings.categoryMap).toEqual({ c1: "insurance" });
    settings = withCostCategory(settings, "c1", null);
    expect(settings.categoryMap).toEqual({});
  });

  it("stops booking automatically when the category is no longer read", () => {
    let settings = withCostCategory(empty, "c1", "repair");
    settings = withAutoAccept(settings, "c1", true);
    expect(settings.autoAcceptCategoryIds).toEqual(["c1"]);
    settings = withCostCategory(settings, "c1", null);
    expect(settings.autoAcceptCategoryIds).toEqual([]);
  });

  it("refuses automatic booking for a category that is not mapped", () => {
    expect(withAutoAccept(empty, "c1", true).autoAcceptCategoryIds).toEqual([]);
  });

  it("keeps a purchase category without a cost mapping", () => {
    const settings = withPurchase(empty, "c1", true);
    expect(settings.purchaseCategoryIds).toEqual(["c1"]);
    expect(withPurchase(settings, "c1", false).purchaseCategoryIds).toEqual([]);
    expect(readCategoryCount(settings)).toBe(1);
  });

  it("counts a category once when it is mapped and a purchase category", () => {
    const settings = withPurchase(
      withCostCategory(empty, "c1", "repair"),
      "c1",
      true,
    );
    expect(readCategoryCount(settings)).toBe(1);
  });

  it("adds a creditor once, ignoring case, and removes it", () => {
    let settings = withCreditor(empty, "  Muster AG ");
    expect(settings.billCreditorFilter).toEqual(["Muster AG"]);
    settings = withCreditor(settings, "muster ag");
    expect(settings.billCreditorFilter).toEqual(["Muster AG"]);
    expect(withCreditor(settings, "   ")).toBe(settings);
    expect(withoutCreditor(settings, "Muster AG").billCreditorFilter).toEqual(
      [],
    );
  });

  it("stops at the creditor limit", () => {
    let settings = empty;
    for (let i = 0; i < KEPT_LIMITS.creditors + 5; i++) {
      settings = withCreditor(settings, `Creditor ${i}`);
    }
    expect(settings.billCreditorFilter).toHaveLength(KEPT_LIMITS.creditors);
  });
});

describe("books of the Kept settings", () => {
  const mapped = withCostCategory(
    withCostCategory(empty, "c1", "groceries"),
    "c2",
    "travel",
  );

  it("names a book for a mapped category and leaves the others to the connection's default", () => {
    const next = withDefaultBook(
      withCategoryBook(mapped, "c1", "b-haushalt"),
      "b-ferien",
    );
    expect(next.categoryBookMap).toEqual({ c1: "b-haushalt" });
    expect(next.defaultBookId).toBe("b-ferien");
  });

  it("takes a book away again with null or an empty id", () => {
    const named = withCategoryBook(mapped, "c1", "b-haushalt");
    expect(withCategoryBook(named, "c1", null).categoryBookMap).toEqual({});
    expect(withCategoryBook(named, "c1", "").categoryBookMap).toEqual({});
    expect(
      withDefaultBook(withDefaultBook(empty, "b1"), null).defaultBookId,
    ).toBe("");
  });

  it("names no book for a category that is not read", () => {
    expect(withCategoryBook(mapped, "other", "b1")).toBe(mapped);
  });

  it("does not change the other settings", () => {
    const next = withDefaultBook(withCategoryBook(mapped, "c1", "b1"), "b2");
    expect(next.categoryMap).toEqual(mapped.categoryMap);
    expect(next.defaultBookId).toBe("b2");
  });

  it("goes to the connection's settings and counts as a change", () => {
    const next = withDefaultBook(withCategoryBook(mapped, "c1", "b1"), "b2");
    expect(keptConfigOf(next)).toMatchObject({
      categoryBookMap: { c1: "b1" },
      defaultBookId: "b2",
    });
    expect(keptSettingsSignature(next)).not.toBe(keptSettingsSignature(mapped));
  });
});

describe("keptBookOptions", () => {
  const book = (over: Partial<CostBook>): CostBook => ({
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
  const books = [
    book({}),
    book({ id: "b2", name: "Haushalt", isDefault: false }),
    book({
      id: "b3",
      name: "Alt",
      isDefault: false,
      archivedAt: "2026-06-01T00:00:00.000Z",
    }),
  ];

  it("offers none and the books that take entries", () => {
    expect(keptBookOptions(books, "", "Standard")).toEqual([
      { value: "", label: "Standard" },
      { value: "b1", label: "Wohnung" },
      { value: "b2", label: "Haushalt" },
    ]);
  });

  it("keeps an archived book that is chosen already, so it can be seen", () => {
    expect(
      keptBookOptions(books, "b3", "Standard").map((o) => o.label),
    ).toEqual(["Standard", "Wohnung", "Haushalt", "Alt (archiviert)"]);
  });

  it("stands in for a book that no longer exists", () => {
    const options = keptBookOptions(books, "gone", "Standard");
    expect(options.at(-1)).toEqual({
      value: "gone",
      label: "Buch nicht mehr vorhanden",
    });
  });

  it("knows an archived book, so the settings can warn that it takes nothing", () => {
    expect(isArchivedBook(books, "b3")).toBe(true);
    expect(isArchivedBook(books, "b1")).toBe(false);
    // no choice, and a book that does not exist (the select says so on its own), are not archived
    expect(isArchivedBook(books, "")).toBe(false);
    expect(isArchivedBook(books, "gone")).toBe(false);
  });
});

describe("keptSettingsError", () => {
  it("says a chosen book no longer exists for a 400 on the settings", () => {
    const message = keptSettingsError(
      new ApiError("invalid_request", "Invalid request", {
        details: { body: { fieldErrors: { config: ["Cost book x"] } } },
      }),
      "https://kept.example.org",
    );
    expect(message).toContain("Buch");
    expect(message).toContain("nicht mehr");
  });

  it("explains the host rule, and words anything else generically", () => {
    expect(
      keptSettingsError(
        new ApiError("forbidden", "The host is not on the list"),
        "https://kept.example.org/path",
      ),
    ).toContain("kept.example.org");
    const other = keptSettingsError(new ApiError("internal", "boom"), "");
    expect(other).toBeTruthy();
    expect(other).not.toContain("Buch");
    // a 400 about something else is not mistaken for the books
    expect(
      keptSettingsError(
        new ApiError("invalid_request", "Invalid request", {
          details: { body: { fieldErrors: { baseUrl: ["bad"] } } },
        }),
        "",
      ),
    ).not.toContain("nicht mehr");
  });
});

describe("categoryRows", () => {
  const list: KeptCategory[] = [
    category({ id: "housing", name: "Housing" }),
    category({ id: "rent", name: "Rent", parentId: "housing" }),
    category({ id: "salary", name: "Salary", kind: "income" }),
    category({ id: "food", name: "Food" }),
    category({ id: "loop-a", name: "Loop A", parentId: "loop-b" }),
    category({ id: "loop-b", name: "Loop B", parentId: "loop-a" }),
  ];

  it("lists expenses first, then income, by full path", () => {
    const rows = categoryRows(list, empty);
    expect(rows.map((r) => r.id)).toEqual([
      "food",
      "housing",
      "rent",
      "loop-b",
      "loop-a",
      "salary",
    ]);
    expect(rows.at(-1)).toMatchObject({ id: "salary", income: true });
  });

  it("shows the parents of a category and survives a loop", () => {
    const rows = categoryRows(list, empty);
    expect(rows.find((r) => r.id === "rent")).toMatchObject({
      name: "Rent",
      parents: "Housing",
    });
    expect(rows.find((r) => r.id === "loop-a")?.parents).toBe("Loop B");
  });

  it("keeps categories Kept no longer lists so they can be dropped", () => {
    const settings = withPurchase(
      withCostCategory(empty, "gone", "repair"),
      "gone-too",
      true,
    );
    const rows = categoryRows(list, settings);
    expect(rows.slice(-2)).toEqual([
      { id: "gone", name: "gone", parents: "", income: false, known: false },
      {
        id: "gone-too",
        name: "gone-too",
        parents: "",
        income: false,
        known: false,
      },
    ]);
  });

  it("shows the mapped categories while the list is not there", () => {
    const rows = categoryRows([], withCostCategory(empty, "c1", "repair"));
    expect(rows.map((r) => r.id)).toEqual(["c1"]);
  });
});

describe("readKeptTestInfo", () => {
  it("reads the missing permissions", () => {
    expect(
      readKeptTestInfo({
        defaultCurrency: "CHF",
        scopes: "transactions:read",
        missingScopes: "bills:read,links:write",
        categoryRestricted: true,
      }),
    ).toEqual({
      currency: "CHF",
      missingScopes: ["bills:read", "links:write"],
      restricted: true,
      backLinksOff: false,
    });
  });

  it("notices when links back to hauswart cannot be written", () => {
    expect(readKeptTestInfo({ backLinks: false }).backLinksOff).toBe(true);
    expect(readKeptTestInfo({ backLinks: true }).backLinksOff).toBe(false);
    // an older answer without the entry says nothing
    expect(readKeptTestInfo({ defaultCurrency: "CHF" }).backLinksOff).toBe(
      false,
    );
  });

  it("treats a complete token and a missing info alike", () => {
    expect(
      readKeptTestInfo({ defaultCurrency: "CHF", missingScopes: "" }),
    ).toEqual({
      currency: "CHF",
      missingScopes: [],
      restricted: false,
      backLinksOff: false,
    });
    expect(readKeptTestInfo(null)).toEqual({
      currency: null,
      missingScopes: [],
      restricted: false,
      backLinksOff: false,
    });
  });
});

describe("errors", () => {
  it("names Kept for the codes of its client, not Home Assistant", () => {
    for (const code of [
      "unauthorized",
      "forbidden",
      "not_found",
      "timeout",
      "network",
      "tls",
      "rate_limited",
      "conflict",
    ]) {
      const message = keptErrorMessage(code);
      expect(message, code).toContain("Kept");
      expect(message, code).not.toContain("Home Assistant");
    }
  });

  it("falls back to the shared wording", () => {
    expect(keptErrorMessage("blocked_host")).not.toContain("Home Assistant");
    expect(keptErrorMessage(null)).toBeTruthy();
    expect(keptErrorMessage("something_new")).toBeTruthy();
  });

  it("explains the host rule when saving is forbidden", () => {
    const failure = keptSaveError(
      new ApiError("forbidden", "The host is not on the list"),
      "https://kept.example.org/path",
    );
    expect(failure.message).toContain("kept.example.org");
    expect(failure.fields).toEqual({});
  });

  it("puts a rejected address on the address field", () => {
    const failure = keptSaveError(
      new ApiError("invalid_request", "Invalid request", {
        details: { body: { fieldErrors: { baseUrl: ["bad"] } } },
      }),
      "http://169.254.169.254",
    );
    expect(failure.message).toBeUndefined();
    expect(Object.keys(failure.fields)).toEqual(["baseUrl"]);
  });

  it("uses the generic wording for anything else", () => {
    const failure = keptSaveError(new ApiError("internal", "boom"), "");
    expect(failure.message).toBeTruthy();
    expect(failure.fields).toEqual({});
  });
});

describe("sync result", () => {
  it("names only what changed", () => {
    const lines = syncStatLines({
      suggestions: 2,
      autoAccepted: 0,
      tasksCreated: 1,
      linksFailed: 3,
      somethingNew: 5,
    });
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("2");
  });

  it("names the suggestions to link a transaction to an entry made by hand, apart from the cost suggestions", () => {
    const lines = syncStatLines({ suggestions: 1, linkSuggestions: 2 });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("1");
    expect(lines[1]).toContain("2");
    expect(lines[1]).toContain("verknüpfen");
    expect(syncStatLines({ linkSuggestions: 1 })).toHaveLength(1);
  });

  it("has nothing to say when nothing happened", () => {
    expect(syncStatLines({ suggestions: 0, skipped: 0 })).toEqual([]);
    expect(syncStatLines({ linkSuggestions: 0 })).toEqual([]);
  });

  it("says when offers wait for a decision", () => {
    expect(offersWaiting({ suggestions: 1 })).toBe(true);
    expect(offersWaiting({ assetSuggestions: 2 })).toBe(true);
    expect(offersWaiting({ linkSuggestions: 1 })).toBe(true);
    expect(offersWaiting({ autoAccepted: 4, tasksCreated: 1 })).toBe(false);
  });
});
