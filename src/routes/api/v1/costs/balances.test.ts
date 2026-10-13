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

interface Balances {
  book: { id: string; name: string } | null;
  currency: string;
  otherCurrencyCount: number;
  unassignedPayerCount: number;
  people: {
    userId: string;
    userName: string | null;
    paidMinor: number;
    shareMinor: number;
    sentMinor: number;
    receivedMinor: number;
    balanceMinor: number;
  }[];
  suggestedPayments: {
    fromUserId: string;
    fromName: string | null;
    toUserId: string;
    toName: string | null;
    amountMinor: number;
  }[];
}
interface Cost {
  id: string;
  bookId: string;
  bookName: string;
  splitMode: string;
  deductible: string;
  shares: { userId: string; shareBps: number; amountMinor: number }[];
}
type Call = ReturnType<typeof createCaller>;

describe("balances, books and participants through the API", () => {
  useTestDB();

  async function setup() {
    const anna = await createTestUser({ displayName: "Anna" });
    const ben = await createTestUser({ displayName: "Ben" });
    const carl = await createTestUser({ displayName: "Carl" });
    const call = createCaller({ session: loginTestUser(anna).token });
    const bookId = async (name: string) =>
      (
        (await call("GET", "/api/v1/cost-books")).body as {
          items: { id: string; name: string }[];
        }
      ).items.find((b) => b.name === name)!.id;
    const book = async (json: object) =>
      (await call("POST", "/api/v1/costs", {
        json: {
          title: "Eintrag",
          amountMinor: 9000,
          category: "groceries",
          ...json,
        },
      })) as { res: Response; body: unknown };
    return { anna, ben, carl, call, bookId, book };
  }
  const balances = async (call: Call, q = "") =>
    (await call("GET", `/api/v1/costs/balances${q}`)).body as Balances;
  const byName = (b: Balances) =>
    Object.fromEntries(b.people.map((p) => [p.userName, p.balanceMinor]));

  describe("an entry's book", () => {
    it("goes to the default book unless told, and carries the book's name", async () => {
      const { call, bookId, book } = await setup();
      const plain = (await book({})).body as Cost;
      expect(plain).toMatchObject({
        bookName: "Wohnung",
        splitMode: "ownership",
      });
      expect(plain.bookId).toBe(await bookId("Wohnung"));
      const haushalt = (await book({ bookId: await bookId("Haushalt") }))
        .body as Cost;
      expect(haushalt).toMatchObject({
        bookName: "Haushalt",
        splitMode: "equal",
      });
      expect(
        ((await call("GET", `/api/v1/costs/${plain.id}`)).body as Cost)
          .bookName,
      ).toBe("Wohnung");
    });

    it("refuses a book that is missing or archived, and a tax class in a book without one", async () => {
      const { call, bookId, book } = await setup();
      expect((await book({ bookId: "missing" })).res.status).toBe(400);
      const auto = await bookId("Auto");
      await call("PATCH", `/api/v1/cost-books/${auto}`, {
        json: { archived: true },
      });
      expect((await book({ bookId: auto })).res.status).toBe(400);
      const haushalt = await bookId("Haushalt");
      const r = await book({ bookId: haushalt, deductible: "maintenance" });
      expect(r.res.status).toBe(400);
      expect(
        (r.body as { error: { details: { body: { fieldErrors: object } } } })
          .error.details.body.fieldErrors,
      ).toHaveProperty("deductible");
    });

    it("moves with PATCH, and filters the list, the summary and the CSV", async () => {
      const { call, bookId, book } = await setup();
      const haushalt = await bookId("Haushalt");
      const a = (await book({ title: "Wohnung eins" })).body as Cost;
      await book({ title: "Haushalt eins", bookId: haushalt });
      const moved = (
        await call("PATCH", `/api/v1/costs/${a.id}`, {
          json: { bookId: haushalt },
        })
      ).body as Cost;
      expect(moved.bookName).toBe("Haushalt");
      const titles = async (q: string) =>
        (
          (await call("GET", `/api/v1/costs?${q}`)).body as {
            items: { title: string }[];
          }
        ).items
          .map((c) => c.title)
          .sort();
      expect(await titles(`bookId=${haushalt}`)).toEqual([
        "Haushalt eins",
        "Wohnung eins",
      ]);
      expect(await titles(`bookId=${await bookId("Wohnung")}`)).toEqual([]);

      const summary = (
        await call(
          "GET",
          `/api/v1/costs/summary?bookId=${await bookId("Wohnung")}`,
        )
      ).body as { expenseTotalMinor: number };
      expect(summary.expenseTotalMinor).toBe(0);
      expect(
        (
          (await call("GET", `/api/v1/costs/summary?bookId=${haushalt}`))
            .body as {
            expenseTotalMinor: number;
          }
        ).expenseTotalMinor,
      ).toBe(18000);
    });

    it("exports one book's entries, with the book before the tags, in a file named after it", async () => {
      const anna = await createTestUser({ displayName: "Anna" });
      await createTestUser({ displayName: "Ben" });
      const call = createCaller({ session: loginTestUser(anna).token });
      const fetch = createInProcessFetch({
        bearer: createTestToken(anna, { scopes: ["read", "costs:write"] })
          .token,
      });
      const haushalt = (
        (await call("GET", "/api/v1/cost-books")).body as {
          items: { id: string; name: string }[];
        }
      ).items.find((b) => b.name === "Haushalt")!.id;
      for (const json of [
        { title: "Wohnung eins", date: "2026-03-01" },
        { title: "Haushalt eins", date: "2026-03-02", bookId: haushalt },
      ]) {
        await call("POST", "/api/v1/costs", {
          json: { amountMinor: 1000, category: "groceries", ...json },
        });
      }
      const all = await fetch("/api/v1/costs/export.csv?year=2026");
      expect(all.headers.get("content-disposition")).toBe(
        'attachment; filename="hauswart-costs-2026.csv"',
      );
      const text = await all.text();
      expect(text).toContain("Wohnung eins");
      expect(text).toContain("Haushalt eins");
      const one = await fetch(
        `/api/v1/costs/export.csv?year=2026&bookId=${haushalt}`,
      );
      expect(one.status).toBe(200);
      expect(one.headers.get("content-disposition")).toBe(
        'attachment; filename="hauswart-costs-2026-haushalt.csv"',
      );
      const rows = (await one.text())
        .replace(/^\uFEFF/, "")
        .trim()
        .split("\r\n");
      expect(rows[0].split(";").slice(-2)).toEqual(["book", "tags"]);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toContain("Haushalt eins");
      expect(rows[1].split(";").at(-2)).toBe("Haushalt");
      const unknown = await fetch(
        "/api/v1/costs/export.csv?year=2026&bookId=missing",
      );
      expect(unknown.status).toBe(404);
      expect(unknown.headers.get("content-disposition")).toBeNull();
      expect(await unknown.json()).toMatchObject({
        error: { code: "not_found" },
      });
    });
  });

  describe("for whom", () => {
    it("splits equally among the participants only", async () => {
      const { ben, carl, anna, book } = await setup();
      const r = await book({
        splitMode: "equal",
        participantIds: [ben.id, carl.id],
        paidByUserId: anna.id,
        amountMinor: 10001,
      });
      expect(r.res.status).toBe(201);
      const c = r.body as Cost;
      expect(c.shares.map((s) => [s.userId, s.shareBps]).sort()).toEqual(
        [
          [ben.id, 5000],
          [carl.id, 5000],
        ].sort(),
      );
      expect(c.shares.reduce((x, s) => x + s.amountMinor, 0)).toBe(10001);
    });

    it("refuses the wrong participants and the wrong mode, and changes them afterwards", async () => {
      const { call, anna, ben, carl, book } = await setup();
      const bad = async (json: object) => (await book(json)).res.status;
      expect(await bad({ splitMode: "equal", participantIds: [] })).toBe(400);
      expect(
        await bad({ splitMode: "equal", participantIds: ["missing"] }),
      ).toBe(400);
      expect(
        await bad({ splitMode: "equal", participantIds: [ben.id, ben.id] }),
      ).toBe(400);
      expect(
        await bad({ splitMode: "ownership", participantIds: [ben.id] }),
      ).toBe(400);
      expect(await bad({ participantIds: [ben.id] })).toBe(400);
      expect(
        await bad({
          splitMode: "equal",
          participantIds: Array.from({ length: 21 }, () => ben.id),
        }),
      ).toBe(400);

      const c = (await book({ splitMode: "equal", amountMinor: 9000 }))
        .body as Cost;
      expect(c.shares).toHaveLength(3);
      const next = (
        await call("PATCH", `/api/v1/costs/${c.id}`, {
          json: { participantIds: [anna.id, carl.id] },
        })
      ).body as Cost;
      expect(next.shares.map((s) => s.userId).sort()).toEqual(
        [anna.id, carl.id].sort(),
      );
      expect(next.shares.map((s) => s.amountMinor)).toEqual([4500, 4500]);
      expect(
        (
          await call("PATCH", `/api/v1/costs/${c.id}`, {
            json: { splitMode: "none", participantIds: [anna.id] },
          })
        ).res.status,
      ).toBe(400);
    });
  });

  describe("the balances", () => {
    it("start square and follow entries and payments", async () => {
      const { anna, ben, carl, call, book } = await setup();
      const empty = await balances(call);
      expect(empty).toMatchObject({
        book: null,
        currency: "CHF",
        suggestedPayments: [],
      });
      expect(empty.people).toHaveLength(3);

      await book({
        splitMode: "equal",
        participantIds: [ben.id, carl.id],
        paidByUserId: anna.id,
      });
      const b = await balances(call);
      expect(byName(b)).toEqual({ Anna: 9000, Ben: -4500, Carl: -4500 });
      expect(b.suggestedPayments.map((t) => t.amountMinor)).toEqual([
        4500, 4500,
      ]);
      expect(b.suggestedPayments.every((t) => t.toUserId === anna.id)).toBe(
        true,
      );

      await call("POST", "/api/v1/settlements", {
        json: { fromUserId: ben.id, toUserId: anna.id, amountMinor: 4500 },
      });
      const after = await balances(call);
      expect(byName(after)).toEqual({ Anna: 4500, Ben: 0, Carl: -4500 });
      expect(after.people.find((p) => p.userId === ben.id)).toMatchObject({
        sentMinor: 4500,
        receivedMinor: 0,
      });
      expect(after.suggestedPayments).toEqual([
        expect.objectContaining({
          fromName: "Carl",
          toName: "Anna",
          amountMinor: 4500,
        }),
      ]);
    });

    it("by book, for all books, and with the contradictions refused", async () => {
      const { anna, ben, call, bookId, book } = await setup();
      const haushalt = await bookId("Haushalt");
      const wohnung = await bookId("Wohnung");
      await book({
        splitMode: "equal",
        paidByUserId: anna.id,
        bookId: haushalt,
        amountMinor: 3000,
      });
      await book({
        splitMode: "equal",
        paidByUserId: ben.id,
        bookId: wohnung,
        amountMinor: 900,
      });

      const h = await balances(call, `?bookId=${haushalt}`);
      expect(h.book).toEqual({ id: haushalt, name: "Haushalt" });
      expect(byName(h)).toMatchObject({ Anna: 2000, Ben: -1000 });
      expect(byName(await balances(call, `?bookId=${wohnung}`))).toMatchObject({
        Anna: -300,
        Ben: 600,
      });
      const whole = await balances(call, "?all=true");
      expect(whole.book).toBeNull();
      expect(byName(whole)).toMatchObject({ Anna: 1700 });
      expect(await balances(call)).toEqual(whole);

      const both = await call(
        "GET",
        `/api/v1/costs/balances?bookId=${haushalt}&all=true`,
      );
      expect([both.res.status, errorCode(both)]).toEqual([
        400,
        "invalid_request",
      ]);
      const neither = await call("GET", "/api/v1/costs/balances?all=false");
      expect(neither.res.status).toBe(400);
      expect(
        (
          await call(
            "GET",
            `/api/v1/costs/balances?bookId=${haushalt}&all=false`,
          )
        ).res.status,
      ).toBe(200);
      expect(
        (await call("GET", "/api/v1/costs/balances?all=yes")).res.status,
      ).toBe(400);
      expect(
        (await call("GET", "/api/v1/costs/balances?bookId=missing")).res.status,
      ).toBe(404);
    });

    it("need the read scope only, and are shared by every member", async () => {
      const { ben, call } = await setup();
      const reader = createCaller({
        bearer: createTestToken(ben, { scopes: ["read"] }).token,
      });
      expect((await reader("GET", "/api/v1/costs/balances")).res.status).toBe(
        200,
      );
      const noRead = createCaller({
        bearer: createTestToken(ben, { scopes: ["write"] }).token,
      });
      expect((await noRead("GET", "/api/v1/costs/balances")).res.status).toBe(
        403,
      );
      expect(await balances(call)).toEqual(await balances(reader));
    });

    it("work through the typed client", async () => {
      const anna = await createTestUser({ displayName: "Anna" });
      const client = createApiClient(
        createInProcessFetch({
          bearer: createTestToken(anna, { scopes: ["read"] }).token,
        }),
      );
      const b = await client.call(endpoints.costsBalances, {
        query: { all: "true" },
      });
      expect(b.currency).toBe("CHF");
      expect(b.people.map((p) => p.userId)).toEqual([anna.id]);
    });
  });
});
