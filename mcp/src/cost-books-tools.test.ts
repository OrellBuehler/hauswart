import { describe, expect, it } from "vitest";
import {
  createCostBook,
  updateCostBook,
} from "../../src/lib/server/costs/books";
import { createCostBookRequestSchema } from "../../src/lib/api/schemas/cost-books";
import { ctxAt } from "../../src/lib/testing/domain";
import { useMcp } from "./test-harness";

const ALL = ["read", "write", "costs:write"] as const;

describe("cost book tools", () => {
  const mcp = useMcp();

  describe("list_cost_books", () => {
    it("lists the books with their defaults, and which one takes entries without a book", async () => {
      const { ok, call } = await mcp.connect({ scopes: ["read"] });
      const reply = await call("list_cost_books");
      expect(reply.summary).toBe("3 cost books (default: Wohnung).");
      const { books } = await ok("list_cost_books");
      expect(books.map((b: { name: string }) => b.name)).toEqual([
        "Wohnung",
        "Haushalt",
        "Auto",
      ]);
      expect(books[0]).toMatchObject({
        name: "Wohnung",
        defaultSplit: "ownership",
        taxRelevant: true,
        isDefault: true,
        entries: 0,
      });
      expect(books[1]).toMatchObject({ defaultSplit: "equal" });
      expect(books[1].isDefault).toBeUndefined();
      expect(books[1].taxRelevant).toBeUndefined();
    });

    it("leaves archived books out unless asked", async () => {
      const c = await mcp.connect({ scopes: ["read"] });
      const ctx = ctxAt(mcp.db.db);
      const ferien = createCostBook(
        ctx,
        createCostBookRequestSchema.parse({ name: "Ferien" }),
      );
      updateCostBook(ctx, ferien.id, { archived: true });
      expect((await c.ok("list_cost_books")).books).toHaveLength(3);
      const all = await c.ok("list_cost_books", { includeArchived: true });
      expect(all.books.at(-1)).toMatchObject({
        name: "Ferien",
        archived: true,
      });
    });
  });

  describe("booking into a book", () => {
    it("books into the default book, and into a book by name, slug or id", async () => {
      const { ok } = await mcp.connect({ scopes: [...ALL] });
      const plain = await ok("create_cost", {
        title: "Dachrinne",
        amount: "100",
        category: "maintenance",
      });
      expect(plain).toMatchObject({ book: "Wohnung", split: "ownership" });
      const byName = await ok("create_cost", {
        title: "Einkauf",
        amount: "42.50",
        category: "groceries",
        book: "haushalt",
      });
      expect(byName).toMatchObject({ book: "Haushalt", split: "equal" });
      const { books } = await ok("list_cost_books");
      const auto = books.find((b: { name: string }) => b.name === "Auto");
      const byId = await ok("create_cost", {
        title: "Service",
        amount: "300",
        category: "transport",
        book: auto.id,
      });
      expect(byId).toMatchObject({ book: "Auto" });
      expect(
        (await ok("list_cost_books")).books.map(
          (b: { entries?: number }) => b.entries ?? 0,
        ),
      ).toEqual([1, 1, 1]);
    });

    it("says which books exist when one does not", async () => {
      const { call } = await mcp.connect({ scopes: [...ALL] });
      const reply = await call("create_cost", {
        title: "x",
        amount: "1",
        category: "other",
        book: "Segeln",
      });
      expect(reply.isError).toBe(true);
      expect(reply.text).toContain("[not_found]");
      expect(reply.text).toContain("Wohnung, Haushalt, Auto");
    });

    it("refuses an archived book and a tax class where there is none", async () => {
      const { call } = await mcp.connect({ scopes: [...ALL] });
      const ctx = ctxAt(mcp.db.db);
      const ferien = createCostBook(
        ctx,
        createCostBookRequestSchema.parse({ name: "Ferien" }),
      );
      updateCostBook(ctx, ferien.id, { archived: true });
      const archived = await call("create_cost", {
        title: "x",
        amount: "1",
        category: "travel",
        book: "Ferien",
      });
      expect(archived.isError).toBe(true);
      expect(archived.text).toContain("[invalid_request]");
      expect(archived.text).toContain("bookId");
      const tax = await call("create_cost", {
        title: "x",
        amount: "1",
        category: "groceries",
        book: "Haushalt",
        deductible: "maintenance",
      });
      expect(tax.isError).toBe(true);
      expect(tax.text).toContain("deductible");
    });

    it("takes the everyday categories", async () => {
      const { ok } = await mcp.connect({ scopes: [...ALL] });
      for (const category of [
        "groceries",
        "household",
        "dining",
        "leisure",
        "travel",
        "health",
        "gifts",
        "transport",
        "subscriptions",
      ]) {
        const c = await ok("create_cost", {
          title: category,
          amount: "5",
          category,
          book: "Haushalt",
        });
        expect(c.category).toBe(category);
      }
    });
  });

  describe("participants", () => {
    it("splits equally among the members named, and implies an equal split", async () => {
      const { ok } = await mcp.connect({ scopes: [...ALL] });
      const solo = await ok("create_cost", {
        title: "Fuer Ben",
        amount: "20.00",
        category: "gifts",
        book: "Haushalt",
        participants: ["Ben"],
      });
      expect(solo).toMatchObject({
        split: "equal",
        shares: ["Ben: 20.00 CHF"],
      });
      const both = await ok("create_cost", {
        title: "Fuer beide",
        amount: "20.01",
        category: "dining",
        participants: ["me", "Ben"],
      });
      expect(both.split).toBe("equal");
      // the odd cent goes to the earlier user id, which is a random id here
      const shares = both.shares.map((x: string) => x.split(": "));
      expect(shares.map(([name]: string[]) => name).sort()).toEqual([
        "Anna",
        "Ben",
      ]);
      expect(shares.map(([, amount]: string[]) => amount).sort()).toEqual([
        "10.00 CHF",
        "10.01 CHF",
      ]);
    });

    it("refuses participants next to another split, and strangers", async () => {
      const { call } = await mcp.connect({ scopes: [...ALL] });
      const base = { title: "x", amount: "1", category: "other" };
      const clash = await call("create_cost", {
        ...base,
        split: "ownership",
        participants: ["Ben"],
      });
      expect(clash.isError).toBe(true);
      expect(clash.text).toContain("participantIds");
      const stranger = await call("create_cost", {
        ...base,
        participants: ["Nobody"],
      });
      expect(stranger.isError).toBe(true);
      expect(stranger.text).toContain("[not_found]");
      expect(
        (await call("create_cost", { ...base, participants: [] })).isError,
      ).toBe(true);
    });
  });

  describe("filters", () => {
    it("lists and summarises one book", async () => {
      const { ok, call } = await mcp.connect({ scopes: [...ALL] });
      await ok("create_cost", {
        title: "Heizung",
        amount: "100.00",
        category: "utilities",
        date: "2026-02-01",
      });
      await ok("create_cost", {
        title: "Einkauf",
        amount: "40.00",
        category: "groceries",
        book: "Haushalt",
        paidBy: "Ben",
        date: "2026-03-01",
      });
      expect((await ok("list_costs", { year: 2026 })).costs).toHaveLength(2);
      const only = await ok("list_costs", { book: "Haushalt" });
      expect(only.costs.map((c: { title: string }) => c.title)).toEqual([
        "Einkauf",
      ]);
      expect(only.costs[0].book).toBe("Haushalt");
      const summary = await call("cost_summary", {
        year: 2026,
        book: "Haushalt",
      });
      expect(summary.summary).toContain(
        "2026 (Haushalt): 40.00 CHF in expenses",
      );
      expect(summary.summary).toContain("Anna owes Ben 20.00 CHF");
      expect(summary.json).toMatchObject({
        expenseTotal: "40.00 CHF",
        byCategory: [{ category: "groceries", total: "40.00 CHF", count: 1 }],
      });
      const missing = await call("list_costs", { book: "Segeln" });
      expect(missing.isError).toBe(true);
      expect(missing.text).toContain("[not_found]");
    });
  });

  describe("get_balances", () => {
    it("says who owes whom, over all books or one", async () => {
      const { ok, call } = await mcp.connect({ scopes: [...ALL] });
      const square = await call("get_balances");
      expect(square.summary).toBe("All books: everybody is square.");
      await ok("create_cost", {
        title: "Einkauf",
        amount: "100.00",
        category: "groceries",
        book: "Haushalt",
      });
      await ok("create_cost", {
        title: "Service",
        amount: "40.00",
        category: "transport",
        book: "Auto",
        paidBy: "Ben",
      });
      const all = await call("get_balances");
      expect(all.summary).toBe("All books: Ben owes Anna 30.00 CHF.");
      expect(all.json).toMatchObject({
        scope: "all books",
        currency: "CHF",
        people: [
          {
            person: "Anna",
            paid: "100.00 CHF",
            share: "70.00 CHF",
            balance: "30.00 CHF",
          },
          {
            person: "Ben",
            paid: "40.00 CHF",
            share: "70.00 CHF",
            balance: "-30.00 CHF",
          },
        ],
        suggestedPayments: [{ from: "Ben", to: "Anna", amount: "30.00 CHF" }],
      });
      const auto = await call("get_balances", { book: "Auto" });
      expect(auto.summary).toBe("Auto: Anna owes Ben 20.00 CHF.");
      expect(auto.json).toMatchObject({ scope: "Auto" });
      const missing = await call("get_balances", { book: "Segeln" });
      expect(missing.isError).toBe(true);
    });

    it("needs only the read scope", async () => {
      const reader = await mcp.connect({ scopes: ["read"] });
      expect((await reader.call("get_balances")).isError).toBe(false);
      const names = (await reader.client.listTools()).tools.map((t) => t.name);
      expect(names).toContain("get_balances");
      expect(names).toContain("list_cost_books");
      expect(names).not.toContain("record_settlement");
    });
  });

  describe("record_settlement", () => {
    it("records a payment, which squares the balances, and says what is still open", async () => {
      const { ok, call } = await mcp.connect({ scopes: [...ALL] });
      await ok("create_cost", {
        title: "Einkauf",
        amount: "100.00",
        category: "groceries",
        book: "Haushalt",
      });
      const part = await call("record_settlement", {
        from: "Ben",
        to: "me",
        amount: "20.00",
        note: "Twint",
        date: "2026-04-01",
      });
      expect(part.isError).toBe(false);
      expect(part.summary).toBe(
        "Recorded: Ben paid Anna 20.00 CHF. Now Ben owes Anna 30.00 CHF.",
      );
      expect(part.json).toMatchObject({
        from: "Ben",
        to: "Anna",
        amount: "20.00 CHF",
        date: "2026-04-01",
        note: "Twint",
        stillOpen: [{ from: "Ben", to: "Anna", amount: "30.00 CHF" }],
      });
      const rest = await call("record_settlement", {
        from: "Ben",
        to: "Anna",
        amount: "30",
      });
      expect(rest.summary).toContain("Now everybody is square.");
      expect((await call("get_balances")).summary).toBe(
        "All books: everybody is square.",
      );
    });

    it("pays from the token's user unless told, and can name a book", async () => {
      const { ok, call } = await mcp.connect({ scopes: [...ALL] });
      const paid = await ok("record_settlement", {
        to: "Ben",
        amount: "12.50",
        book: "Auto",
      });
      expect(paid).toMatchObject({ from: "Anna", to: "Ben", book: "Auto" });
      expect((await call("get_balances", { book: "Auto" })).summary).toBe(
        "Auto: Ben owes Anna 12.50 CHF.",
      );
      expect((await call("get_balances")).summary).toBe(
        "All books: Ben owes Anna 12.50 CHF.",
      );
    });

    it.each([["0"], ["-5.00"], ["abc"], ["1.234"]])(
      "refuses the amount %j",
      async (amount) => {
        const { call } = await mcp.connect({ scopes: [...ALL] });
        const reply = await call("record_settlement", { to: "Ben", amount });
        expect(reply.isError).toBe(true);
        expect(reply.text).toContain("[invalid_request]");
      },
    );

    it("refuses an empty amount", async () => {
      const { call } = await mcp.connect({ scopes: [...ALL] });
      expect(
        (await call("record_settlement", { to: "Ben", amount: "" })).isError,
      ).toBe(true);
    });

    it("refuses paying oneself, a stranger and a missing book", async () => {
      const { call } = await mcp.connect({ scopes: [...ALL] });
      const self = await call("record_settlement", { to: "me", amount: "5" });
      expect(self.isError).toBe(true);
      expect(self.text).toContain("[invalid_request]");
      const stranger = await call("record_settlement", {
        to: "Nobody",
        amount: "5",
      });
      expect(stranger.isError).toBe(true);
      expect(stranger.text).toContain("[not_found]");
      const book = await call("record_settlement", {
        to: "Ben",
        amount: "5",
        book: "Segeln",
      });
      expect(book.isError).toBe(true);
      expect(book.text).toContain("[not_found]");
    });

    it("is offered only with costs:write", async () => {
      const writer = await mcp.connect({ scopes: ["read", "write"] });
      const names = (await writer.client.listTools()).tools.map((t) => t.name);
      expect(names).not.toContain("record_settlement");
      const costs = await mcp.connect({ scopes: [...ALL] });
      const tool = (await costs.client.listTools()).tools.find(
        (t) => t.name === "record_settlement",
      );
      expect(tool?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      });
    });
  });
});
