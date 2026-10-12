import { describe, expect, it } from "vitest";
import {
  createCostBookRequestSchema,
  updateCostBookRequestSchema,
} from "$lib/api/schemas/cost-books";
import { updateCostRequestSchema } from "$lib/api/schemas/costs";
import {
  createFuelLogRequestSchema,
  updateFuelLogRequestSchema,
} from "$lib/api/schemas/fuel-logs";
import { putVehicleRequestSchema } from "$lib/api/schemas/vehicles";
import {
  createCostBook,
  deleteCostBook,
  listCostBooks,
  updateCostBook,
} from "$lib/server/costs/books";
import { getCost, updateCost } from "$lib/server/costs/costs";
import { costEntries, fuelLogs } from "$lib/server/db";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt } from "$lib/testing/domain";
import { useTestFilesDir } from "$lib/testing/files";
import { failure, fieldErrors, makeVehicle } from "$lib/testing/vehicles";
import { createFuelLog, getFuelLog, updateFuelLog } from "./fuel-logs";
import { getVehicle, putVehicle } from "./vehicles";

describe("the cost book of a fuel log entry", () => {
  const test = useTestDB();
  useTestFilesDir();
  const ctx = () => ctxAt(test.db);

  async function world() {
    const anna = await createTestUser({ displayName: "Anna" });
    await createTestUser({ displayName: "Ben" });
    const car = makeVehicle(test);
    const books = () =>
      listCostBooks(ctx(), { includeArchived: true }, { limit: 50 }).items;
    const book = (name: string) => {
      const found = books().find((b) => b.name === name);
      if (!found) throw new Error(`no book ${name}`);
      return found;
    };
    const fill = (over: Record<string, unknown> = {}) =>
      createFuelLog(
        ctx(),
        car.id,
        createFuelLogRequestSchema.parse({
          date: "2026-06-01",
          odometer: 80_000,
          quantity: 40,
          amountMinor: 7_200,
          station: "Muster Tankstelle",
          ...over,
        }),
        anna.id,
      );
    const change = (id: string, patch: Record<string, unknown>) =>
      updateFuelLog(
        ctx(),
        id,
        updateFuelLogRequestSchema.parse(patch),
        anna.id,
      );
    const remember = (costBookId: string | null) =>
      putVehicle(ctx(), car.id, putVehicleRequestSchema.parse({ costBookId }));
    const costOf = (log: { costEntryId: string | null }) =>
      getCost(ctx(), log.costEntryId as string);
    const counts = () => ({
      logs: test.db.select().from(fuelLogs).all().length,
      costs: test.db.select().from(costEntries).all().length,
    });
    return { anna, car, book, books, fill, change, remember, costOf, counts };
  }

  describe("a new fill", () => {
    it("goes to the default book and splits as that book says when nothing else is known", async () => {
      const { fill, costOf, book } = await world();
      const log = fill();
      expect(costOf(log)).toMatchObject({
        bookId: book("Wohnung").id,
        splitMode: "ownership",
      });
      expect(log.bookId).toBe(book("Wohnung").id);
    });

    it("follows the default book when that moves", async () => {
      const { fill, costOf, book } = await world();
      updateCostBook(
        ctx(),
        book("Auto").id,
        updateCostBookRequestSchema.parse({ isDefault: true }),
      );
      expect(costOf(fill())).toMatchObject({ bookName: "Auto" });
    });

    it("goes to the book the vehicle remembers and splits as that book says", async () => {
      const { fill, costOf, book, remember } = await world();
      remember(book("Auto").id);
      const log = fill();
      const cost = costOf(log);
      expect(cost).toMatchObject({
        bookId: book("Auto").id,
        bookName: "Auto",
        splitMode: "equal",
      });
      expect(cost.shares.map((s) => s.shareBps)).toEqual([5_000, 5_000]);
      expect(log.bookId).toBe(book("Auto").id);
    });

    it("goes to the book the fill names, whatever the vehicle remembers", async () => {
      const { fill, costOf, book, remember } = await world();
      remember(book("Auto").id);
      expect(costOf(fill({ bookId: book("Haushalt").id })).bookName).toBe(
        "Haushalt",
      );
    });

    it("splits as asked even when the book says otherwise", async () => {
      const { fill, costOf, book, remember } = await world();
      remember(book("Auto").id);
      expect(costOf(fill({ splitMode: "none" }))).toMatchObject({
        bookName: "Auto",
        splitMode: "none",
        shares: [],
      });
    });

    it("falls back to the default book when the remembered book is archived", async () => {
      const { fill, costOf, book, remember } = await world();
      remember(book("Auto").id);
      updateCostBook(
        ctx(),
        book("Auto").id,
        updateCostBookRequestSchema.parse({ archived: true }),
      );
      expect(costOf(fill()).bookName).toBe("Wohnung");
      updateCostBook(
        ctx(),
        book("Auto").id,
        updateCostBookRequestSchema.parse({ archived: false }),
      );
      expect(costOf(fill({ odometer: 80_100 })).bookName).toBe("Auto");
    });

    it("falls back to the default book when the remembered book was deleted", async () => {
      const { fill, costOf, remember, car } = await world();
      const ferien = createCostBook(
        ctx(),
        createCostBookRequestSchema.parse({ name: "Ferien" }),
      );
      remember(ferien.id);
      deleteCostBook(ctx(), ferien.id);
      expect(getVehicle(ctx(), car.id).costBookId).toBeNull();
      expect(costOf(fill()).bookName).toBe("Wohnung");
    });

    it.each([
      ["archived", 7_200],
      ["missing", 7_200],
      ["archived", 0],
      ["missing", 0],
    ])(
      "refuses a %s book for an amount of %i and keeps nothing",
      async (kind, amountMinor) => {
        const { fill, book, counts } = await world();
        const bookId =
          kind === "missing"
            ? "nope"
            : updateCostBook(
                ctx(),
                book("Auto").id,
                updateCostBookRequestSchema.parse({ archived: true }),
              ).id;
        const err = await failure(() => fill({ bookId, amountMinor }));
        expect(err.code).toBe("invalid_request");
        expect(fieldErrors(err, "bookId")).not.toEqual([]);
        expect(counts()).toEqual({ logs: 0, costs: 0 });
      },
    );

    it("a free fill books nothing, so it has no book", async () => {
      const { fill, book, counts } = await world();
      const log = fill({ amountMinor: 0, bookId: book("Haushalt").id });
      expect(log.costEntryId).toBeNull();
      expect(log.bookId).toBeNull();
      expect(counts().costs).toBe(0);
    });
  });

  describe("changing a fill", () => {
    it("moves the cost entry to another book and leaves the fill's own values alone", async () => {
      const { fill, change, costOf, book } = await world();
      const log = fill();
      const moved = change(log.id, { bookId: book("Haushalt").id });
      expect(moved.bookId).toBe(book("Haushalt").id);
      expect(costOf(moved)).toMatchObject({
        bookName: "Haushalt",
        amountMinor: 7_200,
        currency: "CHF",
        date: "2026-06-01",
        // the frozen split stays: moving changes the ledger, not who bears it
        splitMode: "ownership",
      });
      // the entry is still the fill's own
      const err = await failure(() =>
        updateCost(
          ctx(),
          log.costEntryId as string,
          updateCostRequestSchema.parse({ amountMinor: 1 }),
        ),
      );
      expect(err.code).toBe("conflict");
      expect(err.details).toMatchObject({ fuelLogId: log.id });
      // and goes on following the fill
      change(log.id, { amountMinor: 8_000 });
      expect(costOf(log)).toMatchObject({
        amountMinor: 8_000,
        bookName: "Haushalt",
      });
    });

    it("resets a tax class that means nothing in the book it moves to", async () => {
      const { fill, change, costOf, book } = await world();
      const log = fill();
      updateCost(
        ctx(),
        log.costEntryId as string,
        updateCostRequestSchema.parse({ deductible: "maintenance" }),
      );
      expect(costOf(log).deductible).toBe("maintenance");
      change(log.id, { bookId: book("Haushalt").id });
      expect(costOf(log).deductible).toBe("unknown");
    });

    it("keeps the book on other changes", async () => {
      const { fill, change, costOf, book } = await world();
      const log = fill({ bookId: book("Auto").id });
      change(log.id, { station: "Andere Tankstelle", date: "2026-05-30" });
      expect(costOf(log)).toMatchObject({
        bookName: "Auto",
        title: "Tanken Andere Tankstelle",
      });
    });

    it("accepts the book the entry is in, even when it is archived, and refuses a book that is not open", async () => {
      const { fill, change, costOf, book, counts } = await world();
      const log = fill({ bookId: book("Auto").id });
      updateCostBook(
        ctx(),
        book("Auto").id,
        updateCostBookRequestSchema.parse({ archived: true }),
      );
      expect(change(log.id, { bookId: book("Auto").id }).bookId).toBe(
        book("Auto").id,
      );

      const before = counts();
      const missing = await failure(() => change(log.id, { bookId: "nope" }));
      expect(missing.code).toBe("invalid_request");
      expect(fieldErrors(missing, "bookId")).not.toEqual([]);
      const ferien = createCostBook(
        ctx(),
        createCostBookRequestSchema.parse({ name: "Ferien" }),
      );
      updateCostBook(
        ctx(),
        ferien.id,
        updateCostBookRequestSchema.parse({ archived: true }),
      );
      const archived = await failure(() =>
        change(log.id, { bookId: ferien.id }),
      );
      expect(fieldErrors(archived, "bookId")).not.toEqual([]);
      expect(costOf(log).bookName).toBe("Auto");
      expect(counts()).toEqual(before);
    });

    it("on a free fill changes nothing, but a bad book is still refused", async () => {
      const { fill, change, book, counts } = await world();
      const log = fill({ amountMinor: 0 });
      expect(change(log.id, { bookId: book("Haushalt").id })).toMatchObject({
        costEntryId: null,
        bookId: null,
      });
      expect(counts().costs).toBe(0);
      const err = await failure(() => change(log.id, { bookId: "nope" }));
      expect(fieldErrors(err, "bookId")).not.toEqual([]);
    });

    it("books a fill that starts costing money into the book named, else the vehicle's, else the default", async () => {
      const { fill, change, costOf, book, remember } = await world();
      const named = change(fill({ amountMinor: 0 }).id, {
        amountMinor: 5_000,
        bookId: book("Haushalt").id,
      });
      expect(costOf(named).bookName).toBe("Haushalt");

      remember(book("Auto").id);
      const remembered = change(fill({ amountMinor: 0, odometer: 80_100 }).id, {
        amountMinor: 5_000,
      });
      expect(costOf(remembered)).toMatchObject({
        bookName: "Auto",
        splitMode: "equal",
      });
    });

    it("a fill that became free loses its cost entry and so its book", async () => {
      const { fill, change, book } = await world();
      const log = fill({ bookId: book("Auto").id });
      const free = change(log.id, { amountMinor: 0 });
      expect(free).toMatchObject({ costEntryId: null, bookId: null });
      expect(getFuelLog(ctx(), log.id).bookId).toBeNull();
    });
  });

  describe("the book the vehicle remembers", () => {
    it("is saved with the details, read back and cleared when a save leaves it out", async () => {
      const { car, book, remember } = await world();
      expect(getVehicle(ctx(), car.id).costBookId).toBeNull();
      expect(remember(book("Auto").id).costBookId).toBe(book("Auto").id);
      expect(getVehicle(ctx(), car.id).costBookId).toBe(book("Auto").id);
      putVehicle(
        ctx(),
        car.id,
        putVehicleRequestSchema.parse({ plate: "ZH 000000" }),
      );
      expect(getVehicle(ctx(), car.id)).toMatchObject({
        plate: "ZH 000000",
        costBookId: null,
      });
    });

    it("must be a book that exists and is open, unless it is the one the vehicle has already", async () => {
      const { car, book, remember } = await world();
      const missing = await failure(() => remember("nope"));
      expect(missing.code).toBe("invalid_request");
      expect(fieldErrors(missing, "costBookId")).not.toEqual([]);

      remember(book("Auto").id);
      updateCostBook(
        ctx(),
        book("Auto").id,
        updateCostBookRequestSchema.parse({ archived: true }),
      );
      // saving the details again does not trip over the archived book the vehicle has
      expect(remember(book("Auto").id).costBookId).toBe(book("Auto").id);
      const ferien = createCostBook(
        ctx(),
        createCostBookRequestSchema.parse({ name: "Ferien" }),
      );
      updateCostBook(
        ctx(),
        ferien.id,
        updateCostBookRequestSchema.parse({ archived: true }),
      );
      const archived = await failure(() => remember(ferien.id));
      expect(fieldErrors(archived, "costBookId")).not.toEqual([]);
      expect(getVehicle(ctx(), car.id).costBookId).toBe(book("Auto").id);
    });
  });
});
