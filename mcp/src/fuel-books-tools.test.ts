import { describe, expect, it } from "vitest";
import { createCostBookRequestSchema } from "../../src/lib/api/schemas/cost-books";
import {
  createCostBook,
  updateCostBook,
} from "../../src/lib/server/costs/books";
import { ctxAt } from "../../src/lib/testing/domain";
import { createVehicle, useMcp } from "./test-harness";

const ALL = ["read", "write", "costs:write"] as const;

describe("add_fuel_log and the cost books", () => {
  const mcp = useMcp();

  async function connect() {
    const session = await mcp.connect({ scopes: [...ALL] });
    const bookId = async (name: string) =>
      (await session.ok("list_cost_books")).books.find(
        (b: { name: string }) => b.name === name,
      ).id as string;
    const fill = (extra: Record<string, unknown> = {}) =>
      session.ok("add_fuel_log", {
        vehicle: "Familienauto",
        odometer: 80_000,
        quantity: 40,
        amount: "72.00",
        ...extra,
      });
    return { ...session, bookId, fill };
  }

  it("books into the book given by name and says which one it was", async () => {
    const s = await connect();
    await createVehicle(s, "Familienauto", "ZH 000000");
    const logged = await s.fill({ book: "Auto" });
    expect(logged.book).toBe("Auto");
    const costs = await s.ok("list_costs", { book: "Auto" });
    expect(costs.costs).toMatchObject([
      { id: logged.costEntryId, book: "Auto", split: "equal" },
    ]);
  });

  it("books into the default book when neither the call nor the vehicle names one", async () => {
    const s = await connect();
    await createVehicle(s, "Familienauto", "ZH 000000");
    const logged = await s.fill();
    expect(logged.book).toBe("Wohnung");
    expect((await s.ok("list_costs")).costs[0]).toMatchObject({
      book: "Wohnung",
      split: "ownership",
    });
  });

  it("books into the book the vehicle remembers, and the call's own book wins over it", async () => {
    const s = await connect();
    await createVehicle(s, "Familienauto", "ZH 000000", {
      costBookId: await s.bookId("Auto"),
    });
    expect((await s.fill()).book).toBe("Auto");
    expect((await s.fill({ book: "Haushalt", odometer: 80_100 })).book).toBe(
      "Haushalt",
    );
  });

  it("splits as asked even when the book says otherwise", async () => {
    const s = await connect();
    await createVehicle(s, "Familienauto", "ZH 000000");
    await s.fill({ book: "Auto", split: "none" });
    expect((await s.ok("list_costs")).costs[0]).toMatchObject({
      book: "Auto",
      split: "none",
    });
  });

  it("says which books exist when one does not, and refuses an archived one", async () => {
    const s = await connect();
    await createVehicle(s, "Familienauto", "ZH 000000");
    const missing = await s.call("add_fuel_log", {
      vehicle: "Familienauto",
      odometer: 80_000,
      quantity: 40,
      amount: "72.00",
      book: "Segeln",
    });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("[not_found]");
    expect(missing.text).toContain("Wohnung, Haushalt, Auto");

    const ctx = ctxAt(mcp.db.db);
    const ferien = createCostBook(
      ctx,
      createCostBookRequestSchema.parse({ name: "Ferien" }),
    );
    updateCostBook(ctx, ferien.id, { archived: true });
    const archived = await s.call("add_fuel_log", {
      vehicle: "Familienauto",
      odometer: 80_000,
      quantity: 40,
      amount: "72.00",
      book: "Ferien",
    });
    expect(archived.isError).toBe(true);
    expect(archived.text).toContain("bookId");
    expect(
      (await s.ok("list_fuel_logs", { vehicle: "Familienauto" })).fills,
    ).toEqual([]);
  });
});
