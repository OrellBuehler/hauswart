import { describe, expect, it } from "vitest";
import { saveConnection } from "../../src/lib/server/connections/connections";
import { registerFinanceProvider } from "../../src/lib/server/finance/providers";
import { recordSuggestion } from "../../src/lib/server/finance/suggestions";
import { ctxAt } from "../../src/lib/testing/domain";
import { useMcp } from "./test-harness";

const ALL = ["read", "write", "costs:write"] as const;
const FINANCE_WRITERS = [
  "accept_finance_suggestion",
  "dismiss_finance_suggestion",
  "sync_finance",
];

describe("finance inbox tools", () => {
  const mcp = useMcp();

  /** A connection for a person and a helper that offers things in their inbox. */
  async function inboxOf(
    connect: Awaited<ReturnType<typeof mcp.connect>>,
    person: "anna" | "ben" = "anna",
  ) {
    const user = connect[person];
    const ctx = ctxAt(mcp.db.db);
    const connection = saveConnection(ctx, "kept", user.id, {
      baseUrl: `https://${person}-finance.example.org`,
      token: "kept_example-token",
      allowInsecureTls: false,
    });
    const offer = (
      kind: "cost" | "asset" | "bill_task",
      providerRef: string,
      payload: Record<string, unknown>,
    ) =>
      recordSuggestion(ctx, {
        connectionId: connection.id,
        userId: user.id,
        kind,
        providerRef,
        payload,
      }).row;
    const cost = (ref: string, over: Record<string, unknown> = {}) =>
      offer("cost", `tx:${ref}`, {
        source: "finance_transaction",
        date: "2026-03-10",
        amountMinor: 12050,
        currency: "CHF",
        title: "Reparatur Backofen",
        payee: "Beispiel AG",
        category: "repair",
        url: `https://${person}-finance.example.org/tx/${ref}`,
        assetId: null,
        ...over,
      });
    const asset = (ref: string) =>
      offer("asset", `tx:${ref}`, {
        name: "Geschirrspüler",
        purchaseDate: "2026-02-01",
        priceMinor: 89900,
        currency: "CHF",
        url: null,
      });
    const bill = (ref: string) =>
      offer("bill_task", `bill:${ref}`, {
        title: "Muster Verwaltung AG: INV-7",
        dueDate: "2026-07-01",
        amountMinor: 45000,
        currency: "CHF",
        url: null,
      });
    return { user, connection, cost, asset, bill };
  }

  it("lists only the token user's own pending suggestions, readably", async () => {
    const c = await mcp.connect({ scopes: [...ALL] });
    const anna = await inboxOf(c);
    const ben = await inboxOf(c, "ben");
    anna.cost("1");
    anna.asset("1");
    anna.bill("b1");
    ben.cost("2", { title: "Bens private Ausgabe" });

    const list = await c.ok("list_finance_suggestions");
    expect(list.suggestions).toHaveLength(3);
    expect(JSON.stringify(list)).not.toContain("Bens");
    expect(JSON.stringify(list)).not.toContain("ben-finance");
    const byKind = Object.fromEntries(
      list.suggestions.map((s: { kind: string }) => [s.kind, s]),
    );
    expect(byKind.cost).toMatchObject({
      title: "Reparatur Backofen",
      amount: "120.50 CHF",
      category: "repair",
      payee: "Beispiel AG",
      date: "2026-03-10",
      origin: "finance_transaction",
    });
    expect(byKind.asset).toMatchObject({
      name: "Geschirrspüler",
      price: "899.00 CHF",
      purchaseDate: "2026-02-01",
    });
    expect(byKind.bill_task).toMatchObject({
      title: "Muster Verwaltung AG: INV-7",
      amount: "450.00 CHF",
      dueDate: "2026-07-01",
    });
    const reply = await c.call("list_finance_suggestions");
    expect(reply.summary).toContain("3 suggestions");

    const onlyAssets = await c.ok("list_finance_suggestions", {
      kind: "asset",
    });
    expect(onlyAssets.suggestions.map((s: { kind: string }) => s.kind)).toEqual(
      ["asset"],
    );
  });

  it("says so when the inbox is empty and pages through a long one", async () => {
    const c = await mcp.connect({ scopes: [...ALL] });
    const empty = await c.call("list_finance_suggestions");
    expect(empty.summary).toContain("0 suggestions");
    const anna = await inboxOf(c);
    for (const ref of ["1", "2", "3"]) anna.cost(ref);
    const first = await c.ok("list_finance_suggestions", { limit: 2 });
    expect(first.suggestions).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = await c.ok("list_finance_suggestions", {
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.suggestions).toHaveLength(1);
  });

  it("accepts a cost as it is and books it for the household", async () => {
    const c = await mcp.connect({ scopes: [...ALL] });
    const anna = await inboxOf(c);
    const row = anna.cost("1");
    const accepted = await c.ok("accept_finance_suggestion", { id: row.id });
    expect(accepted.entity.type).toBe("cost");
    expect(accepted.suggestion.status).toBe("accepted");
    const costs = await c.ok("list_costs");
    expect(costs.costs).toHaveLength(1);
    expect(costs.costs[0]).toMatchObject({
      id: accepted.entity.id,
      title: "Reparatur Backofen",
      amount: "120.50 CHF",
      category: "repair",
      paidBy: "Anna",
      split: "ownership",
    });
    expect(
      (await c.ok("list_finance_suggestions")).suggestions ?? [],
    ).toHaveLength(0);
    const again = await c.call("accept_finance_suggestion", { id: row.id });
    expect(again.isError).toBe(true);
    expect(again.text).toContain("[conflict]");
  });

  it("accepts a cost with overrides, naming the asset and the payer", async () => {
    const c = await mcp.connect({ scopes: [...ALL] });
    await c.ok("create_asset", { name: "Backofen" });
    const anna = await inboxOf(c);
    const row = anna.cost("1");
    await c.ok("accept_finance_suggestion", {
      id: row.id,
      title: "Backofen repariert",
      category: "maintenance",
      asset: "Backofen",
      paidBy: "Ben",
      split: "equal",
      deductible: "maintenance",
      notes: "Heizelement ersetzt",
    });
    const [cost] = (await c.ok("list_costs")).costs;
    expect(cost).toMatchObject({
      title: "Backofen repariert",
      category: "maintenance",
      asset: "Backofen",
      paidBy: "Ben",
      split: "equal",
      deductible: "maintenance",
      notes: "Heizelement ersetzt",
    });
  });

  it("accepts an asset suggestion as a device, and a bill as a task", async () => {
    const c = await mcp.connect({ scopes: [...ALL] });
    const anna = await inboxOf(c);
    const asset = anna.asset("1");
    const bill = anna.bill("b1");

    const device = await c.ok("accept_finance_suggestion", {
      id: asset.id,
      name: "Geschirrspüler Küche",
      assetKind: "fixture",
    });
    expect(device.entity.type).toBe("asset");
    const found = await c.ok("get_asset", { asset: device.entity.id });
    expect(found).toMatchObject({
      name: "Geschirrspüler Küche",
      kind: "fixture",
      purchaseDate: "2026-02-01",
    });

    const task = await c.ok("accept_finance_suggestion", { id: bill.id });
    expect(task.entity.type).toBe("task");
    const created = await c.ok("get_task", { id: task.entity.id });
    expect(created).toMatchObject({
      title: "Muster Verwaltung AG: INV-7",
      category: "payment",
    });
  });

  it("refuses overrides that do not fit the kind of suggestion", async () => {
    const c = await mcp.connect({ scopes: [...ALL] });
    const anna = await inboxOf(c);
    const asset = anna.asset("1");
    const reply = await c.call("accept_finance_suggestion", {
      id: asset.id,
      category: "repair",
    });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("[invalid_request]");
    expect((await c.ok("list_finance_suggestions")).suggestions).toHaveLength(
      1,
    );
  });

  it("dismisses for good, and repeating it does no harm", async () => {
    const c = await mcp.connect({ scopes: [...ALL] });
    const anna = await inboxOf(c);
    const row = anna.cost("1");
    const dismissed = await c.ok("dismiss_finance_suggestion", { id: row.id });
    expect(dismissed.status).toBe("dismissed");
    await c.ok("dismiss_finance_suggestion", { id: row.id });
    expect((await c.ok("list_finance_suggestions")).suggestions ?? []).toEqual(
      [],
    );
    const gone = await c.ok("list_finance_suggestions", {
      status: "dismissed",
    });
    expect(gone.suggestions).toHaveLength(1);
    const accept = await c.call("accept_finance_suggestion", { id: row.id });
    expect(accept.isError).toBe(true);
    expect(accept.text).toContain("[conflict]");
  });

  it("never reaches another person's suggestion", async () => {
    const c = await mcp.connect({ scopes: [...ALL] });
    const ben = await inboxOf(c, "ben");
    const row = ben.cost("1");
    for (const name of [
      "accept_finance_suggestion",
      "dismiss_finance_suggestion",
    ]) {
      const reply = await c.call(name, { id: row.id });
      expect(reply.isError).toBe(true);
      expect(reply.text).toContain("[not_found]");
    }
    expect((await c.ok("list_costs")).costs ?? []).toEqual([]);
  });

  describe("sync_finance", () => {
    it("runs the person's own sync and reports what it did", async () => {
      const c = await mcp.connect({ scopes: [...ALL] });
      await inboxOf(c);
      const off = registerFinanceProvider({
        kind: "kept",
        sync: async () => ({
          ok: true,
          stats: { suggestions: 2, tasksCreated: 1, skipped: 0 },
        }),
      });
      try {
        const reply = await c.call("sync_finance");
        expect(reply.isError).toBe(false);
        expect(reply.summary).toContain("2 new suggestions");
        expect(reply.json).toMatchObject({
          ok: true,
          stats: { suggestions: 2, tasksCreated: 1 },
        });
      } finally {
        off();
      }
    });

    it("reports a provider that could not be reached without an error result", async () => {
      const c = await mcp.connect({ scopes: [...ALL] });
      await inboxOf(c);
      const off = registerFinanceProvider({
        kind: "kept",
        sync: async () => ({
          ok: false,
          error: { code: "unauthorized", message: "The token was rejected." },
          stats: {},
        }),
      });
      try {
        const reply = await c.call("sync_finance");
        expect(reply.isError).toBe(false);
        expect(reply.summary).toContain("did not finish");
        expect(reply.summary).toContain("unauthorized");
        expect(reply.json).toMatchObject({
          ok: false,
          error: { code: "unauthorized" },
        });
      } finally {
        off();
      }
    });

    it("is not found without a connection of the token user's own", async () => {
      const c = await mcp.connect({ scopes: [...ALL] });
      await inboxOf(c, "ben");
      const off = registerFinanceProvider({
        kind: "kept",
        sync: async () => ({ ok: true, stats: {} }),
      });
      try {
        const reply = await c.call("sync_finance");
        expect(reply.isError).toBe(true);
        expect(reply.text).toContain("[not_found]");
      } finally {
        off();
      }
    });
  });

  it("offers the deciding tools only to a token with costs:write", async () => {
    const reader = await mcp.connect({ scopes: ["read", "write"] });
    expect(reader.server.tools).toContain("list_finance_suggestions");
    for (const name of FINANCE_WRITERS) {
      expect(reader.server.tools).not.toContain(name);
    }
    const bookkeeper = await mcp.connect({ scopes: [...ALL] });
    for (const name of FINANCE_WRITERS) {
      expect(bookkeeper.server.tools).toContain(name);
    }
  });
});
