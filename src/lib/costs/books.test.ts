import { describe, expect, it } from "vitest";
import { ApiError } from "$lib/api/errors";
import type { CostBook } from "$lib/api/schemas/cost-books";
import {
  bookConflictMessage,
  bookDefaultMessage,
  bookIconFor,
  bookIconNames,
  bookIcons,
  bookParam,
  chooseBook,
  defaultBook,
  openBooks,
  parseBookParam,
  switcherBooks,
} from "./books";

function book(over: Partial<CostBook> = {}): CostBook {
  return {
    id: "b1",
    name: "Wohnung",
    slug: "wohnung",
    icon: "house",
    defaultSplitMode: "ownership",
    taxRelevant: true,
    archivedAt: null,
    sortOrder: 0,
    isDefault: false,
    entryCount: 0,
    settlementCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

const books = [
  book({ id: "b1", isDefault: true }),
  book({ id: "b2", name: "Haushalt", defaultSplitMode: "equal" }),
  book({
    id: "b3",
    name: "Ferien",
    archivedAt: "2026-06-01T00:00:00.000Z",
    entryCount: 4,
  }),
  book({
    id: "b4",
    name: "Alt",
    archivedAt: "2026-06-01T00:00:00.000Z",
  }),
];

describe("the book in an address", () => {
  it("tells a missing book from every book", () => {
    expect(parseBookParam(null)).toBeNull();
    expect(parseBookParam("")).toBeNull();
    expect(parseBookParam("  ")).toBeNull();
    expect(parseBookParam("all")).toBe("");
    expect(parseBookParam("b2")).toBe("b2");
  });

  it("writes every book as `all` and round-trips", () => {
    expect(bookParam("")).toBe("all");
    expect(bookParam("b2")).toBe("b2");
    for (const id of ["", "b2"]) {
      expect(parseBookParam(bookParam(id))).toBe(id);
    }
  });
});

describe("chooseBook", () => {
  const choose = (
    param: string | null,
    remembered: string | null,
    narrowed = false,
  ) => chooseBook({ param, remembered, books, narrowed });

  it("takes the address first", () => {
    expect(choose("b2", "b1")).toEqual({
      bookId: "b2",
      fromMemory: false,
      staleMemory: false,
    });
    expect(choose("", "b1")).toEqual({
      bookId: "",
      fromMemory: false,
      staleMemory: false,
    });
  });

  it("shows every book for an address that names a book nobody has", () => {
    expect(choose("gone", "b1")).toEqual({
      bookId: "",
      fromMemory: false,
      staleMemory: false,
    });
  });

  it("falls back to the book looked at last", () => {
    expect(choose(null, "b2")).toEqual({
      bookId: "b2",
      fromMemory: true,
      staleMemory: false,
    });
    expect(choose(null, "b3")).toEqual({
      bookId: "b3",
      fromMemory: true,
      staleMemory: false,
    });
  });

  it("ignores a memory that is empty or means every book", () => {
    for (const remembered of [null, ""]) {
      expect(choose(null, remembered)).toEqual({
        bookId: "",
        fromMemory: false,
        staleMemory: false,
      });
    }
  });

  it("shows every book for a memory that names a deleted book, and says the memory is dead", () => {
    expect(choose(null, "deleted")).toEqual({
      bookId: "",
      fromMemory: false,
      staleMemory: true,
    });
    expect(choose(null, "deleted", true).staleMemory).toBe(true);
    expect(choose("b2", "deleted")).toEqual({
      bookId: "b2",
      fromMemory: false,
      staleMemory: true,
    });
  });

  it("never hands on an id that no book has", () => {
    const known = new Set(["", ...books.map((b) => b.id)]);
    for (const param of [null, "", "b1", "b3", "gone", "ALL", " "]) {
      for (const remembered of [null, "", "b2", "b4", "gone", "all"]) {
        for (const narrowed of [false, true]) {
          const { bookId } = choose(param, remembered, narrowed);
          expect(known.has(bookId), `${param} ${remembered}`).toBe(true);
        }
      }
    }
  });

  it("does not hide a narrowed list behind the remembered book", () => {
    expect(choose(null, "b2", true)).toEqual({
      bookId: "",
      fromMemory: false,
      staleMemory: false,
    });
    expect(choose("b1", "b2", true)).toEqual({
      bookId: "b1",
      fromMemory: false,
      staleMemory: false,
    });
  });
});

describe("book lists", () => {
  it("separates the books that take entries from the archived ones", () => {
    expect(openBooks(books).map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  it("offers archived books in the switcher only while they hold something or are on screen", () => {
    expect(switcherBooks(books, "").map((b) => b.id)).toEqual([
      "b1",
      "b2",
      "b3",
    ]);
    expect(switcherBooks(books, "b4").map((b) => b.id)).toEqual([
      "b1",
      "b2",
      "b3",
      "b4",
    ]);
    expect(
      switcherBooks(
        [
          book({
            id: "x",
            archivedAt: "2026-01-01T00:00:00.000Z",
            settlementCount: 1,
          }),
        ],
        "",
      ).length,
    ).toBe(1);
  });

  it("finds the default book, else the first that takes entries", () => {
    expect(defaultBook(books)?.id).toBe("b1");
    expect(
      defaultBook(books.map((b) => ({ ...b, isDefault: false })))?.id,
    ).toBe("b1");
    expect(defaultBook([])).toBeUndefined();
  });
});

describe("book icons", () => {
  it("names every icon and falls back for a key it does not know", () => {
    for (const key of bookIconNames) {
      expect(bookIcons[key]?.label().trim()).not.toBe("");
    }
    expect(bookIconFor("house")).toBe(bookIcons.house?.icon);
    expect(bookIconFor("no-such-icon")).toBe(bookIconFor(null));
    expect(bookIconFor(undefined)).toBe(bookIconFor(null));
  });

  it("knows the icons the migration gave the first three books", () => {
    for (const key of ["house", "shopping-basket", "car"]) {
      expect(bookIconNames).toContain(key);
    }
  });
});

describe("bookConflictMessage", () => {
  const target = { name: "Ferien" };

  it("says how much a book still holds when it cannot be deleted", () => {
    const err = new ApiError("conflict", "x", {
      status: 409,
      details: { entryCount: 3, settlementCount: 1 },
    });
    const text = bookConflictMessage(err, target) ?? "";
    expect(text).toContain("Ferien");
    expect(text).toContain("3 Einträge");
    expect(text).toContain("1 Zahlung");
  });

  it("explains the last open book", () => {
    const err = new ApiError("conflict", "x", { status: 409 });
    expect(bookConflictMessage(err, target)).toContain("letzte");
  });

  it("leaves every other error to the caller", () => {
    expect(
      bookConflictMessage(
        new ApiError("not_found", "x", { status: 404 }),
        target,
      ),
    ).toBeUndefined();
    expect(bookConflictMessage(new Error("boom"), target)).toBeUndefined();
  });
});

describe("bookDefaultMessage", () => {
  const target = { name: "Ferien" };

  it("tells a book that was archived in the meantime to be restored first", () => {
    const err = new ApiError("invalid_request", "x", {
      status: 400,
      details: { body: { fieldErrors: { isDefault: ["x"] } } },
    });
    const text = bookDefaultMessage(err, target) ?? "";
    expect(text).toContain("Ferien");
    expect(text).toContain("archiviert");
  });

  it("explains that the default cannot be switched off", () => {
    const err = new ApiError("conflict", "x", { status: 409 });
    expect(bookDefaultMessage(err, target)).toContain("Standardbuch");
  });

  it("leaves every other error to the caller", () => {
    expect(
      bookDefaultMessage(
        new ApiError("invalid_request", "x", {
          status: 400,
          details: { body: { fieldErrors: { name: ["x"] } } },
        }),
        target,
      ),
    ).toBeUndefined();
    expect(
      bookDefaultMessage(
        new ApiError("not_found", "x", { status: 404 }),
        target,
      ),
    ).toBeUndefined();
    expect(bookDefaultMessage(new Error("boom"), target)).toBeUndefined();
  });
});
