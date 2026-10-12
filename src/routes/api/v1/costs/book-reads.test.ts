import { describe, expect, it } from "vitest";
import { createApiClient } from "$lib/api/client";
import { endpoints } from "$lib/api/registry";
import {
  createCaller,
  createInProcessFetch,
  errorCode,
} from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";

interface Cost {
  id: string;
  bookId: string;
  bookName: string;
  bookTaxRelevant: boolean;
}
type Call = ReturnType<typeof createCaller>;

describe("reading costs by book", () => {
  useTestDB();

  async function setup() {
    const anna = await createTestUser({ displayName: "Anna" });
    const ben = await createTestUser({ displayName: "Ben" });
    const call = createCaller({ session: loginTestUser(anna).token });
    const books = async () =>
      (
        (await call("GET", "/api/v1/cost-books")).body as {
          items: { id: string; name: string }[];
        }
      ).items;
    const bookId = async (name: string) =>
      (await books()).find((b) => b.name === name)!.id;
    const book = async (json: object) =>
      (
        await call("POST", "/api/v1/costs", {
          json: {
            title: "Eintrag",
            amountMinor: 9000,
            category: "groceries",
            ...json,
          },
        })
      ).body as Cost;
    return { anna, ben, call, bookId, book };
  }

  describe("an unknown book is a 404, not an empty answer", () => {
    it.each([
      ["the list", "/api/v1/costs?bookId=nope"],
      ["the summary", "/api/v1/costs/summary?bookId=nope"],
      ["the summary of a year", "/api/v1/costs/summary?year=2026&bookId=nope"],
      ["the CSV", "/api/v1/costs/export.csv?bookId=nope"],
      ["the balances", "/api/v1/costs/balances?bookId=nope"],
      ["the list of payments", "/api/v1/settlements?bookId=nope"],
    ])("for %s", async (_what, path) => {
      const { call } = await setup();
      const answer = await call("GET", path);
      expect(answer.res.status).toBe(404);
      expect(errorCode(answer)).toBe("not_found");
    });

    it("but a book without entries is an empty answer", async () => {
      const { call, bookId } = await setup();
      const auto = await bookId("Auto");
      const list = await call("GET", `/api/v1/costs?bookId=${auto}`);
      expect(list.res.status).toBe(200);
      expect((list.body as { items: unknown[] }).items).toEqual([]);
      expect(
        (await call("GET", `/api/v1/costs/summary?bookId=${auto}`)).res.status,
      ).toBe(200);
      expect(
        (await call("GET", `/api/v1/costs/export.csv?bookId=${auto}`)).res
          .status,
      ).toBe(200);
      const payments = await call("GET", `/api/v1/settlements?bookId=${auto}`);
      expect(payments.res.status).toBe(200);
      expect((payments.body as { items: unknown[] }).items).toEqual([]);
    });

    it("also for an archived book, which still has its entries", async () => {
      const { call, bookId, book } = await setup();
      const auto = await bookId("Auto");
      await book({ bookId: auto });
      await call("PATCH", `/api/v1/cost-books/${auto}`, {
        json: { archived: true },
      });
      const list = await call("GET", `/api/v1/costs?bookId=${auto}`);
      expect((list.body as { items: unknown[] }).items).toHaveLength(1);
    });

    it("needs the read scope like before", async () => {
      const { anna } = await setup();
      const none = createCaller({
        bearer: createTestToken(anna, { scopes: ["costs:write"] }).token,
      });
      expect((await none("GET", "/api/v1/costs?bookId=nope")).res.status).toBe(
        403,
      );
    });
  });

  describe("bookTaxRelevant", () => {
    it("says whether the book of the entry is tax relevant, on every way to read an entry", async () => {
      const { call, bookId, book } = await setup();
      const wohnung = await book({ bookId: await bookId("Wohnung") });
      const haushalt = await book({ bookId: await bookId("Haushalt") });
      expect(wohnung).toMatchObject({
        bookName: "Wohnung",
        bookTaxRelevant: true,
      });
      expect(haushalt).toMatchObject({
        bookName: "Haushalt",
        bookTaxRelevant: false,
      });
      const got = (await call("GET", `/api/v1/costs/${haushalt.id}`))
        .body as Cost;
      expect(got.bookTaxRelevant).toBe(false);
      const list = (await call("GET", "/api/v1/costs")).body as {
        items: Cost[];
      };
      expect(
        Object.fromEntries(
          list.items.map((c) => [c.bookName, c.bookTaxRelevant]),
        ),
      ).toEqual({ Wohnung: true, Haushalt: false });
    });

    it("follows the entry to another book and the book's own setting", async () => {
      const { call, bookId, book } = await setup();
      const entry = await book({ bookId: await bookId("Wohnung") });
      const moved = await call("PATCH", `/api/v1/costs/${entry.id}`, {
        json: { bookId: await bookId("Haushalt") },
      });
      expect((moved.body as Cost).bookTaxRelevant).toBe(false);
      await call("PATCH", `/api/v1/cost-books/${await bookId("Haushalt")}`, {
        json: { taxRelevant: true },
      });
      expect(
        ((await call("GET", `/api/v1/costs/${entry.id}`)).body as Cost)
          .bookTaxRelevant,
      ).toBe(true);
    });

    it("works through the typed client", async () => {
      const user = await createTestUser();
      const client = createApiClient(
        createInProcessFetch({
          bearer: createTestToken(user, { scopes: ["read", "costs:write"] })
            .token,
        }),
      );
      const entry = await client.call(endpoints.costsCreate, {
        body: { title: "Dach", amountMinor: 5000, category: "repair" },
      });
      expect(entry.bookTaxRelevant).toBe(true);
    });
  });

  describe("crossBookSettlements", () => {
    const balances = async (call: Call, q: string) =>
      (await call("GET", `/api/v1/costs/balances${q}`)).body as {
        crossBookSettlements: { count: number; totalMinor: number } | null;
      };

    it("counts what a view of one book leaves out, and is null for all books", async () => {
      const { anna, ben, call, bookId } = await setup();
      for (const json of [
        { amountMinor: 5000 },
        { amountMinor: 1000 },
        { amountMinor: 300, bookId: await bookId("Haushalt") },
      ]) {
        await call("POST", "/api/v1/settlements", {
          json: { fromUserId: ben.id, toUserId: anna.id, ...json },
        });
      }
      const haushalt = await bookId("Haushalt");
      expect(await balances(call, `?bookId=${haushalt}`)).toMatchObject({
        crossBookSettlements: { count: 2, totalMinor: 6000 },
      });
      expect(await balances(call, "?all=true")).toMatchObject({
        crossBookSettlements: null,
      });
      expect(await balances(call, "")).toMatchObject({
        crossBookSettlements: null,
      });
    });
  });
});
