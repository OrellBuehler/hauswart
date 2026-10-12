import { describe, expect, it } from "vitest";
import {
  createCostBookRequestSchema,
  updateCostBookRequestSchema,
} from "$lib/api/schemas/cost-books";
import {
  createCostRequestSchema,
  moveCostsToBookRequestSchema,
  updateCostRequestSchema,
} from "$lib/api/schemas/costs";
import { createFuelLogRequestSchema } from "$lib/api/schemas/fuel-logs";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt } from "$lib/testing/domain";
import { useTestFilesDir } from "$lib/testing/files";
import { failure, fieldErrors, makeVehicle } from "$lib/testing/vehicles";
import { costEntries } from "$lib/server/db";
import { clockAt } from "$lib/server/tasks/evaluator";
import { createFuelLog, updateFuelLog } from "$lib/server/vehicles/fuel-logs";
import { costBalances } from "./balances";
import { createCostBook, listCostBooks, updateCostBook } from "./books";
import { createCost, getCost, updateCost } from "./costs";
import { moveCostsToBook } from "./move";

describe("moving cost entries to another book", () => {
  const test = useTestDB();
  useTestFilesDir();
  const ctx = () => ctxAt(test.db);

  /** The year of an entry booked today, as the first and last year of the entries that move. */
  const thisYear = () => {
    const year = Number(clockAt(ctx().now).today.slice(0, 4));
    return { from: year, to: year };
  };

  async function world() {
    const anna = await createTestUser({ displayName: "Anna" });
    const ben = await createTestUser({ displayName: "Ben" });
    const book = (name: string) => {
      const found = listCostBooks(
        ctx(),
        { includeArchived: true },
        { limit: 50 },
      ).items.find((b) => b.name === name);
      if (!found) throw new Error(`no book ${name}`);
      return found;
    };
    const cost = (over: Record<string, unknown> = {}) =>
      createCost(
        ctx(),
        createCostRequestSchema.parse({
          title: "Eintrag",
          amountMinor: 9_001,
          category: "maintenance",
          paidByUserId: anna.id,
          ...over,
        }),
        anna.id,
      );
    const move = (body: Record<string, unknown>) =>
      moveCostsToBook(ctx(), moveCostsToBookRequestSchema.parse(body));
    return { anna, ben, book, cost, move };
  }

  it("moves the entries named and counts those that were in the book already", async () => {
    const { book, cost, move } = await world();
    const a = cost({ title: "A" });
    const b = cost({ title: "B" });
    const c = cost({ title: "C", bookId: book("Haushalt").id });
    expect(
      move({ bookId: book("Haushalt").id, ids: [a.id, b.id, c.id] }),
    ).toEqual({
      bookId: book("Haushalt").id,
      moved: 2,
      unchanged: 1,
      deductibleReset: 0,
      dryRun: false,
      years: thisYear(),
    });
    for (const id of [a.id, b.id, c.id]) {
      expect(getCost(ctx(), id).bookName).toBe("Haushalt");
    }
  });

  it("changes the ledger only: payer, split and frozen shares stay", async () => {
    const { anna, ben, book, cost, move } = await world();
    const entry = cost({
      amountMinor: 10_001,
      splitMode: "custom",
      shares: [
        { userId: anna.id, shareBps: 7_000 },
        { userId: ben.id, shareBps: 3_000 },
      ],
    });
    const before = getCost(ctx(), entry.id);
    move({ bookId: book("Auto").id, ids: [entry.id] });
    const after = getCost(ctx(), entry.id);
    const without = (record: object) => {
      const rest = { ...record } as Record<string, unknown>;
      for (const key of [
        "bookId",
        "bookName",
        "bookTaxRelevant",
        "updatedAt",
      ]) {
        delete rest[key];
      }
      return rest;
    };
    expect(after.bookId).toBe(book("Auto").id);
    expect(after.bookName).toBe("Auto");
    expect(after.updatedAt).toBeInstanceOf(Date);
    expect(without(after)).toEqual(without(before));
  });

  it("makes the balances follow the entries", async () => {
    const { anna, ben, book, cost, move } = await world();
    const entry = cost({ amountMinor: 10_000, splitMode: "equal" });
    const owed = (bookId?: string) =>
      Object.fromEntries(
        costBalances(ctx(), { bookId }).people.map((p) => [
          p.userName,
          p.balanceMinor,
        ]),
      );
    expect(owed(book("Wohnung").id)).toEqual({ Anna: 5_000, Ben: -5_000 });
    expect(owed(book("Haushalt").id)).toEqual({ Anna: 0, Ben: 0 });
    move({ bookId: book("Haushalt").id, ids: [entry.id] });
    expect(owed(book("Wohnung").id)).toEqual({ Anna: 0, Ben: 0 });
    expect(owed(book("Haushalt").id)).toEqual({ Anna: 5_000, Ben: -5_000 });
    // across all books nothing changed
    expect(owed()).toEqual({ Anna: 5_000, Ben: -5_000 });
    expect([anna.id, ben.id]).toHaveLength(2);
  });

  it("counts an entry once however often it is named", async () => {
    const { book, cost, move } = await world();
    const a = cost();
    expect(
      move({ bookId: book("Haushalt").id, ids: [a.id, a.id, a.id] }),
    ).toMatchObject({ moved: 1, unchanged: 0 });
  });

  describe("a dry run", () => {
    const snapshot = () =>
      test.db
        .select()
        .from(costEntries)
        .all()
        .map((e) => [e.id, e.bookId, e.deductible, e.updatedAt.getTime()])
        .sort();

    it("answers what the move would do, with the years of the entries that move, and writes nothing", async () => {
      const { book, cost, move } = await world();
      const classified = cost({
        title: "Dach",
        date: "2024-03-01",
        deductible: "maintenance",
      });
      const plain = cost({ title: "Ohne", date: "2026-01-02" });
      const middle = cost({
        title: "Mitte",
        date: "2025-07-01",
        deductible: "investment",
      });
      const there = cost({
        title: "Schon da",
        date: "2019-01-01",
        bookId: book("Haushalt").id,
      });
      const ids = [classified.id, plain.id, middle.id, there.id];
      const before = snapshot();

      const preview = move({ bookId: book("Haushalt").id, ids, dryRun: true });
      expect(preview).toEqual({
        bookId: book("Haushalt").id,
        moved: 3,
        unchanged: 1,
        deductibleReset: 2,
        dryRun: true,
        years: { from: 2024, to: 2026 },
      });
      expect(snapshot()).toEqual(before);
      expect(getCost(ctx(), classified.id).deductible).toBe("maintenance");

      // The move itself does exactly what was announced.
      expect(move({ bookId: book("Haushalt").id, ids })).toEqual({
        ...preview,
        dryRun: false,
      });
      expect(getCost(ctx(), classified.id)).toMatchObject({
        bookName: "Haushalt",
        deductible: "unknown",
      });
    });

    it("does the same for every entry of a device, however old", async () => {
      const { book, cost, move } = await world();
      const car = makeVehicle(test);
      cost({ assetId: car.id, date: "2023-12-31", deductible: "maintenance" });
      cost({ assetId: car.id, date: "2026-01-01" });
      cost({ assetId: car.id, date: "2021-05-05", bookId: book("Auto").id });
      cost({ date: "2010-01-01" });
      const before = snapshot();
      expect(
        move({ bookId: book("Auto").id, assetId: car.id, dryRun: true }),
      ).toEqual({
        bookId: book("Auto").id,
        moved: 2,
        unchanged: 1,
        deductibleReset: 1,
        dryRun: true,
        years: { from: 2023, to: 2026 },
      });
      expect(snapshot()).toEqual(before);
    });

    it("resets nothing in a book that is tax relevant, and has no years when nothing moves", async () => {
      const { book, cost, move } = await world();
      const a = cost({ date: "2025-02-02", deductible: "maintenance" });
      cost({ date: "2025-02-03", deductible: "maintenance" });
      const relevant = createCostBook(
        ctx(),
        createCostBookRequestSchema.parse({ name: "Anbau", taxRelevant: true }),
      );
      expect(
        move({ bookId: relevant.id, ids: [a.id], dryRun: true }),
      ).toMatchObject({
        moved: 1,
        deductibleReset: 0,
        years: { from: 2025, to: 2025 },
      });
      expect(
        move({ bookId: book("Wohnung").id, ids: [a.id], dryRun: true }),
      ).toEqual({
        bookId: book("Wohnung").id,
        moved: 0,
        unchanged: 1,
        deductibleReset: 0,
        dryRun: true,
        years: null,
      });
    });

    it("refuses what the move would refuse", async () => {
      const { book, cost, move } = await world();
      const a = cost();
      updateCostBook(
        ctx(),
        book("Auto").id,
        updateCostBookRequestSchema.parse({ archived: true }),
      );
      const before = snapshot();
      const unknownId = await failure(() =>
        move({
          bookId: book("Haushalt").id,
          ids: [a.id, "nope"],
          dryRun: true,
        }),
      );
      expect(fieldErrors(unknownId, "ids")).not.toEqual([]);
      const archived = await failure(() =>
        move({ bookId: book("Auto").id, ids: [a.id], dryRun: true }),
      );
      expect(fieldErrors(archived, "bookId")).not.toEqual([]);
      const unknownDevice = await failure(() =>
        move({ bookId: book("Haushalt").id, assetId: "nope", dryRun: true }),
      );
      expect(fieldErrors(unknownDevice, "assetId")).not.toEqual([]);
      expect(snapshot()).toEqual(before);
    });

    it("is a boolean in the request, and nothing else", () => {
      const parse = (body: unknown) =>
        moveCostsToBookRequestSchema.safeParse(body).success;
      expect(parse({ bookId: "b", ids: ["a"], dryRun: true })).toBe(true);
      expect(parse({ bookId: "b", ids: ["a"], dryRun: false })).toBe(true);
      expect(parse({ bookId: "b", ids: ["a"], dryRun: "yes" })).toBe(false);
    });
  });

  describe("the tax class", () => {
    it("is reset when the book is not tax relevant, and kept when it is", async () => {
      const { book, cost, move } = await world();
      const classified = cost({ title: "Dach", deductible: "maintenance" });
      const plain = cost({ title: "Ohne" });
      const other = cost({ title: "Anbau", deductible: "investment" });
      expect(
        move({
          bookId: book("Haushalt").id,
          ids: [classified.id, plain.id],
        }),
      ).toEqual({
        bookId: book("Haushalt").id,
        moved: 2,
        unchanged: 0,
        deductibleReset: 1,
        dryRun: false,
        years: thisYear(),
      });
      expect(getCost(ctx(), classified.id).deductible).toBe("unknown");

      // back into the tax relevant book: nothing to reset, and a class set meanwhile is not touched
      move({ bookId: book("Wohnung").id, ids: [classified.id] });
      updateCost(
        ctx(),
        classified.id,
        updateCostRequestSchema.parse({ deductible: "maintenance" }),
      );
      expect(
        move({ bookId: book("Wohnung").id, ids: [classified.id, other.id] }),
      ).toMatchObject({ moved: 0, unchanged: 2, deductibleReset: 0 });
      expect(getCost(ctx(), classified.id).deductible).toBe("maintenance");
      expect(getCost(ctx(), other.id).deductible).toBe("investment");
    });

    it("does not reset entries that stay where they are", async () => {
      const { book, cost, move } = await world();
      const inHaushalt = cost({ bookId: book("Haushalt").id });
      // a book that stopped being tax relevant keeps what its entries say
      const ferien = createCostBook(
        ctx(),
        createCostBookRequestSchema.parse({
          name: "Ferien",
          taxRelevant: true,
        }),
      );
      const old = cost({
        bookId: ferien.id,
        deductible: "maintenance",
      });
      updateCostBook(
        ctx(),
        ferien.id,
        updateCostBookRequestSchema.parse({ taxRelevant: false }),
      );
      expect(
        move({ bookId: ferien.id, ids: [old.id, inHaushalt.id] }),
      ).toMatchObject({ moved: 1, unchanged: 1, deductibleReset: 0 });
      expect(getCost(ctx(), old.id).deductible).toBe("maintenance");
    });
  });

  describe("refuses, and moves nothing", () => {
    it("an id that does not exist", async () => {
      const { book, cost, move } = await world();
      const a = cost();
      const err = await failure(() =>
        move({ bookId: book("Haushalt").id, ids: [a.id, "nope", "nada"] }),
      );
      expect(err.code).toBe("invalid_request");
      expect(fieldErrors(err, "ids")).toEqual([
        "2 of the cost entries do not exist",
      ]);
      expect(getCost(ctx(), a.id).bookName).toBe("Wohnung");
    });

    it("a book that is archived or does not exist", async () => {
      const { book, cost, move } = await world();
      const a = cost();
      updateCostBook(
        ctx(),
        book("Auto").id,
        updateCostBookRequestSchema.parse({ archived: true }),
      );
      for (const bookId of [book("Auto").id, "nope"]) {
        const err = await failure(() => move({ bookId, ids: [a.id] }));
        expect(err.code).toBe("invalid_request");
        expect(fieldErrors(err, "bookId")).not.toEqual([]);
      }
      expect(getCost(ctx(), a.id).bookName).toBe("Wohnung");
    });

    it("a device that does not exist", async () => {
      const { book, move } = await world();
      const err = await failure(() =>
        move({ bookId: book("Auto").id, assetId: "nope" }),
      );
      expect(fieldErrors(err, "assetId")).not.toEqual([]);
    });

    it("a request that names neither or both of ids and assetId, too many ids or another field", () => {
      const parse = (body: unknown) =>
        moveCostsToBookRequestSchema.safeParse(body).success;
      expect(parse({ bookId: "b" })).toBe(false);
      expect(parse({ bookId: "b", ids: ["a"], assetId: "x" })).toBe(false);
      expect(parse({ bookId: "b", ids: [] })).toBe(false);
      expect(
        parse({
          bookId: "b",
          ids: Array.from({ length: 501 }, (_, i) => `id${i}`),
        }),
      ).toBe(false);
      expect(parse({ ids: ["a"] })).toBe(false);
      expect(parse({ bookId: "b", ids: ["a"], note: "x" })).toBe(false);
      expect(parse({ bookId: "b", ids: ["a"] })).toBe(true);
      expect(parse({ bookId: "b", assetId: "x" })).toBe(true);
      expect(
        parse({
          bookId: "b",
          ids: Array.from({ length: 500 }, (_, i) => `id${i}`),
        }),
      ).toBe(true);
    });
  });

  it("moves entries out of an archived book", async () => {
    const { book, cost, move } = await world();
    const a = cost({ bookId: book("Auto").id });
    updateCostBook(
      ctx(),
      book("Auto").id,
      updateCostBookRequestSchema.parse({ archived: true }),
    );
    expect(move({ bookId: book("Haushalt").id, ids: [a.id] }).moved).toBe(1);
  });

  it("leaves the entries that stay alone", async () => {
    const { book, cost, move } = await world();
    const stays = cost({ bookId: book("Haushalt").id });
    const before = getCost(ctx(), stays.id).updatedAt;
    move({ bookId: book("Haushalt").id, ids: [stays.id] });
    expect(getCost(ctx(), stays.id).updatedAt).toEqual(before);
  });

  describe("every entry of a device", () => {
    it("moves them all, and only those", async () => {
      const { book, cost, move } = await world();
      const car = makeVehicle(test);
      const other = makeVehicle(test, "Zweitauto");
      const a = cost({ assetId: car.id });
      const b = cost({ assetId: car.id, bookId: book("Auto").id });
      const c = cost({ assetId: other.id });
      const d = cost();
      expect(move({ bookId: book("Auto").id, assetId: car.id })).toEqual({
        bookId: book("Auto").id,
        moved: 1,
        unchanged: 1,
        deductibleReset: 0,
        dryRun: false,
        years: thisYear(),
      });
      expect(getCost(ctx(), a.id).bookName).toBe("Auto");
      expect(getCost(ctx(), b.id).bookName).toBe("Auto");
      expect(getCost(ctx(), c.id).bookName).toBe("Wohnung");
      expect(getCost(ctx(), d.id).bookName).toBe("Wohnung");
    });

    it("answers with zeros for a device without entries", async () => {
      const { book, move } = await world();
      const car = makeVehicle(test);
      expect(move({ bookId: book("Auto").id, assetId: car.id })).toEqual({
        bookId: book("Auto").id,
        moved: 0,
        unchanged: 0,
        deductibleReset: 0,
        dryRun: false,
        years: null,
      });
    });

    it("moves the entries fuel log entries booked, which stay the fill's own", async () => {
      const { anna, book, cost, move } = await world();
      const car = makeVehicle(test);
      const fill = createFuelLog(
        ctx(),
        car.id,
        createFuelLogRequestSchema.parse({
          date: "2026-06-01",
          odometer: 80_000,
          quantity: 40,
          amountMinor: 7_200,
        }),
        anna.id,
      );
      cost({ assetId: car.id, title: "Service" });
      expect(move({ bookId: book("Auto").id, assetId: car.id })).toMatchObject({
        moved: 2,
        unchanged: 0,
      });
      expect(getCost(ctx(), fill.costEntryId as string)).toMatchObject({
        bookName: "Auto",
        fuelLogId: fill.id,
      });

      // The lock covers amount, currency, date and device, not the ledger.
      const locked = await failure(() =>
        updateCost(
          ctx(),
          fill.costEntryId as string,
          updateCostRequestSchema.parse({ amountMinor: 1 }),
        ),
      );
      expect(locked.code).toBe("conflict");
      expect(locked.details).toMatchObject({ fuelLogId: fill.id });
      expect(
        updateCost(
          ctx(),
          fill.costEntryId as string,
          updateCostRequestSchema.parse({ bookId: book("Haushalt").id }),
        ).bookName,
      ).toBe("Haushalt");

      // and the fill still moves its amount
      updateFuelLog(ctx(), fill.id, { amountMinor: 8_000 }, anna.id);
      expect(getCost(ctx(), fill.costEntryId as string)).toMatchObject({
        amountMinor: 8_000,
        bookName: "Haushalt",
      });
    });
  });
});
