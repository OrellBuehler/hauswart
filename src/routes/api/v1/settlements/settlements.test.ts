import { describe, expect, it } from "vitest";
import { createApiClient } from "$lib/api/client";
import { endpoints } from "$lib/api/registry";
import { createCaller, createInProcessFetch } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { today } from "$lib/testing/dates";
import { useTestDB } from "$lib/testing/db";

interface Settlement {
  id: string;
  bookId: string | null;
  bookName: string | null;
  fromUserId: string;
  fromName: string | null;
  toUserId: string;
  toName: string | null;
  amountMinor: number;
  currency: string;
  date: string;
  note: string | null;
  createdBy: string | null;
}
type Page = { items: Settlement[]; nextCursor: string | null };

describe("settlements API", () => {
  useTestDB();

  async function setup() {
    const anna = await createTestUser({ displayName: "Anna" });
    const ben = await createTestUser({ displayName: "Ben" });
    const call = createCaller({ session: loginTestUser(anna).token });
    const callBen = createCaller({ session: loginTestUser(ben).token });
    const pay = async (json: object = {}) =>
      (
        await call("POST", "/api/v1/settlements", {
          json: {
            fromUserId: ben.id,
            toUserId: anna.id,
            amountMinor: 5000,
            ...json,
          },
        })
      ).body as Settlement;
    return { anna, ben, call, callBen, pay };
  }

  it("records, reads, changes and deletes a payment", async () => {
    const { anna, ben, call } = await setup();
    const created = await call("POST", "/api/v1/settlements", {
      json: {
        fromUserId: ben.id,
        toUserId: anna.id,
        amountMinor: 5000,
        note: "Twint",
      },
    });
    expect(created.res.status).toBe(201);
    const s = created.body as Settlement;
    expect(s).toMatchObject({
      bookId: null,
      bookName: null,
      fromName: "Ben",
      toName: "Anna",
      amountMinor: 5000,
      currency: "CHF",
      date: today(),
      note: "Twint",
      createdBy: anna.id,
    });
    expect(
      ((await call("GET", `/api/v1/settlements/${s.id}`)).body as Settlement)
        .id,
    ).toBe(s.id);
    const patched = await call("PATCH", `/api/v1/settlements/${s.id}`, {
      json: { amountMinor: 4000, date: "2026-02-03", note: null },
    });
    expect(patched.body).toMatchObject({
      amountMinor: 4000,
      date: "2026-02-03",
      note: null,
    });
    expect(
      (await call("DELETE", `/api/v1/settlements/${s.id}`)).res.status,
    ).toBe(204);
    expect((await call("GET", `/api/v1/settlements/${s.id}`)).res.status).toBe(
      404,
    );
    expect(
      (await call("DELETE", `/api/v1/settlements/${s.id}`)).res.status,
    ).toBe(404);
  });

  it("names the book of a payment", async () => {
    const { call, pay } = await setup();
    const haushalt = (
      (await call("GET", "/api/v1/cost-books")).body as {
        items: { id: string; name: string }[];
      }
    ).items.find((b) => b.name === "Haushalt")!;
    expect(await pay({ bookId: haushalt.id })).toMatchObject({
      bookId: haushalt.id,
      bookName: "Haushalt",
    });
  });

  it("validates the body", async () => {
    const { anna, ben, call } = await setup();
    const bad = async (json: object) =>
      (await call("POST", "/api/v1/settlements", { json })).res.status;
    const base = { fromUserId: ben.id, toUserId: anna.id, amountMinor: 100 };
    expect(await bad({})).toBe(400);
    expect(await bad({ ...base, amountMinor: 0 })).toBe(400);
    expect(await bad({ ...base, amountMinor: -5 })).toBe(400);
    expect(await bad({ ...base, amountMinor: 1.5 })).toBe(400);
    expect(await bad({ ...base, amountMinor: 1e12 })).toBe(400);
    expect(await bad({ ...base, toUserId: ben.id })).toBe(400);
    expect(await bad({ ...base, toUserId: "missing" })).toBe(400);
    expect(await bad({ ...base, fromUserId: "missing" })).toBe(400);
    expect(await bad({ ...base, bookId: "missing" })).toBe(400);
    expect(await bad({ ...base, currency: "chf" })).toBe(400);
    expect(await bad({ ...base, date: "2026-02-30" })).toBe(400);
    expect(await bad({ ...base, unknown: 1 })).toBe(400);
    expect(
      (await call("PATCH", "/api/v1/settlements/x", { json: {} })).res.status,
    ).toBe(400);
    expect(
      (await call("GET", "/api/v1/settlements?cursor=zzz")).res.status,
    ).toBe(400);
  });

  it("answers 404 for an unknown payment on every verb", async () => {
    const { call } = await setup();
    expect((await call("GET", "/api/v1/settlements/nope")).res.status).toBe(
      404,
    );
    expect(
      (
        await call("PATCH", "/api/v1/settlements/nope", {
          json: { amountMinor: 5 },
        })
      ).res.status,
    ).toBe(404);
  });

  it("lists newest first and filters", async () => {
    const { anna, ben, call, pay } = await setup();
    await pay({ date: "2026-01-10", note: "eins" });
    await pay({
      date: "2026-02-10",
      note: "zwei",
      fromUserId: anna.id,
      toUserId: ben.id,
    });
    await pay({ date: "2025-12-10", note: "drei" });
    const notes = async (q = "") =>
      ((await call("GET", `/api/v1/settlements${q}`)).body as Page).items.map(
        (s) => s.note,
      );
    expect(await notes()).toEqual(["zwei", "eins", "drei"]);
    expect(await notes("?year=2026")).toEqual(["zwei", "eins"]);
    expect(await notes("?from=2026-01-15")).toEqual(["zwei"]);
    expect(await notes(`?userId=${ben.id}`)).toEqual(["zwei", "eins", "drei"]);
    expect(await notes("?userId=me")).toEqual(["zwei", "eins", "drei"]);
    expect(await notes("?bookId=missing")).toEqual([]);
    const first = (await call("GET", "/api/v1/settlements?limit=2"))
      .body as Page;
    expect(first.items).toHaveLength(2);
    const second = (
      await call(
        "GET",
        `/api/v1/settlements?limit=2&cursor=${first.nextCursor}`,
      )
    ).body as Page;
    expect(second.items.map((s) => s.note)).toEqual(["drei"]);
    expect(second.nextCursor).toBeNull();
  });

  it("moves the balances and is not a cost", async () => {
    const { anna, ben, call, pay } = await setup();
    await call("POST", "/api/v1/costs", {
      json: {
        title: "Einkauf",
        amountMinor: 10000,
        category: "groceries",
        splitMode: "equal",
        paidByUserId: anna.id,
      },
    });
    const before = (await call("GET", "/api/v1/costs/summary")).body as {
      expenseTotalMinor: number;
    };
    await pay({ amountMinor: 5000 });
    const after = (await call("GET", "/api/v1/costs/summary")).body as {
      expenseTotalMinor: number;
    };
    expect(after.expenseTotalMinor).toBe(before.expenseTotalMinor);
    const balances = (await call("GET", "/api/v1/costs/balances")).body as {
      people: { userId: string; balanceMinor: number }[];
      suggestedPayments: unknown[];
    };
    expect(
      Object.fromEntries(
        balances.people.map((p) => [p.userId, p.balanceMinor]),
      ),
    ).toEqual({ [anna.id]: 0, [ben.id]: 0 });
    expect(balances.suggestedPayments).toEqual([]);
    // costs list and counts do not show it
    expect(
      ((await call("GET", "/api/v1/costs")).body as { items: unknown[] }).items,
    ).toHaveLength(1);
  });

  describe("authorisation", () => {
    it("reading needs read, writing needs costs:write", async () => {
      const anna = await createTestUser({ displayName: "Anna" });
      const ben = await createTestUser({ displayName: "Ben" });
      const reader = createCaller({
        bearer: createTestToken(anna, { scopes: ["read"] }).token,
      });
      const writer = createCaller({
        bearer: createTestToken(anna, { scopes: ["read", "costs:write"] })
          .token,
      });
      const plainWrite = createCaller({
        bearer: createTestToken(anna, { scopes: ["read", "write"] }).token,
      });
      const body = { fromUserId: ben.id, toUserId: anna.id, amountMinor: 100 };
      expect(
        (await reader("POST", "/api/v1/settlements", { json: body })).res
          .status,
      ).toBe(403);
      expect(
        (await plainWrite("POST", "/api/v1/settlements", { json: body })).res
          .status,
      ).toBe(403);
      const made = await writer("POST", "/api/v1/settlements", { json: body });
      expect(made.res.status).toBe(201);
      const id = (made.body as Settlement).id;
      expect((await reader("GET", "/api/v1/settlements")).res.status).toBe(200);
      expect(
        (await reader("GET", `/api/v1/settlements/${id}`)).res.status,
      ).toBe(200);
      for (const [method, json] of [
        ["PATCH", { amountMinor: 5 }],
        ["DELETE", undefined],
      ] as const) {
        expect(
          (await reader(method, `/api/v1/settlements/${id}`, { json })).res
            .status,
        ).toBe(403);
        expect(
          (await plainWrite(method, `/api/v1/settlements/${id}`, { json })).res
            .status,
        ).toBe(403);
      }
      expect(
        (await writer("DELETE", `/api/v1/settlements/${id}`)).res.status,
      ).toBe(204);
    });

    it("payments are shared: every member sees and edits every payment", async () => {
      const { call, callBen, pay } = await setup();
      const s = await pay();
      expect(
        (
          (await callBen("GET", `/api/v1/settlements/${s.id}`))
            .body as Settlement
        ).id,
      ).toBe(s.id);
      expect(
        (
          await callBen("PATCH", `/api/v1/settlements/${s.id}`, {
            json: { note: "von Ben" },
          })
        ).res.status,
      ).toBe(200);
      expect(
        ((await call("GET", "/api/v1/settlements")).body as Page).items,
      ).toHaveLength(1);
    });
  });

  it("works through the typed client", async () => {
    const anna = await createTestUser({ displayName: "Anna" });
    const ben = await createTestUser({ displayName: "Ben" });
    const client = createApiClient(
      createInProcessFetch({
        bearer: createTestToken(anna, { scopes: ["read", "costs:write"] })
          .token,
      }),
    );
    const s = await client.call(endpoints.settlementsCreate, {
      body: { fromUserId: ben.id, toUserId: anna.id, amountMinor: 1234 },
    });
    expect(s.amountMinor).toBe(1234);
    const list = await client.call(endpoints.settlementsList, {
      query: { limit: 10 },
    });
    expect(list.items.map((x) => x.id)).toEqual([s.id]);
  });
});
