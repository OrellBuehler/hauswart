import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  KeptClient,
  KeptError,
  describeError,
  errorCode,
  messageForCode,
  missingScopes,
  normalizeBaseUrl,
  type KeptClientOptions,
} from "./index";
import {
  fakeAccount,
  fakeBill,
  fakeCategory,
  fakeSeries,
  fakeTransaction,
  startFakeKept,
} from "./fake-server";

const fake = startFakeKept();
afterAll(() => fake.stop());
beforeEach(() => fake.reset());

const noSleep = vi.fn(async () => {});
beforeEach(() => noSleep.mockClear());

const client = (over: Partial<KeptClientOptions> = {}) =>
  new KeptClient({
    baseUrl: fake.baseUrl,
    token: fake.token,
    retry: { sleep: noSleep },
    ...over,
  });

async function errorOf(promise: Promise<unknown>): Promise<KeptError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof KeptError) return err;
    throw err;
  }
  throw new Error("expected a KeptError");
}
const codeOf = async (p: Promise<unknown>) => (await errorOf(p)).code;

async function collect<T>(gen: AsyncGenerator<T[]>): Promise<T[][]> {
  const pages: T[][] = [];
  for await (const page of gen) pages.push(page);
  return pages;
}

const ids = (items: Array<{ id: string }>) => items.map((i) => i.id);

describe("normalizeBaseUrl and construction", () => {
  it("keeps origin and path prefix", () => {
    expect(normalizeBaseUrl(" https://kept.example.org/ ")).toBe(
      "https://kept.example.org",
    );
    expect(normalizeBaseUrl("http://10.0.0.5:3000/kept//")).toBe(
      "http://10.0.0.5:3000/kept",
    );
  });

  it("rejects other schemes, credentials and garbage", () => {
    for (const bad of [
      "ftp://kept.example.org",
      "https://user:pw@kept.example.org",
      "not a url",
      "",
    ]) {
      expect(() => normalizeBaseUrl(bad), bad).toThrow(KeptError);
    }
  });

  it("rejects an empty token or one with whitespace before any request", () => {
    for (const token of ["", "kept_a b", "kept_a\nb"]) {
      expect(
        () => new KeptClient({ baseUrl: fake.baseUrl, token }),
        JSON.stringify(token),
      ).toThrow(KeptError);
    }
    expect(fake.requests).toHaveLength(0);
  });

  it("builds URLs below /api/external/v1", () => {
    expect(client().url("/bills")).toBe(
      `${fake.baseUrl}/api/external/v1/bills`,
    );
  });
});

describe("me", () => {
  it("sends the bearer token and parses the answer, dropping unknown fields", async () => {
    fake.setToken({ scopes: ["bills:read"], categoryIds: ["cat-a"] });
    fake.replyNext("/me", {
      status: 200,
      body: JSON.stringify({
        ...fake.user,
        extra: "x",
        token: { scopes: ["bills:read"], categoryIds: ["cat-a"], hash: "h" },
      }),
    });
    const me = await client().me();
    expect(me).toEqual({
      ...fake.user,
      token: { scopes: ["bills:read"], categoryIds: ["cat-a"] },
    });
    const req = fake.requests[0]!;
    expect(req.method).toBe("GET");
    expect(req.path).toBe("/me");
    expect(req.headers.get("authorization")).toBe(`Bearer ${fake.token}`);
    expect(req.headers.get("accept")).toBe("application/json");
  });

  it("reports an unrestricted token with null categoryIds", async () => {
    const me = await client().me();
    expect(me.token.categoryIds).toBeNull();
    expect(me.token.scopes).toContain("links:write");
  });

  it("works behind a path prefix", async () => {
    fake.prefix = "/kept";
    expect((await client().me()).username).toBe("muster");
    expect(fake.requests[0]!.path).toBe("/me");
  });

  it("maps a rejected token to unauthorized and never leaks the token", async () => {
    const token = "kept_wrong-secret-token-value";
    const err = await errorOf(client({ token }).me());
    expect(err.code).toBe("unauthorized");
    expect(err.status).toBe(401);
    expect(`${err.message} ${err.stack} ${JSON.stringify(err)}`).not.toContain(
      token,
    );
  });

  it("missingScopes lists what a token lacks", async () => {
    fake.setToken({ scopes: ["bills:read"] });
    const me = await client().me();
    expect(missingScopes(me, ["bills:read", "links:write"])).toEqual([
      "links:write",
    ]);
  });
});

describe("listBills", () => {
  beforeEach(() => {
    fake.bills = [
      fakeBill({ id: "b-open", dueDate: "2026-11-01" }),
      fakeBill({
        id: "b-overdue",
        dueDate: "2026-09-01",
        overdue: true,
        status: "partially_paid",
      }),
      fakeBill({ id: "b-paid", dueDate: "2026-08-01", status: "paid" }),
      fakeBill({
        id: "b-refund",
        dueDate: null,
        status: "credit_due",
        kind: "credit_note",
      }),
      fakeBill({
        id: "b-cancelled",
        dueDate: "2026-07-01",
        status: "cancelled",
      }),
    ];
  });

  it("returns every bill by due date, undated last, when no status is given", async () => {
    const page = await client().listBills();
    expect(ids(page.items)).toEqual([
      "b-cancelled",
      "b-paid",
      "b-overdue",
      "b-open",
      "b-refund",
    ]);
    expect(page.nextCursor).toBeNull();
    expect(fake.requests[0]!.query.toString()).toBe("");
  });

  it("joins statuses and filters like the bill list", async () => {
    const page = await client().listBills({ status: ["open", "overdue"] });
    expect(fake.requests[0]!.query.get("status")).toBe("open,overdue");
    expect(ids(page.items)).toEqual(["b-overdue", "b-open"]);
    expect(
      ids((await client().listBills({ status: ["refund"] })).items),
    ).toEqual(["b-refund"]);
    expect(
      ids((await client().listBills({ status: ["paid", "cancelled"] })).items),
    ).toEqual(["b-cancelled", "b-paid"]);
  });

  it("filters by due date range, leaving out undated bills", async () => {
    const page = await client().listBills({
      dueFrom: "2026-08-01",
      dueTo: "2026-09-30",
    });
    expect(ids(page.items)).toEqual(["b-paid", "b-overdue"]);
    const q = fake.requests[0]!.query;
    expect(q.get("dueFrom")).toBe("2026-08-01");
    expect(q.get("dueTo")).toBe("2026-09-30");
  });

  it("updatedSince is inclusive and accepts a Date", async () => {
    fake.bills = [
      fakeBill({ id: "old", updatedAt: "2026-09-01T00:00:00.000Z" }),
      fakeBill({ id: "edge", updatedAt: "2026-10-01T00:00:00.000Z" }),
      fakeBill({ id: "new", updatedAt: "2026-10-02T00:00:00.000Z" }),
    ];
    const page = await client().listBills({
      updatedSince: new Date("2026-10-01T00:00:00Z"),
    });
    expect(ids(page.items).sort()).toEqual(["edge", "new"]);
    expect(fake.requests[0]!.query.get("updatedSince")).toBe(
      "2026-10-01T00:00:00.000Z",
    );
    const withOffset = await client().listBills({
      updatedSince: "2026-10-02T02:00:00+02:00",
    });
    expect(ids(withOffset.items)).toEqual(["new"]);
  });

  it("pages with limit and cursor", async () => {
    const first = await client().listBills({ limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await client().listBills({
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(ids(second.items)).toEqual(["b-overdue", "b-open"]);
  });

  it("parses every contract field and strips unknown ones", async () => {
    fake.bills = [];
    fake.replyNext("/bills", {
      status: 200,
      body: JSON.stringify({
        items: [
          { ...fakeBill({ id: "x", notes: "n" }), iban: "CH00", secret: 1 },
        ],
        nextCursor: null,
        debug: true,
      }),
    });
    const page = await client().listBills();
    expect(page.items[0]).toEqual(fakeBill({ id: "x", notes: "n" }));
    expect(page.items[0]).not.toHaveProperty("iban");
    expect(page).not.toHaveProperty("debug");
  });

  it("rejects invalid arguments before sending anything", async () => {
    const c = client();
    const bad: Array<Parameters<KeptClient["listBills"]>[0]> = [
      { status: ["bogus" as never] },
      { dueFrom: "2026-13-01" },
      { dueTo: "01.10.2026" },
      { updatedSince: "2026-10-01" },
      { updatedSince: "2026-10-01T00:00:00" },
      { updatedSince: new Date("nope") },
      { limit: 0 },
      { limit: 201 },
      { limit: 1.5 },
      { cursor: "" },
      { cursor: "x".repeat(513) },
    ];
    for (const q of bad) {
      expect(await codeOf(c.listBills(q)), JSON.stringify(q)).toBe(
        "invalid_input",
      );
    }
    expect(await codeOf(collect(c.iterateBills({ limit: 0 })))).toBe(
      "invalid_input",
    );
    expect(await codeOf(collect(c.iterateTransactions({ from: "x" })))).toBe(
      "invalid_input",
    );
    expect(fake.requests).toHaveLength(0);
  });

  it("needs the bills:read scope and names the endpoint", async () => {
    fake.setToken({ scopes: ["transactions:read"] });
    const err = await errorOf(client().listBills());
    expect(err.code).toBe("forbidden");
    expect(err.status).toBe(403);
    expect(err.endpoint).toBe("GET /bills");
    expect(err.message).toContain("GET /bills");
  });
});

describe("iterateBills", () => {
  beforeEach(() => {
    fake.bills = Array.from({ length: 5 }, (_, i) =>
      fakeBill({ id: `b${i + 1}`, dueDate: `2026-10-0${i + 1}` }),
    );
  });

  it("follows the cursor over three pages", async () => {
    const pages = await collect(client().iterateBills({ limit: 2 }));
    expect(pages.map(ids)).toEqual([["b1", "b2"], ["b3", "b4"], ["b5"]]);
    const reqs = fake.requestsTo("/bills");
    expect(reqs).toHaveLength(3);
    expect(reqs[0]!.query.get("cursor")).toBeNull();
    expect(reqs[1]!.query.get("cursor")).toEqual(expect.any(String));
    expect(reqs[2]!.query.get("cursor")).not.toBe(reqs[1]!.query.get("cursor"));
    for (const r of reqs) expect(r.query.get("limit")).toBe("2");
  });

  it("uses a page size of 100 by default and keeps the filters on every page", async () => {
    await collect(client().iterateBills({ status: ["open"], limit: 3 }));
    for (const r of fake.requestsTo("/bills")) {
      expect(r.query.get("status")).toBe("open");
    }
    fake.requests = [];
    await collect(client().iterateBills());
    expect(fake.requests[0]!.query.get("limit")).toBe("100");
  });

  it("can start from a cursor and stop early without fetching more", async () => {
    const c = client();
    const first = await c.listBills({ limit: 2 });
    fake.requests = [];
    const pages: string[][] = [];
    for await (const page of c.iterateBills({
      limit: 2,
      cursor: first.nextCursor!,
    })) {
      pages.push(ids(page));
      break;
    }
    expect(pages).toEqual([["b3", "b4"]]);
    expect(fake.requests).toHaveLength(1);
  });

  it("yields one empty page for an empty list", async () => {
    fake.bills = [];
    expect(await collect(client().iterateBills())).toEqual([[]]);
  });

  it("retries a page after 429 and honours Retry-After", async () => {
    fake.rateLimitNext("/bills", 2);
    const pages = await collect(client().iterateBills({ limit: 3 }));
    expect(pages.flat()).toHaveLength(5);
    expect(noSleep).toHaveBeenCalledTimes(1);
    expect(noSleep).toHaveBeenCalledWith(2000);
    expect(fake.requestsTo("/bills")).toHaveLength(3);
  });

  it("gives up after two retries with rate_limited and the wait it was told", async () => {
    fake.rateLimitNext("/bills", 3, { times: 5 });
    const err = await errorOf(collect(client().iterateBills()));
    expect(err.code).toBe("rate_limited");
    expect(err.retryAfter).toBe(3);
    expect(err.status).toBe(429);
    expect(fake.requestsTo("/bills")).toHaveLength(3);
    expect(noSleep).toHaveBeenCalledTimes(2);
  });

  it("does not wait out a Retry-After beyond the cap", async () => {
    fake.rateLimitNext("/bills", 600, { times: 5 });
    const err = await errorOf(
      collect(
        client({ retry: { sleep: noSleep, maxDelayMs: 5000 } }).iterateBills(),
      ),
    );
    expect(err.code).toBe("rate_limited");
    expect(noSleep).not.toHaveBeenCalled();
    expect(fake.requestsTo("/bills")).toHaveLength(1);
  });

  it("retries 5xx with backoff, then succeeds", async () => {
    fake.failNext("/bills", 503, { times: 2 });
    const pages = await collect(client().iterateBills({ limit: 10 }));
    expect(pages.flat()).toHaveLength(5);
    expect(noSleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      500, 1000,
    ]);
  });

  it("does not retry client errors or auth failures", async () => {
    fake.failNext("/bills", 400);
    expect(await codeOf(collect(client().iterateBills()))).toBe("bad_request");
    fake.failNext("/bills", 401);
    expect(await codeOf(collect(client().iterateBills()))).toBe("unauthorized");
    expect(noSleep).not.toHaveBeenCalled();
    expect(fake.requestsTo("/bills")).toHaveLength(2);
  });

  it("fails when pagination does not advance", async () => {
    const stuck = JSON.stringify({ items: [], nextCursor: "same" });
    fake.replyNext("/bills", { status: 200, body: stuck }, { times: 10 });
    const err = await errorOf(collect(client().iterateBills()));
    expect(err.code).toBe("invalid_response");
    expect(err.message).toContain("does not advance");
    expect(fake.requestsTo("/bills")).toHaveLength(2);
  });

  it("fails when a cursor repeats later", async () => {
    const reply = (c: string) => JSON.stringify({ items: [], nextCursor: c });
    fake.replyNext("/bills", { status: 200, body: reply("a") });
    fake.replyNext("/bills", { status: 200, body: reply("b") });
    fake.replyNext("/bills", { status: 200, body: reply("a") });
    expect(await codeOf(collect(client().iterateBills()))).toBe(
      "invalid_response",
    );
  });
});

describe("bills: single", () => {
  it("getBill returns the bill", async () => {
    fake.bills = [fakeBill({ id: "b1" })];
    expect(await client().getBill("b1")).toEqual(fakeBill({ id: "b1" }));
    expect(fake.requests[0]!.path).toBe("/bills/b1");
  });

  it("maps an unknown bill to not_found", async () => {
    expect(await codeOf(client().getBill("nope"))).toBe("not_found");
  });

  it("percent-encodes ids and refuses dot segments", async () => {
    fake.bills = [fakeBill({ id: "a/b?c" })];
    expect((await client().getBill("a/b?c")).id).toBe("a/b?c");
    expect(fake.requests[0]!.path).toBe("/bills/a%2Fb%3Fc");
    fake.requests = [];
    for (const bad of ["", ".", "..", "x".repeat(129)]) {
      expect(await codeOf(client().getBill(bad)), bad).toBe("invalid_input");
    }
    expect(fake.requests).toHaveLength(0);
  });
});

describe("transactions", () => {
  beforeEach(() => {
    fake.transactions = [
      fakeTransaction({
        id: "t1",
        bookingDate: "2026-09-01",
        categoryId: "c-a",
        accountId: "acc-1",
        description: "Strom September",
        counterpartyName: "Muster Energie AG",
      }),
      fakeTransaction({
        id: "t2",
        bookingDate: "2026-09-10",
        categoryId: "c-b",
        accountId: "acc-1",
        description: "Waschmaschine",
        counterpartyName: "Beispiel Elektro",
      }),
      fakeTransaction({
        id: "t3",
        bookingDate: "2026-09-10",
        categoryId: "c-a",
        accountId: "acc-2",
        description: "Strom Oktober",
        counterpartyName: "Muster Energie AG",
      }),
      fakeTransaction({
        id: "t4",
        bookingDate: "2026-09-20",
        categoryId: null,
        accountId: "acc-2",
      }),
      fakeTransaction({
        id: "t5",
        bookingDate: "2026-08-15",
        categoryId: "c-b",
        accountId: "acc-1",
      }),
    ];
  });

  it("lists newest booking date first, newer insertion first within a day", async () => {
    const page = await client().listTransactions();
    expect(ids(page.items)).toEqual(["t4", "t3", "t2", "t1", "t5"]);
  });

  it("filters by date range, category, account and text", async () => {
    const c = client();
    expect(
      ids(
        (await c.listTransactions({ from: "2026-09-01", to: "2026-09-10" }))
          .items,
      ),
    ).toEqual(["t3", "t2", "t1"]);
    expect(
      ids((await c.listTransactions({ categoryId: "c-a" })).items),
    ).toEqual(["t3", "t1"]);
    expect(
      ids((await c.listTransactions({ accountId: "acc-2" })).items),
    ).toEqual(["t4", "t3"]);
    expect(ids((await c.listTransactions({ q: "  WASCH " })).items)).toEqual([
      "t2",
    ]);
    expect(
      ids((await c.listTransactions({ q: "muster energie" })).items),
    ).toEqual(["t3", "t1"]);
    const last = fake.requests[fake.requests.length - 1]!;
    expect(last.query.get("q")).toBe("muster energie");
  });

  it("omits a blank q and rejects one over 100 characters", async () => {
    await client().listTransactions({ q: "   " });
    expect(fake.requests[0]!.query.has("q")).toBe(false);
    expect(
      await codeOf(client().listTransactions({ q: "x".repeat(101) })),
    ).toBe("invalid_input");
    expect(await codeOf(client().listTransactions({ categoryId: "" }))).toBe(
      "invalid_input",
    );
    expect(
      await codeOf(client().listTransactions({ accountId: "x".repeat(65) })),
    ).toBe("invalid_input");
    expect(await codeOf(client().listTransactions({ from: "yesterday" }))).toBe(
      "invalid_input",
    );
  });

  it("updatedSince filters by change time", async () => {
    fake.transactions[1]!.updatedAt = "2026-10-05T00:00:00.000Z";
    const page = await client().listTransactions({
      updatedSince: "2026-10-01T00:00:00Z",
    });
    expect(ids(page.items)).toEqual(["t2"]);
  });

  it("iterates three pages in order", async () => {
    const pages = await collect(client().iterateTransactions({ limit: 2 }));
    expect(pages.map(ids)).toEqual([["t4", "t3"], ["t2", "t1"], ["t5"]]);
    expect(fake.requestsTo("/transactions")).toHaveLength(3);
  });

  it("retries a transaction page after 429", async () => {
    fake.rateLimitNext("/transactions", "1");
    const pages = await collect(client().iterateTransactions({ limit: 10 }));
    expect(pages.flat()).toHaveLength(5);
    expect(noSleep).toHaveBeenCalledWith(1000);
  });

  it("getTransaction returns one transaction with its bill ids", async () => {
    fake.transactions = [fakeTransaction({ id: "t9", billIds: ["b1", "b2"] })];
    const tx = await client().getTransaction("t9");
    expect(tx.billIds).toEqual(["b1", "b2"]);
    expect(await codeOf(client().getTransaction("zzz"))).toBe("not_found");
  });

  describe("category-restricted token", () => {
    beforeEach(() => fake.setToken({ categoryIds: ["c-a"] }));

    it("sees only its categories; others and uncategorised are 404", async () => {
      const c = client();
      expect(ids((await c.listTransactions()).items)).toEqual(["t3", "t1"]);
      expect(await codeOf(c.getTransaction("t2"))).toBe("not_found");
      expect(await codeOf(c.getTransaction("t4"))).toBe("not_found");
      expect((await c.getTransaction("t1")).id).toBe("t1");
    });

    it("an outside categoryId yields an empty list", async () => {
      const page = await client().listTransactions({ categoryId: "c-b" });
      expect(page).toEqual({ items: [], nextCursor: null });
    });

    it("cannot attach a link to a hidden transaction", async () => {
      const err = await errorOf(
        client().upsertLink("transaction", "t2", {
          source: "hauswart",
          label: "x",
          url: "https://hauswart.example.org/x",
        }),
      );
      expect(err.code).toBe("not_found");
    });

    it("cannot read recurring series", async () => {
      const err = await errorOf(client().listRecurringSeries());
      expect(err.code).toBe("forbidden");
      expect(err.endpoint).toBe("GET /recurring-series");
    });

    it("sees only its categories and reparents hidden parents", async () => {
      fake.categories = [
        fakeCategory({ id: "c-a", name: "Strom", parentId: "c-parent" }),
        fakeCategory({ id: "c-parent", name: "Wohnen" }),
        fakeCategory({ id: "c-b", name: "Auto" }),
      ];
      const cats = await client().listCategories();
      expect(cats.map((c) => [c.id, c.parentId])).toEqual([["c-a", null]]);
    });
  });
});

describe("catalogue", () => {
  it("lists all categories across several pages", async () => {
    fake.categories = Array.from({ length: 450 }, (_, i) =>
      fakeCategory({
        id: `c${i}`,
        name: `Kategorie ${String(i).padStart(3, "0")}`,
      }),
    );
    const all = await client().listCategories();
    expect(all).toHaveLength(450);
    expect(new Set(ids(all)).size).toBe(450);
    expect(fake.requestsTo("/categories")).toHaveLength(5);
  });

  it("parses categories with parents", async () => {
    fake.categories = [
      fakeCategory({ id: "p", name: "Wohnen" }),
      fakeCategory({
        id: "k",
        name: "Nebenkosten",
        parentId: "p",
        color: null,
        kind: "income",
      }),
    ];
    const cats = await client().listCategories();
    expect(cats).toEqual([
      fakeCategory({
        id: "k",
        name: "Nebenkosten",
        parentId: "p",
        color: null,
        kind: "income",
      }),
      fakeCategory({ id: "p", name: "Wohnen" }),
    ]);
  });

  it("lists accounts", async () => {
    fake.accounts = [
      fakeAccount({ id: "a1", name: "Alltag" }),
      fakeAccount({
        id: "a2",
        name: "Sparen",
        type: "savings",
        archived: true,
      }),
    ];
    const accounts = await client().listAccounts();
    expect(accounts.map((a) => [a.id, a.type, a.archived])).toEqual([
      ["a1", "current", false],
      ["a2", "savings", true],
    ]);
  });

  it("lists recurring series, optionally by status", async () => {
    fake.series = [
      fakeSeries({ id: "s1", status: "confirmed", nextExpected: "2026-10-05" }),
      fakeSeries({ id: "s2", status: "suggested", nextExpected: "2026-10-01" }),
      fakeSeries({ id: "s3", status: "dismissed", nextExpected: "2026-11-01" }),
    ];
    expect(ids(await client().listRecurringSeries())).toEqual([
      "s2",
      "s1",
      "s3",
    ]);
    expect(
      ids(await client().listRecurringSeries({ status: "confirmed" })),
    ).toEqual(["s1"]);
    expect(fake.requests[1]!.query.get("status")).toBe("confirmed");
    expect(
      await codeOf(client().listRecurringSeries({ status: "x" as never })),
    ).toBe("invalid_input");
  });

  it("scopes are checked per endpoint", async () => {
    fake.setToken({ scopes: ["bills:read"] });
    const c = client();
    expect((await errorOf(c.listCategories())).endpoint).toBe(
      "GET /categories",
    );
    expect((await errorOf(c.listAccounts())).endpoint).toBe("GET /accounts");
    expect((await errorOf(c.listRecurringSeries())).endpoint).toBe(
      "GET /recurring-series",
    );
    expect((await errorOf(c.listTransactions())).endpoint).toBe(
      "GET /transactions",
    );
    expect((await errorOf(c.getTransaction("x"))).endpoint).toBe(
      "GET /transactions/{id}",
    );
  });
});

describe("links", () => {
  const input = {
    source: "hauswart",
    label: "Wohnungskosten 2026",
    url: "https://hauswart.example.org/costs/2026",
  };

  beforeEach(() => {
    fake.bills = [fakeBill({ id: "b1" })];
    fake.transactions = [fakeTransaction({ id: "t1" })];
  });

  it("creates a link (201) and refreshes it when posted again (200)", async () => {
    const c = client();
    const first = await c.upsertLink("bill", "b1", input);
    expect(first.created).toBe(true);
    expect(first.link).toMatchObject({
      entityType: "bill",
      entityId: "b1",
      ...input,
    });
    const req = fake.requests[0]!;
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/bills/b1/links");
    expect(req.headers.get("content-type")).toBe("application/json");
    expect(req.json).toEqual(input);

    const again = await c.upsertLink("bill", "b1", { ...input, label: "Neu" });
    expect(again.created).toBe(false);
    expect(again.link.id).toBe(first.link.id);
    expect(again.link.label).toBe("Neu");
    expect(fake.links).toHaveLength(1);
  });

  it("treats spellings of the same URL as one link", async () => {
    const c = client();
    await c.upsertLink("bill", "b1", {
      ...input,
      url: "https://Hauswart.example.org",
    });
    const again = await c.upsertLink("bill", "b1", {
      ...input,
      url: "https://hauswart.example.org/",
    });
    expect(again.created).toBe(false);
  });

  it("links transactions and lists links per entity", async () => {
    const c = client();
    await c.upsertLink("transaction", "t1", input);
    await c.upsertLink("bill", "b1", { ...input, source: "other app" });
    const txLinks = await c.listLinks("transaction", "t1");
    expect(txLinks.map((l) => l.entityId)).toEqual(["t1"]);
    expect(txLinks[0]!.source).toBe("hauswart");
    expect(await c.listLinks("bill", "b1")).toHaveLength(1);
    expect(fake.requests.at(-1)!.path).toBe("/bills/b1/links");
  });

  it("trims inputs before sending", async () => {
    await client().upsertLink("bill", "b1", {
      source: "  hauswart ",
      label: " Label  ",
      url: "  https://hauswart.example.org/x ",
    });
    expect(fake.requests[0]!.json).toEqual({
      source: "hauswart",
      label: "Label",
      url: "https://hauswart.example.org/x",
    });
  });

  it("answers conflict at the limit of 20 links", async () => {
    const c = client();
    for (let i = 0; i < 20; i++) {
      await c.upsertLink("bill", "b1", {
        ...input,
        url: `https://hauswart.example.org/${i}`,
      });
    }
    const err = await errorOf(
      c.upsertLink("bill", "b1", {
        ...input,
        url: "https://hauswart.example.org/21",
      }),
    );
    expect(err.code).toBe("conflict");
    expect(err.status).toBe(409);
    expect(
      await c.upsertLink("bill", "b1", {
        ...input,
        url: "https://hauswart.example.org/3",
        label: "ok",
      }),
    ).toMatchObject({ created: false });
  });

  it("deletes a link and answers not_found the second time", async () => {
    const c = client();
    const { link } = await c.upsertLink("bill", "b1", input);
    await expect(c.deleteLink(link.id)).resolves.toBeUndefined();
    expect(fake.requests.at(-1)).toMatchObject({
      method: "DELETE",
      path: `/links/${link.id}`,
    });
    expect(fake.links).toHaveLength(0);
    expect(await codeOf(c.deleteLink(link.id))).toBe("not_found");
  });

  it("can delete a link another app created", async () => {
    fake.links.push({
      id: "l-other",
      entityType: "bill",
      entityId: "b1",
      source: "other app",
      label: "x",
      url: "https://other.example.org/",
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    await client().deleteLink("l-other");
    expect(fake.links).toHaveLength(0);
  });

  it("needs links:write for upsert and delete, and the read scope for lists", async () => {
    fake.setToken({ scopes: ["bills:read"] });
    const c = client();
    const up = await errorOf(c.upsertLink("bill", "b1", input));
    expect(up.code).toBe("forbidden");
    expect(up.endpoint).toBe("POST /bills/{id}/links");
    expect((await errorOf(c.deleteLink("l1"))).endpoint).toBe(
      "DELETE /links/{linkId}",
    );
    expect(await c.listLinks("bill", "b1")).toEqual([]);
    expect((await errorOf(c.listLinks("transaction", "t1"))).endpoint).toBe(
      "GET /transactions/{id}/links",
    );
  });

  it("answers not_found for an unknown entity", async () => {
    expect(await codeOf(client().upsertLink("bill", "nope", input))).toBe(
      "not_found",
    );
    expect(await codeOf(client().listLinks("transaction", "nope"))).toBe(
      "not_found",
    );
  });

  it("rejects bad link input before any request", async () => {
    const c = client();
    const bad = [
      { ...input, url: "javascript:alert(1)" },
      { ...input, url: "ftp://example.org/x" },
      { ...input, url: "https://user:pw@example.org/" },
      { ...input, url: "https://exa mple.org/" },
      { ...input, url: "/relative" },
      { ...input, url: `https://example.org/${"a".repeat(2048)}` },
      { ...input, source: "" },
      { ...input, source: "x".repeat(65) },
      { ...input, label: "   " },
      { ...input, label: "x".repeat(201) },
      { ...input, label: "bad\nlabel" },
      { ...input, label: "bad‮label" },
      { ...input, source: "a​b" },
    ];
    for (const b of bad) {
      expect(
        await codeOf(c.upsertLink("bill", "b1", b)),
        JSON.stringify(b).slice(0, 60),
      ).toBe("invalid_input");
    }
    expect(await codeOf(c.upsertLink("nope" as never, "b1", input))).toBe(
      "invalid_input",
    );
    expect(fake.requests).toHaveLength(0);
  });

  it("rejects a link answer for another entity", async () => {
    fake.replyNext("/links", {
      status: 201,
      body: JSON.stringify({
        id: "l1",
        entityType: "bill",
        entityId: "someone-else",
        ...input,
        createdAt: "2026-10-06T12:00:00.000Z",
      }),
    });
    expect(await codeOf(client().upsertLink("bill", "b1", input))).toBe(
      "invalid_response",
    );
  });

  it("rejects a 2xx other than 200/201 for an upsert", async () => {
    fake.replyNext("/links", { status: 202, body: "{}" });
    expect(await codeOf(client().upsertLink("bill", "b1", input))).toBe(
      "invalid_response",
    );
  });

  it("rejects a link with a non-http(s) URL in the answer", async () => {
    fake.replyNext("/links", {
      status: 200,
      body: JSON.stringify({
        id: "l1",
        entityType: "bill",
        entityId: "b1",
        source: "x",
        label: "x",
        url: "javascript:alert(1)",
        createdAt: "2026-10-06T12:00:00.000Z",
      }),
    });
    expect(await codeOf(client().listLinks("bill", "b1"))).toBe(
      "invalid_response",
    );
  });
});

describe("transport errors", () => {
  it("maps statuses to codes", async () => {
    const cases: Array<[number, string]> = [
      [400, "bad_request"],
      [401, "unauthorized"],
      [403, "forbidden"],
      [404, "not_found"],
      [405, "bad_request"],
      [409, "conflict"],
      [413, "bad_request"],
      [415, "bad_request"],
      [429, "rate_limited"],
      [500, "server"],
      [502, "server"],
      [503, "server"],
    ];
    for (const [status, code] of cases) {
      fake.failNext("/me", status);
      const err = await errorOf(client().me());
      expect(err.code, String(status)).toBe(code);
      expect(err.status).toBe(status);
    }
  });

  it("rate_limited carries Retry-After seconds, an HTTP date, or null", async () => {
    fake.rateLimitNext("/me", 42);
    expect((await errorOf(client().me())).retryAfter).toBe(42);
    fake.rateLimitNext("/me", new Date(Date.now() + 30_000).toUTCString());
    const dated = (await errorOf(client().me())).retryAfter!;
    expect(dated).toBeGreaterThanOrEqual(28);
    expect(dated).toBeLessThanOrEqual(31);
    fake.rateLimitNext("/me", "soon");
    expect((await errorOf(client().me())).retryAfter).toBeNull();
    fake.failNext("/me", 429);
    expect((await errorOf(client().me())).retryAfter).toBeNull();
  });

  it("a real per-token request budget answers 429 with Retry-After", async () => {
    fake.rateLimit = { limit: 2, retryAfter: 60 };
    const c = client();
    await c.me();
    await c.me();
    const err = await errorOf(c.me());
    expect(err.code).toBe("rate_limited");
    expect(err.retryAfter).toBe(60);
  });

  it("does not follow redirects", async () => {
    fake.redirectAll = true;
    const err = await errorOf(client().me());
    expect(err.code).toBe("redirect");
    expect(fake.requests).toHaveLength(1);
  });

  it("times out", async () => {
    fake.delayMs = 300;
    expect(await codeOf(client({ timeoutMs: 50 }).me())).toBe("timeout");
  });

  it("reports an unreachable host as network without the host details", async () => {
    const closed = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response(),
    });
    const port = closed.port;
    await closed.stop(true);
    const err = await errorOf(
      new KeptClient({
        baseUrl: `http://127.0.0.1:${port}`,
        token: fake.token,
        timeoutMs: 5000,
      }).me(),
    );
    expect(err.code).toBe("network");
    expect(err.message).not.toContain("127.0.0.1");
  });

  it("rejects bodies that are not JSON or have the wrong shape", async () => {
    const reply = (body: string, status = 200) =>
      fake.replyNext("/bills", { status, body });
    const bills = (over: Record<string, unknown>) =>
      JSON.stringify({
        items: [{ ...fakeBill({ id: "x" }), ...over }],
        nextCursor: null,
      });
    const bad = [
      "<html>oops</html>",
      "",
      "null",
      "[]",
      JSON.stringify({ items: "no", nextCursor: null }),
      JSON.stringify({ items: [] }),
      bills({ amount: 12.5 }),
      bills({ amount: "123" }),
      bills({ amount: -1 }),
      bills({ currency: "chf" }),
      bills({ dueDate: "2026-02-30" }),
      bills({ dueDate: "01.10.2026" }),
      bills({ updatedAt: "yesterday" }),
      bills({ updatedAt: "2026-10-01T00:00:00" }),
      bills({ status: "mystery" }),
      bills({ kind: "receipt" }),
      bills({ overdue: "no" }),
      bills({ paidAmount: 1.5 }),
      bills({ url: "javascript:alert(1)" }),
      bills({ url: "https://user:pw@kept.example.org/" }),
      bills({ id: "" }),
      JSON.stringify({ items: [], nextCursor: "" }),
      JSON.stringify({ items: [], nextCursor: "x".repeat(513) }),
    ];
    for (const body of bad) {
      reply(body);
      const err = await errorOf(client().listBills());
      expect(err.code, body.slice(0, 60)).toBe("invalid_response");
    }
  });

  it("names the failing path of a bad field but never echoes values", async () => {
    fake.replyNext("/transactions", {
      status: 200,
      body: JSON.stringify({
        items: [{ ...fakeTransaction({ id: "x" }), amount: "SECRET-AMOUNT" }],
        nextCursor: null,
      }),
    });
    const err = await errorOf(client().listTransactions());
    expect(err.code).toBe("invalid_response");
    expect(err.message).toContain("items.0.amount");
    expect(err.message).not.toContain("SECRET-AMOUNT");
  });

  it("validates transactions, categories, accounts and series shapes", async () => {
    const rep = (part: string, items: unknown[]) =>
      fake.replyNext(part, {
        status: 200,
        body: JSON.stringify({ items, nextCursor: null }),
      });
    rep("/transactions", [{ ...fakeTransaction(), billIds: "b1" }]);
    expect(await codeOf(client().listTransactions())).toBe("invalid_response");
    rep("/transactions", [{ ...fakeTransaction(), bookingDate: "2026-9-1" }]);
    expect(await codeOf(client().listTransactions())).toBe("invalid_response");
    rep("/categories", [{ ...fakeCategory(), kind: "other" }]);
    expect(await codeOf(client().listCategories())).toBe("invalid_response");
    rep("/accounts", [{ ...fakeAccount(), type: "wallet" }]);
    expect(await codeOf(client().listAccounts())).toBe("invalid_response");
    rep("/recurring-series", [{ ...fakeSeries(), amount: 1.1 }]);
    expect(await codeOf(client().listRecurringSeries())).toBe(
      "invalid_response",
    );
    rep("/recurring-series", [{ ...fakeSeries(), cadence: "daily" }]);
    expect(await codeOf(client().listRecurringSeries())).toBe(
      "invalid_response",
    );
  });

  it("an iterator never yields a partial result when a later page is malformed", async () => {
    fake.bills = Array.from({ length: 4 }, (_, i) =>
      fakeBill({ id: `b${i}`, dueDate: `2026-10-0${i + 1}` }),
    );
    const c = client();
    const seen: string[][] = [];
    await expect(
      (async () => {
        let n = 0;
        for await (const page of c.iterateBills({ limit: 2 })) {
          seen.push(ids(page));
          if (++n === 1) {
            fake.replyNext("/bills", {
              status: 200,
              body: '{"items":[{"id":1}],"nextCursor":null}',
            });
          }
        }
      })(),
    ).rejects.toMatchObject({ code: "invalid_response" });
    expect(seen).toEqual([["b0", "b1"]]);
  });

  it("refuses an oversized body", async () => {
    fake.bills = Array.from({ length: 30 }, (_, i) =>
      fakeBill({ id: `b${i}` }),
    );
    const err = await errorOf(
      client({ maxJsonBytes: 2000 }).listBills({ limit: 30 }),
    );
    expect(err.code).toBe("too_large");
  });

  it("refuses an oversized body with no Content-Length", async () => {
    fake.replyNext("/me", { status: 200, body: "x".repeat(6 * 1024 * 1024) });
    expect(await codeOf(client().me())).toBe("too_large");
  });

  it("never puts the token, URL or response body into error messages", async () => {
    const secret = "TOP-SECRET-BODY";
    fake.replyNext("/me", {
      status: 500,
      body: JSON.stringify({ message: secret }),
    });
    const err = await errorOf(client().me());
    const text = `${err.message} ${err.stack ?? ""} ${JSON.stringify(err)}`;
    expect(text).not.toContain(secret);
    expect(text).not.toContain(fake.token);
    expect(text).not.toContain(fake.baseUrl);
  });

  it("allowInsecureTls does not change plain http calls", async () => {
    expect((await client({ allowInsecureTls: true }).me()).id).toBe(
      fake.user.id,
    );
  });
});

describe("error helpers", () => {
  it("describe known and unknown errors without leaking details", () => {
    const err = new KeptError("forbidden", { endpoint: "GET /bills" });
    expect(describeError(err)).toContain("GET /bills");
    expect(errorCode(err)).toBe("forbidden");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(describeError(new Error("token kept_x leaked"))).toBe(
      "An unexpected error occurred.",
    );
    expect(spy.mock.calls.flat().join(" ")).not.toContain("kept_x");
    spy.mockRestore();
    expect(messageForCode("rate_limited")).toContain("limiting");
    expect(messageForCode("conflict")).toContain("20");
    expect(messageForCode("zzz")).toBe("An unexpected error occurred.");
  });
});
