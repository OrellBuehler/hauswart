import { describe, expect, it } from "vitest";
import { createApiClient } from "$lib/api/client";
import { endpoints } from "$lib/api/registry";
import { saveConnection } from "$lib/server/connections/connections";
import { createCost } from "$lib/server/costs/costs";
import { plainPng } from "$lib/server/files/test-images";
import { createCaller, createInProcessFetch } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { today } from "$lib/testing/dates";
import { useTestDB } from "$lib/testing/db";
import { useTestFilesDir } from "$lib/testing/files";
import { createCostRequestSchema } from "$lib/api/schemas/costs";

type Cost = {
  id: string;
  title: string;
  amountMinor: number;
  currency: string;
  category: string;
  splitMode: string;
  countsAsExpense: boolean;
  paidByUserId: string | null;
  paidByName: string | null;
  providerUrl: string | null;
  shares: { userId: string; shareBps: number; amountMinor: number }[];
  commentCount: number;
  defectId: string | null;
  assetId: string | null;
  assetName: string | null;
};
type Page = { items: Cost[]; nextCursor: string | null };

describe("costs API", () => {
  useTestDB();
  useTestFilesDir();

  async function setup() {
    const anna = await createTestUser({ displayName: "Anna" });
    const ben = await createTestUser({ displayName: "Ben" });
    const call = createCaller({ session: loginTestUser(anna).token });
    const callBen = createCaller({ session: loginTestUser(ben).token });
    const book = async (json: object = {}) =>
      (
        await call("POST", "/api/v1/costs", {
          json: {
            title: "Reparatur Geschirrspüler",
            amountMinor: 12050,
            category: "repair",
            ...json,
          },
        })
      ).body as Cost;
    return { anna, ben, call, callBen, book };
  }

  it("books, reads, updates and deletes a cost", async () => {
    const { anna, call } = await setup();
    const created = await call("POST", "/api/v1/costs", {
      json: {
        title: "Reparatur Geschirrspüler",
        amountMinor: 12050,
        category: "repair",
        paidByUserId: anna.id,
        payee: "Beispiel AG",
        date: today(),
      },
    });
    expect(created.res.status).toBe(201);
    const cost = created.body as Cost;
    expect(cost).toMatchObject({
      currency: "CHF",
      splitMode: "ownership",
      countsAsExpense: true,
      paidByName: "Anna",
      providerUrl: null,
    });
    expect(cost.shares.reduce((x, s) => x + s.amountMinor, 0)).toBe(12050);

    expect(
      ((await call("GET", `/api/v1/costs/${cost.id}`)).body as Cost).id,
    ).toBe(cost.id);
    const patched = await call("PATCH", `/api/v1/costs/${cost.id}`, {
      json: { title: "Neu", deductible: "maintenance" },
    });
    expect(patched.body).toMatchObject({
      title: "Neu",
      deductible: "maintenance",
    });
    expect((await call("DELETE", `/api/v1/costs/${cost.id}`)).res.status).toBe(
      204,
    );
    expect((await call("GET", `/api/v1/costs/${cost.id}`)).res.status).toBe(
      404,
    );
    expect((await call("DELETE", `/api/v1/costs/${cost.id}`)).res.status).toBe(
      404,
    );
  });

  it("validates the body", async () => {
    const { call } = await setup();
    const bad = async (json: object) =>
      (await call("POST", "/api/v1/costs", { json })).res.status;
    const base = { title: "x", amountMinor: 100, category: "repair" };
    expect(await bad({ ...base, amountMinor: 0 })).toBe(400);
    expect(await bad({ ...base, amountMinor: 1.5 })).toBe(400);
    expect(await bad({ ...base, amountMinor: 1e12 })).toBe(400);
    expect(await bad({ ...base, category: "luxury" })).toBe(400);
    expect(await bad({ ...base, title: "  " })).toBe(400);
    expect(await bad({ ...base, currency: "chf" })).toBe(400);
    expect(await bad({ ...base, splitMode: "custom" })).toBe(400);
    expect(await bad({ ...base, unknownField: 1 })).toBe(400);
    expect(await bad({ ...base, date: "2026-02-30" })).toBe(400);
    expect(await bad({ ...base, assetId: "missing" })).toBe(400);
    expect(await bad({ ...base, paidByUserId: "missing" })).toBe(400);
    expect(
      (await call("PATCH", "/api/v1/costs/whatever", { json: {} })).res.status,
    ).toBe(400);
  });

  it("answers 404 for an unknown entry on every verb", async () => {
    const { call } = await setup();
    expect((await call("GET", "/api/v1/costs/nope")).res.status).toBe(404);
    expect(
      (await call("PATCH", "/api/v1/costs/nope", { json: { title: "x" } })).res
        .status,
    ).toBe(404);
  });

  it("filters, searches and pages the list", async () => {
    const { anna, call, book } = await setup();
    await book({ title: "Eins", date: "2026-01-10", paidByUserId: anna.id });
    await book({ title: "Zwei", date: "2026-02-10", category: "utilities" });
    await book({ title: "Drei", date: "2025-02-10", category: "utilities" });
    const titles = async (q: string) =>
      ((await call("GET", `/api/v1/costs?${q}`)).body as Page).items.map(
        (c) => c.title,
      );
    expect(await titles("year=2026")).toEqual(["Zwei", "Eins"]);
    expect(await titles("category=utilities")).toEqual(["Zwei", "Drei"]);
    expect(await titles("paidBy=me")).toEqual(["Eins"]);
    expect(await titles("q=drei")).toEqual(["Drei"]);
    expect(await titles("from=2026-02-01&to=2026-02-28")).toEqual(["Zwei"]);
    const first = (await call("GET", "/api/v1/costs?limit=2")).body as Page;
    expect(first.items).toHaveLength(2);
    const second = (
      await call("GET", `/api/v1/costs?limit=2&cursor=${first.nextCursor}`)
    ).body as Page;
    expect(second.items.map((c) => c.title)).toEqual(["Drei"]);
    expect(second.nextCursor).toBeNull();
    expect((await call("GET", "/api/v1/costs?cursor=zzz")).res.status).toBe(
      400,
    );
    expect((await call("GET", "/api/v1/costs?year=abc")).res.status).toBe(400);
  });

  describe("authorisation", () => {
    it("reading needs read, writing needs costs:write", async () => {
      const user = await createTestUser();
      const reader = createCaller({
        bearer: createTestToken(user, { scopes: ["read"] }).token,
      });
      const writer = createCaller({
        bearer: createTestToken(user, { scopes: ["read", "costs:write"] })
          .token,
      });
      const plainWrite = createCaller({
        bearer: createTestToken(user, { scopes: ["read", "write"] }).token,
      });
      const body = { title: "x", amountMinor: 100, category: "repair" };
      expect(
        (await reader("POST", "/api/v1/costs", { json: body })).res.status,
      ).toBe(403);
      expect(
        (await plainWrite("POST", "/api/v1/costs", { json: body })).res.status,
      ).toBe(403);
      const made = await writer("POST", "/api/v1/costs", { json: body });
      expect(made.res.status).toBe(201);
      const id = (made.body as Cost).id;
      expect((await reader("GET", "/api/v1/costs")).res.status).toBe(200);
      expect((await reader("GET", `/api/v1/costs/${id}`)).res.status).toBe(200);
      expect((await reader("GET", "/api/v1/costs/summary")).res.status).toBe(
        200,
      );
      expect((await reader("GET", "/api/v1/costs/export.csv")).res.status).toBe(
        200,
      );
      for (const [method, json] of [
        ["PATCH", { title: "y" }],
        ["DELETE", undefined],
      ] as const) {
        expect(
          (await reader(method, `/api/v1/costs/${id}`, { json })).res.status,
        ).toBe(403);
        expect(
          (await plainWrite(method, `/api/v1/costs/${id}`, { json })).res
            .status,
        ).toBe(403);
      }
      expect((await writer("DELETE", `/api/v1/costs/${id}`)).res.status).toBe(
        204,
      );
    });

    it("costs are shared: every member sees and edits every entry", async () => {
      const { call, callBen, book } = await setup();
      const cost = await book();
      expect(
        ((await callBen("GET", `/api/v1/costs/${cost.id}`)).body as Cost).title,
      ).toBe(cost.title);
      expect(
        (
          await callBen("PATCH", `/api/v1/costs/${cost.id}`, {
            json: { title: "Ben war's" },
          })
        ).res.status,
      ).toBe(200);
      expect(
        ((await call("GET", "/api/v1/costs")).body as Page).items,
      ).toHaveLength(1);
    });
  });

  describe("the address of an item in a person's finance app", () => {
    it("is shown to the person who booked it and to nobody else", async () => {
      const { anna, ben, call, callBen } = await setup();
      const connection = saveConnection(
        { db: (await import("$lib/server/db")).getDB(), now: Date.now() },
        "kept",
        anna.id,
        {
          baseUrl: "https://finance.example.org",
          token: "kept_example-token",
          allowInsecureTls: false,
        },
      );
      const cost = createCost(
        { db: (await import("$lib/server/db")).getDB(), now: Date.now() },
        createCostRequestSchema.parse({
          title: "Aus der Finanz-App",
          amountMinor: 500,
          category: "repair",
        }),
        anna.id,
        {
          source: "finance_transaction",
          connectionId: connection.id,
          ref: "tx:1",
          url: "https://finance.example.org/tx/1",
        },
      );
      const mine = (await call("GET", `/api/v1/costs/${cost.id}`)).body as Cost;
      expect(mine.providerUrl).toBe("https://finance.example.org/tx/1");
      const theirs = (await callBen("GET", `/api/v1/costs/${cost.id}`))
        .body as Cost;
      expect(theirs.providerUrl).toBeNull();
      expect(JSON.stringify(theirs)).not.toContain("finance.example.org");
      expect(JSON.stringify(theirs)).not.toContain("tx:1");
      const list = (await callBen("GET", "/api/v1/costs")).body as Page;
      expect(JSON.stringify(list)).not.toContain("finance.example.org");
      expect(ben.id).toBeTruthy();
    });
  });

  describe("summary", () => {
    it("reports totals and the settlement", async () => {
      const { anna, ben, call, book } = await setup();
      await book({
        amountMinor: 10000,
        paidByUserId: anna.id,
        date: "2026-03-01",
      });
      await book({
        amountMinor: 2000,
        category: "utilities",
        paidByUserId: ben.id,
        date: "2026-03-05",
      });
      const s = (await call("GET", "/api/v1/costs/summary?year=2026")).body as {
        year: number;
        expenseTotalMinor: number;
        settlement: { fromName: string; toName: string; amountMinor: number }[];
        byCategory: { category: string }[];
      };
      expect(s.year).toBe(2026);
      expect(s.expenseTotalMinor).toBe(12000);
      expect(s.byCategory.map((c) => c.category)).toEqual([
        "repair",
        "utilities",
      ]);
      expect(s.settlement).toEqual([
        expect.objectContaining({
          fromName: "Ben",
          toName: "Anna",
          amountMinor: 4000,
        }),
      ]);
      const current = (await call("GET", "/api/v1/costs/summary")).body as {
        year: number;
      };
      expect(current.year).toBe(Number(today().slice(0, 4)));
      expect(
        (await call("GET", "/api/v1/costs/summary?year=1")).res.status,
      ).toBe(400);
    });
  });

  describe("CSV export", () => {
    it("is a UTF-8 file with a byte order mark and semicolons", async () => {
      const { anna, book } = await setup();
      await book({
        title: "Küche; neu",
        amountMinor: 194975,
        paidByUserId: anna.id,
        date: "2026-03-01",
      });
      const user = await createTestUser();
      const fetch = createInProcessFetch({
        bearer: createTestToken(user, { scopes: ["read"] }).token,
      });
      const res = await fetch("/api/v1/costs/export.csv?year=2026");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
      expect(res.headers.get("content-disposition")).toBe(
        'attachment; filename="hauswart-costs-2026.csv"',
      );
      expect(res.headers.get("cache-control")).toBe("no-store");
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
      expect(text.startsWith("﻿date;title;amount;currency;")).toBe(true);
      expect(text).toContain('2026-03-01;"Küche; neu";1949.75;CHF;repair;');
      expect(text.endsWith("\r\n")).toBe(true);
    });

    it("needs the read scope and a valid year", async () => {
      const { call } = await setup();
      expect(
        (await call("GET", "/api/v1/costs/export.csv?year=x")).res.status,
      ).toBe(400);
      expect((await call("GET", "/api/v1/costs/export.csv")).res.status).toBe(
        200,
      );
    });
  });

  describe("linking", () => {
    it("shows cost totals on a defect and a service log entry", async () => {
      const { call, book } = await setup();
      const asset = (
        await call("POST", "/api/v1/assets", { json: { name: "Heizung" } })
      ).body as { id: string };
      const entry = (
        await call("POST", `/api/v1/assets/${asset.id}/service-log`, {
          json: { title: "Service" },
        })
      ).body as { id: string; costs: { totalMinor: number; count: number } };
      expect(entry.costs).toEqual({ totalMinor: 0, count: 0 });
      const defect = (
        await call("POST", "/api/v1/defects", { json: { title: "Leck" } })
      ).body as { id: string };
      await book({ serviceLogId: entry.id, amountMinor: 15000 });
      await book({ serviceLogId: entry.id, amountMinor: -500 });
      await book({ defectId: defect.id, amountMinor: 3000 });
      const log = (
        await call("GET", `/api/v1/assets/${asset.id}/service-log/${entry.id}`)
      ).body as typeof entry;
      expect(log.costs).toEqual({ totalMinor: 14500, count: 2 });
      const listed = (await call("GET", `/api/v1/service-log`)).body as {
        items: { id: string; costs: unknown }[];
      };
      expect(listed.items[0].costs).toEqual({ totalMinor: 14500, count: 2 });
      const got = (await call("GET", `/api/v1/defects/${defect.id}`)).body as {
        costs: unknown;
      };
      expect(got.costs).toEqual({ totalMinor: 3000, count: 1 });
      const byDefect = (
        await call("GET", `/api/v1/costs?defectId=${defect.id}`)
      ).body as Page;
      expect(byDefect.items).toHaveLength(1);
      expect(byDefect.items[0].assetId).toBeNull();
    });
  });

  describe("comments and receipts", () => {
    it("takes comments and cleans them up with the entry", async () => {
      const { call, callBen, book } = await setup();
      const cost = await book();
      const comment = await callBen("POST", "/api/v1/comments", {
        json: {
          entityType: "cost",
          entityId: cost.id,
          bodyMd: "Beleg ist im Ordner",
        },
      });
      expect(comment.res.status).toBe(201);
      expect(
        ((await call("GET", `/api/v1/costs/${cost.id}`)).body as Cost)
          .commentCount,
      ).toBe(1);
      const listed = await call(
        "GET",
        `/api/v1/comments?entityType=cost&entityId=${cost.id}`,
      );
      expect((listed.body as Page).items).toHaveLength(1);
      await call("DELETE", `/api/v1/costs/${cost.id}`);
      expect(
        (
          await callBen("POST", "/api/v1/comments", {
            json: { entityType: "cost", entityId: cost.id, bodyMd: "x" },
          })
        ).res.status,
      ).toBe(404);
    });

    it("accepts a receipt photo, for people allowed to change costs", async () => {
      const { anna, call, book } = await setup();
      const cost = await book();
      const form = {
        file: new File([plainPng() as BlobPart], "beleg.png", {
          type: "image/png",
        }),
        ownerType: "cost",
        ownerId: cost.id,
      };
      const ok = await call("POST", "/api/v1/attachments", { form });
      expect(ok.res.status).toBe(201);
      const readOnly = createCaller({
        bearer: createTestToken(anna, { scopes: ["read", "write"] }).token,
      });
      expect(
        (await readOnly("POST", "/api/v1/attachments", { form })).res.status,
      ).toBe(403);
      const missing = await call("POST", "/api/v1/attachments", {
        form: { ...form, ownerId: "nope" },
      });
      expect(missing.res.status).toBe(400);
      const att = (ok.body as { id: string }).id;
      expect(
        (await readOnly("DELETE", `/api/v1/attachments/${att}`)).res.status,
      ).toBe(403);
      // deleting the entry removes its receipts
      await call("DELETE", `/api/v1/costs/${cost.id}`);
      expect((await call("GET", `/api/v1/attachments/${att}`)).res.status).toBe(
        404,
      );
    });
  });

  describe("dashboard", () => {
    it("carries the year to date: total, top three categories and the settlement", async () => {
      const { anna, call, book } = await setup();
      await book({ amountMinor: 8000, paidByUserId: anna.id, date: today() });
      await book({ amountMinor: 4000, category: "utilities", date: today() });
      await book({ amountMinor: 3000, category: "insurance", date: today() });
      await book({ amountMinor: 2000, category: "other", date: today() });
      const d = (await call("GET", "/api/v1/dashboard")).body as {
        costsYearToDate: {
          year: number;
          totalMinor: number;
          byCategory: { category: string }[];
          settlement: unknown[];
        };
      };
      expect(d.costsYearToDate.totalMinor).toBe(17000);
      expect(d.costsYearToDate.byCategory.map((c) => c.category)).toEqual([
        "repair",
        "utilities",
        "insurance",
      ]);
      expect(d.costsYearToDate.settlement).toHaveLength(1);
    });

    it("is there, empty, without any cost", async () => {
      const { call } = await setup();
      const d = (await call("GET", "/api/v1/dashboard")).body as {
        costsYearToDate: { totalMinor: number; byCategory: unknown[] };
      };
      expect(d.costsYearToDate).toMatchObject({
        totalMinor: 0,
        byCategory: [],
      });
    });
  });

  it("works through the typed client", async () => {
    const user = await createTestUser();
    const { token } = createTestToken(user);
    const client = createApiClient(createInProcessFetch({ bearer: token }));
    const created = await client.call(endpoints.costsCreate, {
      body: {
        title: "Typisiert",
        amountMinor: 123,
        category: "other",
        splitMode: "ownership",
        deductible: "unknown",
      },
    });
    expect(created.amountMinor).toBe(123);
    const summary = await client.call(endpoints.costsSummary, { query: {} });
    expect(summary.currency).toBe("CHF");
  });
});
