import { describe, expect, it } from "vitest";
import { createCostRequestSchema } from "$lib/api/schemas/costs";
import { ctxAt } from "$lib/testing/domain";
import { useTestDB } from "$lib/testing/db";
import { createCostBookRequestSchema } from "$lib/api/schemas/cost-books";
import { createCostBook, listCostBooks } from "./books";
import { createCost } from "./costs";
import { CSV_BOM, CSV_COLUMNS, costsCsv } from "./csv";

describe("the CSV export and books", () => {
  const test = useTestDB();
  const ctx = () => ctxAt(test.db);
  const book = (name: string) =>
    listCostBooks(ctx(), { includeArchived: true }, { limit: 50 }).items.find(
      (b) => b.name === name,
    )!;
  const cost = (over: Record<string, unknown>) =>
    createCost(
      ctx(),
      createCostRequestSchema.parse({
        title: "Eintrag",
        amountMinor: 1000,
        category: "repair",
        date: "2026-03-10",
        splitMode: "none",
        ...over,
      }),
      null,
    );
  const records = (text: string) =>
    text
      .slice(CSV_BOM.length)
      .split("\r\n")
      .filter((line) => line !== "")
      .map((line) => line.split(";"));

  const BOOK = CSV_COLUMNS.indexOf("book");

  it("keeps the earlier columns where they were and adds the book and then the tags at the end", () => {
    expect(CSV_COLUMNS.slice(0, 16)).toEqual([
      "date",
      "title",
      "amount",
      "currency",
      "category",
      "payee",
      "paid_by",
      "split",
      "counts_as_expense",
      "deductible",
      "asset",
      "room",
      "defect",
      "notes",
      "source",
      "id",
    ]);
    expect(CSV_COLUMNS.slice(16)).toEqual(["book", "tags"]);
    expect(BOOK).toBe(16);
  });

  it("names the book of every entry", () => {
    cost({ title: "Wohnung eins", date: "2026-01-01" });
    cost({
      title: "Haushalt eins",
      date: "2026-02-01",
      bookId: book("Haushalt").id,
    });
    const [header, first, second] = records(costsCsv(ctx(), 2026));
    expect(header[BOOK]).toBe("book");
    expect(first[1]).toBe("Wohnung eins");
    expect(first[BOOK]).toBe("Wohnung");
    expect(first).toHaveLength(CSV_COLUMNS.length);
    expect(second[BOOK]).toBe("Haushalt");
  });

  it("can be limited to one book", () => {
    cost({ title: "Wohnung eins", date: "2026-01-01" });
    cost({
      title: "Haushalt eins",
      date: "2026-02-01",
      bookId: book("Haushalt").id,
    });
    cost({
      title: "Haushalt zwei",
      date: "2026-02-02",
      bookId: book("Haushalt").id,
    });
    const only = records(
      costsCsv(ctx(), 2026, { bookId: book("Haushalt").id }),
    ).slice(1);
    expect(only.map((r) => r[1])).toEqual(["Haushalt eins", "Haushalt zwei"]);
    expect(
      records(costsCsv(ctx(), 2026, { bookId: book("Auto").id })),
    ).toHaveLength(1);
    expect(records(costsCsv(ctx(), 2026))).toHaveLength(4);
  });

  it("defuses a book name that looks like a formula", () => {
    const trick = createCostBook(
      ctx(),
      createCostBookRequestSchema.parse({ name: "=1+1" }),
    );
    cost({ bookId: trick.id });
    expect(records(costsCsv(ctx(), 2026))[1][BOOK]).toBe("'=1+1");
  });
});
