import { describe, expect, it } from "vitest";
import { createCostBookRequestSchema } from "$lib/api/schemas/cost-books";
import { createCostRequestSchema } from "$lib/api/schemas/costs";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt, NOW } from "$lib/testing/domain";
import { failure } from "$lib/testing/vehicles";
import { createCostBook, listCostBooks, updateCostBook } from "./books";
import { createCost } from "./costs";
import { recentCategories } from "./recent-categories";

describe("the categories used lately", () => {
  const test = useTestDB();
  const ctx = (now = NOW) => ctxAt(test.db, now);

  async function world() {
    const anna = await createTestUser({ displayName: "Anna" });
    const book = (name: string) =>
      listCostBooks(ctx(), { includeArchived: true }, { limit: 50 }).items.find(
        (b) => b.name === name,
      )!;
    const cost = (over: Record<string, unknown>, now = NOW) =>
      createCost(
        ctx(now),
        createCostRequestSchema.parse({
          title: "Eintrag",
          amountMinor: 1_000,
          category: "groceries",
          date: "2026-06-10",
          ...over,
        }),
        anna.id,
      );
    return { anna, book, cost };
  }

  it("is empty while nothing is booked", async () => {
    await world();
    expect(recentCategories(ctx(), {})).toEqual({
      entriesPerBook: 100,
      items: [],
    });
  });

  it("counts the categories per book, most used first, books in their order", async () => {
    const { book, cost } = await world();
    const home = book("Haushalt").id;
    const flat = book("Wohnung").id;
    for (const category of ["dining", "groceries", "dining", "dining"]) {
      cost({ bookId: home, category });
    }
    cost({ bookId: flat, category: "repair" });
    cost({ bookId: flat, category: "utilities" });
    cost({ bookId: flat, category: "repair" });
    const { items } = recentCategories(ctx(), {});
    expect(items).toEqual([
      { bookId: flat, category: "repair", count: 2 },
      { bookId: flat, category: "utilities", count: 1 },
      { bookId: home, category: "dining", count: 3 },
      { bookId: home, category: "groceries", count: 1 },
    ]);
  });

  it("looks at the newest entries of each book only", async () => {
    const { book, cost } = await world();
    const home = book("Haushalt").id;
    const flat = book("Wohnung").id;
    // oldest first by date: three of 'dining', then two newer 'repair'
    for (const date of ["2026-01-01", "2026-01-02", "2026-01-03"]) {
      cost({ bookId: home, category: "dining", date });
    }
    for (const date of ["2026-05-01", "2026-05-02"]) {
      cost({ bookId: home, category: "repair", date });
    }
    // another book's entries do not push these out of the window
    for (let i = 0; i < 5; i++) cost({ bookId: flat, category: "other" });
    const { items, entriesPerBook } = recentCategories(
      ctx(),
      {},
      { entries: 3 },
    );
    expect(entriesPerBook).toBe(3);
    expect(items.filter((i) => i.bookId === home)).toEqual([
      { bookId: home, category: "repair", count: 2 },
      { bookId: home, category: "dining", count: 1 },
    ]);
    expect(items.filter((i) => i.bookId === flat)).toEqual([
      { bookId: flat, category: "other", count: 3 },
    ]);
  });

  it("orders by date, then by when the entry was made, when it picks the newest", async () => {
    const { book, cost } = await world();
    const home = book("Haushalt").id;
    cost({ bookId: home, category: "gifts", date: "2026-06-10" }, NOW);
    cost({ bookId: home, category: "travel", date: "2026-06-10" }, NOW + 1_000);
    const { items } = recentCategories(ctx(), {}, { entries: 1 });
    expect(items).toEqual([{ bookId: home, category: "travel", count: 1 }]);
  });

  it("answers for one book when asked, archived ones too, and counts refunds and other currencies", async () => {
    const { book, cost } = await world();
    const trip = createCostBook(
      ctx(),
      createCostBookRequestSchema.parse({ name: "Reise" }),
    );
    cost({ bookId: trip.id, category: "travel" });
    cost({ bookId: trip.id, category: "travel", amountMinor: -500 });
    cost({ bookId: trip.id, category: "dining", currency: "EUR" });
    cost({ bookId: book("Haushalt").id, category: "other" });
    updateCostBook(ctx(), trip.id, { archived: true });
    expect(recentCategories(ctx(), { bookId: trip.id }).items).toEqual([
      { bookId: trip.id, category: "travel", count: 2 },
      { bookId: trip.id, category: "dining", count: 1 },
    ]);
  });

  it("is a 404 for a book that does not exist", async () => {
    await world();
    const err = await failure(() =>
      recentCategories(ctx(), { bookId: "nope" }),
    );
    expect(err.code).toBe("not_found");
  });
});
