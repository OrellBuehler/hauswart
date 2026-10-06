import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  connections,
  costEntries,
  financeSuggestions,
  assets,
} from "$lib/server/db";
import { saveConnection } from "$lib/server/connections/connections";
import { getCost } from "$lib/server/costs/costs";
import { createTestUser } from "$lib/testing/auth";
import { ctxAt } from "$lib/testing/domain";
import { useTestDB } from "$lib/testing/db";
import {
  FINANCE_ASSET_SOURCE,
  acceptSuggestion,
  dismissSuggestion,
  findSuggestion,
  getOwnSuggestion,
  listSuggestions,
  recordSuggestion,
  suggestionsCoveringBill,
  type SuggestionInput,
} from "./suggestions";

describe("finance suggestions", () => {
  const test = useTestDB();
  const ctx = () => ctxAt(test.db);

  async function owner(name = "Anna") {
    const user = await createTestUser({ displayName: name });
    const connection = saveConnection(ctx(), "kept", user.id, {
      baseUrl: "https://finance.example.org",
      token: "kept_example-token",
      allowInsecureTls: false,
    });
    return { user, connection };
  }

  const costPayload = (over: Record<string, unknown> = {}) => ({
    source: "finance_transaction",
    date: "2026-03-10",
    amountMinor: 12050,
    currency: "CHF",
    title: "Reparatur",
    payee: "Beispiel AG",
    category: "repair",
    url: "https://finance.example.org/tx/1",
    assetId: null,
    ...over,
  });

  const record = (
    o: { user: { id: string }; connection: { id: string } },
    over: Partial<SuggestionInput> = {},
  ) =>
    recordSuggestion(ctx(), {
      connectionId: o.connection.id,
      userId: o.user.id,
      kind: "cost",
      providerRef: "tx:1",
      payload: costPayload(),
      ...over,
    });

  describe("recording", () => {
    it("creates a pending suggestion once per (connection, kind, reference)", async () => {
      const a = await owner();
      const first = record(a);
      expect(first.created).toBe(true);
      expect(first.row.status).toBe("pending");
      const again = record(a, {
        payload: costPayload({ title: "Korrigiert" }),
      });
      expect(again.created).toBe(false);
      expect(again.row.id).toBe(first.row.id);
      expect(again.row.payloadJson).toMatchObject({ title: "Korrigiert" });
      // the same reference as an asset is its own suggestion
      expect(
        record(a, {
          kind: "asset",
          payload: {
            name: "Herd",
            purchaseDate: "2026-03-10",
            priceMinor: 100000,
            currency: "CHF",
            url: null,
          },
        }).created,
      ).toBe(true);
    });

    it("never revives a dismissed suggestion and never changes an accepted one", async () => {
      const a = await owner();
      const { row } = record(a);
      dismissSuggestion(ctx(), a.user.id, row.id);
      const again = record(a, { payload: costPayload({ title: "Neu" }) });
      expect(again.created).toBe(false);
      expect(again.row.status).toBe("dismissed");
      expect(again.row.payloadJson).toMatchObject({ title: "Reparatur" });

      const second = record(a, { providerRef: "tx:2" });
      await acceptSuggestion(ctx(), a.user.id, second.row.id, {});
      const same = record(a, {
        providerRef: "tx:2",
        payload: costPayload({ title: "Neu" }),
      });
      expect(same.row.status).toBe("accepted");
      expect(same.row.payloadJson).toMatchObject({ title: "Reparatur" });
    });

    it("can be recorded as already decided", async () => {
      const a = await owner();
      expect(record(a, {}).row.status).toBe("pending");
      const dismissed = recordSuggestion(
        ctx(),
        {
          connectionId: a.connection.id,
          userId: a.user.id,
          kind: "cost",
          providerRef: "tx:7",
          payload: costPayload(),
        },
        "dismissed",
      );
      expect(dismissed.row.status).toBe("dismissed");
    });

    it("finds the cost suggestions that settle a bill", async () => {
      const a = await owner();
      record(a, { providerRef: "tx:1", billRefs: ["b1", "b2"] });
      record(a, { providerRef: "tx:2", billRefs: ["b3"] });
      const b = await owner("Ben");
      record(b, { providerRef: "tx:1", billRefs: ["b1"] });
      expect(
        suggestionsCoveringBill(ctx(), a.connection.id, "b1").map(
          (s) => s.providerRef,
        ),
      ).toEqual(["tx:1"]);
      expect(suggestionsCoveringBill(ctx(), a.connection.id, "b9")).toEqual([]);
      expect(
        findSuggestion(ctx(), a.connection.id, "cost", "tx:2")?.billRefsJson,
      ).toEqual(["b3"]);
    });
  });

  describe("privacy between household members", () => {
    it("lists only the caller's own suggestions", async () => {
      const a = await owner("Anna");
      const b = await owner("Ben");
      record(a, { providerRef: "tx:a1" });
      record(a, { providerRef: "tx:a2" });
      record(b, {
        providerRef: "tx:b1",
        payload: costPayload({ title: "Bens Ausgabe" }),
      });
      const mine = listSuggestions(
        ctx(),
        a.user.id,
        { status: "pending" },
        { limit: 50 },
      );
      expect(mine.items.map((s) => s.providerRef).sort()).toEqual([
        "tx:a1",
        "tx:a2",
      ]);
      const his = listSuggestions(
        ctx(),
        b.user.id,
        { status: "pending" },
        { limit: 50 },
      );
      expect(his.items).toHaveLength(1);
      expect(JSON.stringify(mine)).not.toContain("Bens Ausgabe");
      const nobody = await createTestUser();
      expect(
        listSuggestions(ctx(), nobody.id, { status: "pending" }, { limit: 50 })
          .items,
      ).toEqual([]);
    });

    it("answers 404 for another person's suggestion on read, accept and dismiss", async () => {
      const a = await owner("Anna");
      const b = await owner("Ben");
      const { row } = record(a);
      expect(() => getOwnSuggestion(ctx(), b.user.id, row.id)).toThrow(
        /not found/i,
      );
      await expect(
        acceptSuggestion(ctx(), b.user.id, row.id, {}),
      ).rejects.toThrow(/not found/i);
      expect(() => dismissSuggestion(ctx(), b.user.id, row.id)).toThrow(
        /not found/i,
      );
      // untouched
      expect(getOwnSuggestion(ctx(), a.user.id, row.id).status).toBe("pending");
      expect(test.db.select().from(costEntries).all()).toHaveLength(0);
      // the same answer as for an id that does not exist
      expect(() => getOwnSuggestion(ctx(), b.user.id, "no-such-id")).toThrow(
        /not found/i,
      );
    });
  });

  describe("listing", () => {
    it("filters by kind and status and pages", async () => {
      const a = await owner();
      for (let i = 0; i < 5; i++) record(a, { providerRef: `tx:${i}` });
      record(a, {
        kind: "asset",
        providerRef: "tx:0",
        payload: {
          name: "Herd",
          purchaseDate: "2026-03-10",
          priceMinor: 100000,
          currency: "CHF",
          url: null,
        },
      });
      const first = record(a, { providerRef: "tx:x" });
      dismissSuggestion(ctx(), a.user.id, first.row.id);
      const costs = listSuggestions(
        ctx(),
        a.user.id,
        { kind: "cost", status: "pending" },
        { limit: 50 },
      );
      expect(costs.items).toHaveLength(5);
      expect(
        listSuggestions(
          ctx(),
          a.user.id,
          { kind: "asset", status: "pending" },
          { limit: 50 },
        ).items,
      ).toHaveLength(1);
      expect(
        listSuggestions(
          ctx(),
          a.user.id,
          { status: "dismissed" },
          { limit: 50 },
        ).items,
      ).toHaveLength(1);
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 10; i++) {
        const page = listSuggestions(
          ctx(),
          a.user.id,
          { status: "pending" },
          { limit: 2, cursor },
        );
        seen.push(...page.items.map((s) => s.id));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      expect(new Set(seen).size).toBe(6);
    });
  });

  describe("accepting a cost", () => {
    it("books it: paid by the owner, split by ownership, remembering where it came from", async () => {
      const a = await owner();
      const { row } = record(a);
      const result = await acceptSuggestion(ctx(), a.user.id, row.id, {});
      expect(result.entity.type).toBe("cost");
      expect(result.row).toMatchObject({
        status: "accepted",
        acceptedEntityId: result.entity.id,
      });
      const cost = getCost(ctx(), result.entity.id);
      expect(cost).toMatchObject({
        title: "Reparatur",
        amountMinor: 12050,
        currency: "CHF",
        category: "repair",
        date: "2026-03-10",
        payee: "Beispiel AG",
        paidByUserId: a.user.id,
        splitMode: "ownership",
        source: "finance_transaction",
        providerConnectionId: a.connection.id,
        providerRef: "tx:1",
        providerUrl: "https://finance.example.org/tx/1",
        createdBy: a.user.id,
        linkSyncedAt: null,
      });
    });

    it("takes the overrides of the body", async () => {
      const a = await owner();
      const other = await createTestUser({ displayName: "Ben" });
      const { row } = record(a);
      const result = await acceptSuggestion(ctx(), a.user.id, row.id, {
        title: "Spülmaschine",
        category: "maintenance",
        notes: "Pumpe",
        paidByUserId: other.id,
        splitMode: "equal",
        deductible: "maintenance",
        countsAsExpense: false,
      });
      expect(getCost(ctx(), result.entity.id)).toMatchObject({
        title: "Spülmaschine",
        category: "maintenance",
        notes: "Pumpe",
        paidByUserId: other.id,
        splitMode: "equal",
        deductible: "maintenance",
        countsAsExpense: false,
        // what is the transaction's stays
        amountMinor: 12050,
        date: "2026-03-10",
      });
    });

    it("books a bill-sourced cost with the bill as its origin", async () => {
      const a = await owner();
      const { row } = record(a, {
        providerRef: "bill:b1",
        payload: costPayload({ source: "finance_bill" }),
      });
      const result = await acceptSuggestion(ctx(), a.user.id, row.id, {});
      expect(getCost(ctx(), result.entity.id)).toMatchObject({
        source: "finance_bill",
        providerRef: "bill:b1",
      });
    });

    it("books a refund as a negative amount", async () => {
      const a = await owner();
      const { row } = record(a, {
        payload: costPayload({ amountMinor: -3000 }),
      });
      const result = await acceptSuggestion(ctx(), a.user.id, row.id, {});
      expect(getCost(ctx(), result.entity.id).amountMinor).toBe(-3000);
    });

    it("refuses to accept twice, or a dismissed suggestion, and books once", async () => {
      const a = await owner();
      const { row } = record(a);
      await acceptSuggestion(ctx(), a.user.id, row.id, {});
      await expect(
        acceptSuggestion(ctx(), a.user.id, row.id, {}),
      ).rejects.toThrow(/accepted already/);
      const second = record(a, { providerRef: "tx:2" });
      dismissSuggestion(ctx(), a.user.id, second.row.id);
      await expect(
        acceptSuggestion(ctx(), a.user.id, second.row.id, {}),
      ).rejects.toThrow(/dismissed/);
      expect(test.db.select().from(costEntries).all()).toHaveLength(1);
    });

    it("rolls everything back when the entry cannot be booked", async () => {
      const a = await owner();
      const { row } = record(a);
      await expect(
        acceptSuggestion(ctx(), a.user.id, row.id, {
          assetId: "does-not-exist",
        }),
      ).rejects.toThrow();
      expect(getOwnSuggestion(ctx(), a.user.id, row.id).status).toBe("pending");
      expect(test.db.select().from(costEntries).all()).toHaveLength(0);
    });

    it("rejects overrides that belong to another kind", async () => {
      const a = await owner();
      const { row } = record(a);
      await expect(
        acceptSuggestion(ctx(), a.user.id, row.id, { name: "x" }),
      ).rejects.toThrow();
      await expect(
        acceptSuggestion(ctx(), a.user.id, row.id, { assetKind: "plant" }),
      ).rejects.toThrow();
    });
  });

  describe("accepting an asset", () => {
    const assetPayload = {
      name: "Geschirrspüler",
      purchaseDate: "2026-02-01",
      priceMinor: 89900,
      currency: "CHF",
      url: null,
    };

    it("creates the asset with its purchase date and an external reference", async () => {
      const a = await owner();
      const { row } = record(a, { kind: "asset", payload: assetPayload });
      const result = await acceptSuggestion(ctx(), a.user.id, row.id, {
        assetKind: "device",
        name: "Miele G7000",
      });
      expect(result.entity.type).toBe("asset");
      const asset = test.db
        .select()
        .from(assets)
        .where(eq(assets.id, result.entity.id))
        .get()!;
      expect(asset).toMatchObject({
        name: "Miele G7000",
        kind: "device",
        purchaseDate: "2026-02-01",
        externalSource: FINANCE_ASSET_SOURCE,
        externalRef: `${a.connection.id}:tx:1`,
      });
      expect(result.row.status).toBe("accepted");
    });

    it("offers the new asset to the cost of the same transaction", async () => {
      const a = await owner();
      const cost = record(a);
      const asset = record(a, { kind: "asset", payload: assetPayload });
      const result = await acceptSuggestion(ctx(), a.user.id, asset.row.id, {});
      expect(
        getOwnSuggestion(ctx(), a.user.id, cost.row.id).payloadJson,
      ).toMatchObject({
        assetId: result.entity.id,
      });
      const booked = await acceptSuggestion(ctx(), a.user.id, cost.row.id, {});
      expect(getCost(ctx(), booked.entity.id)).toMatchObject({
        assetId: result.entity.id,
        assetName: "Geschirrspüler",
      });
    });

    it("links a cost that was booked before the asset", async () => {
      const a = await owner();
      const cost = record(a);
      const booked = await acceptSuggestion(ctx(), a.user.id, cost.row.id, {});
      expect(getCost(ctx(), booked.entity.id).assetId).toBeNull();
      const asset = record(a, { kind: "asset", payload: assetPayload });
      const result = await acceptSuggestion(ctx(), a.user.id, asset.row.id, {});
      const after = getCost(ctx(), booked.entity.id);
      expect(after.assetId).toBe(result.entity.id);
      // the entry's back-link is refreshed with the asset's name
      expect(after.linkSyncedAt).toBeNull();
    });

    it("does not touch the asset of a cost that has one", async () => {
      const a = await owner();
      const cost = record(a);
      const booked = await acceptSuggestion(ctx(), a.user.id, cost.row.id, {});
      const first = record(a, { kind: "asset", payload: assetPayload });
      const asset1 = await acceptSuggestion(ctx(), a.user.id, first.row.id, {});
      expect(getCost(ctx(), booked.entity.id).assetId).toBe(asset1.entity.id);
      const second = record(a, {
        kind: "asset",
        providerRef: "tx:1b",
        payload: assetPayload,
      });
      // another transaction: unrelated to that cost
      await acceptSuggestion(ctx(), a.user.id, second.row.id, {});
      expect(getCost(ctx(), booked.entity.id).assetId).toBe(asset1.entity.id);
    });

    it("rejects overrides that belong to a cost", async () => {
      const a = await owner();
      const { row } = record(a, { kind: "asset", payload: assetPayload });
      await expect(
        acceptSuggestion(ctx(), a.user.id, row.id, { category: "repair" }),
      ).rejects.toThrow();
    });
  });

  describe("accepting a bill task", () => {
    it("creates the task for the person, due on the bill's date", async () => {
      const a = await owner();
      const { row } = record(a, {
        kind: "bill_task",
        providerRef: "b-42",
        payload: {
          title: "Muster Verwaltung AG: INV-1",
          dueDate: "2026-07-01",
          amountMinor: 45000,
          currency: "CHF",
          url: "https://finance.example.org/bills/b-42",
        },
      });
      const result = await acceptSuggestion(ctx(), a.user.id, row.id, {});
      expect(result.entity.type).toBe("task");
      const { getTask } = await import("$lib/server/tasks/tasks");
      const task = getTask(ctx(), result.entity.id);
      expect(task).toMatchObject({
        title: "Muster Verwaltung AG: INV-1",
        category: "payment",
        assigneeUserId: a.user.id,
        externalSource: "finance_bill",
        externalRef: `${a.connection.id}:b-42`,
        source: "kept",
      });
      expect(task.trigger).toMatchObject({
        type: "kept_bill",
        billId: "b-42",
        dueDate: "2026-07-01",
      });
    });
  });

  describe("dismissing", () => {
    it("is idempotent, and refused for an accepted one", async () => {
      const a = await owner();
      const { row } = record(a);
      expect(dismissSuggestion(ctx(), a.user.id, row.id).status).toBe(
        "dismissed",
      );
      expect(dismissSuggestion(ctx(), a.user.id, row.id).status).toBe(
        "dismissed",
      );
      const second = record(a, { providerRef: "tx:2" });
      await acceptSuggestion(ctx(), a.user.id, second.row.id, {});
      expect(() => dismissSuggestion(ctx(), a.user.id, second.row.id)).toThrow(
        /accepted already/,
      );
    });
  });

  it("disappear with the connection and with nothing else", async () => {
    const a = await owner();
    const b = await owner("Ben");
    record(a);
    record(b);
    test.db
      .delete(connections)
      .where(eq(connections.id, a.connection.id))
      .run();
    const rest = test.db.select().from(financeSuggestions).all();
    expect(rest).toHaveLength(1);
    expect(rest[0].userId).toBe(b.user.id);
  });
});
