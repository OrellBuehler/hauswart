import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import {
  createCostRequestSchema,
  updateCostRequestSchema,
} from "$lib/api/schemas/costs";
import { createDefectRequestSchema } from "$lib/api/schemas/defects";
import { createServiceLogRequestSchema } from "$lib/api/schemas/service-log";
import { createRoomRequestSchema } from "$lib/api/schemas/rooms";
import { createAsset } from "$lib/server/assets/assets";
import { createComment } from "$lib/server/comments/comments";
import { createDefect, getDefectDetail } from "$lib/server/defects/defects";
import {
  comments,
  costEntries,
  costEntryShares,
  costLinkRemovals,
  users,
} from "$lib/server/db";
import { createRoom } from "$lib/server/rooms/rooms";
import { createEntry, getEntry } from "$lib/server/service-log/service-log";
import { createTestUser } from "$lib/testing/auth";
import { ctxAt, NOW } from "$lib/testing/domain";
import { useTestDB } from "$lib/testing/db";
import {
  createCost,
  deleteCost,
  getCost,
  listCosts,
  updateCost,
} from "./costs";

type Create = Partial<Parameters<typeof createCostRequestSchema.parse>[0]> &
  Record<string, unknown>;

describe("costs service", () => {
  const test = useTestDB();
  const ctx = () => ctxAt(test.db);

  const input = (over: Create = {}) =>
    createCostRequestSchema.parse({
      title: "Reparatur Geschirrspüler",
      amountMinor: 12050,
      category: "repair",
      date: "2026-03-10",
      ...over,
    });

  async function twoUsers(ownership: [number, number] = [5000, 5000]) {
    const a = await createTestUser({ displayName: "Anna" });
    const b = await createTestUser({ displayName: "Ben" });
    test.db
      .update(users)
      .set({ ownershipBps: ownership[0] })
      .where(eq(users.id, a.id))
      .run();
    test.db
      .update(users)
      .set({ ownershipBps: ownership[1] })
      .where(eq(users.id, b.id))
      .run();
    return { a, b };
  }

  describe("create", () => {
    it("fills in today, the household currency, an ownership split and the expense default", async () => {
      const { a, b } = await twoUsers([7000, 3000]);
      const c = createCost(
        ctx(),
        createCostRequestSchema.parse({
          title: "Dachrinne",
          amountMinor: 10001,
          category: "maintenance",
        }),
        a.id,
      );
      expect(c).toMatchObject({
        date: "2026-06-15",
        currency: "CHF",
        splitMode: "ownership",
        countsAsExpense: true,
        deductible: "unknown",
        source: "manual",
        paidByUserId: null,
        createdBy: a.id,
      });
      const byUser = Object.fromEntries(
        c.shares.map((s) => [s.userId, s.amountMinor]),
      );
      expect(byUser[a.id]).toBe(7001);
      expect(byUser[b.id]).toBe(3000);
      expect(c.shares.reduce((x, s) => x + s.amountMinor, 0)).toBe(10001);
      expect(c.shares.map((s) => s.userName).sort()).toEqual(["Anna", "Ben"]);
    });

    it("does not count a mortgage repayment as an expense unless told", async () => {
      await twoUsers();
      expect(
        createCost(ctx(), input({ category: "mortgage_principal" }), null)
          .countsAsExpense,
      ).toBe(false);
      expect(
        createCost(
          ctx(),
          input({ category: "mortgage_principal", countsAsExpense: true }),
          null,
        ).countsAsExpense,
      ).toBe(true);
      expect(
        createCost(ctx(), input({ category: "mortgage_interest" }), null)
          .countsAsExpense,
      ).toBe(true);
    });

    it("counts fuel as an expense", async () => {
      await twoUsers();
      expect(
        createCost(ctx(), input({ category: "fuel" }), null).countsAsExpense,
      ).toBe(true);
    });

    it("stores a refund as a negative amount and splits it like the expense", async () => {
      const { a, b } = await twoUsers();
      const refund = createCost(ctx(), input({ amountMinor: -1001 }), a.id);
      expect(refund.amountMinor).toBe(-1001);
      expect(refund.shares.map((s) => s.amountMinor)).toEqual([-501, -500]);
      expect(b.id).toBeTruthy();
    });

    it("does not split with mode none and keeps the amount whole", async () => {
      await twoUsers();
      const c = createCost(ctx(), input({ splitMode: "none" }), null);
      expect(c.splitMode).toBe("none");
      expect(c.shares).toEqual([]);
    });

    it("splits equally whatever the ownership", async () => {
      const { a } = await twoUsers([9000, 1000]);
      const c = createCost(ctx(), input({ splitMode: "equal" }), a.id);
      expect(c.shares.map((s) => s.shareBps)).toEqual([5000, 5000]);
    });

    it("accepts explicit shares that add up to 100% and rejects the rest", async () => {
      const { a, b } = await twoUsers();
      const ok = createCost(
        ctx(),
        input({
          splitMode: "custom",
          shares: [
            { userId: a.id, shareBps: 2500 },
            { userId: b.id, shareBps: 7500 },
          ],
        }),
        a.id,
      );
      // 9037.5 and 3012.5: the odd unit goes to the person who sorts first by id
      const bShare = ok.shares.find((s) => s.userId === b.id)?.amountMinor;
      expect([9037, 9038]).toContain(bShare);
      expect(ok.shares.reduce((x, s) => x + s.amountMinor, 0)).toBe(12050);

      const bad = (shares: unknown, splitMode: string = "custom") =>
        expect(() =>
          createCost(ctx(), input({ splitMode, shares } as Create), a.id),
        ).toThrow();
      bad([{ userId: a.id, shareBps: 5000 }]);
      bad([
        { userId: a.id, shareBps: 5000 },
        { userId: a.id, shareBps: 5000 },
      ]);
      bad([
        { userId: a.id, shareBps: 5000 },
        { userId: "nobody", shareBps: 5000 },
      ]);
      bad(undefined);
      bad([{ userId: a.id, shareBps: 10000 }], "ownership");
    });

    it("freezes the split: later ownership changes do not rewrite it", async () => {
      const { a, b } = await twoUsers([5000, 5000]);
      const c = createCost(ctx(), input({ amountMinor: 10000 }), a.id);
      test.db
        .update(users)
        .set({ ownershipBps: 9000 })
        .where(eq(users.id, a.id))
        .run();
      test.db
        .update(users)
        .set({ ownershipBps: 1000 })
        .where(eq(users.id, b.id))
        .run();
      expect(getCost(ctx(), c.id).shares.map((s) => s.amountMinor)).toEqual([
        5000, 5000,
      ]);
      // splitting again takes the new shares
      const again = updateCost(
        ctx(),
        c.id,
        updateCostRequestSchema.parse({ splitMode: "ownership" }),
      );
      expect(
        Object.fromEntries(again.shares.map((s) => [s.userId, s.amountMinor])),
      ).toEqual({ [a.id]: 9000, [b.id]: 1000 });
    });

    it("rejects references that do not exist", async () => {
      await twoUsers();
      for (const bad of [
        { assetId: "nope" },
        { roomId: "nope" },
        { defectId: "nope" },
        { serviceLogId: "nope" },
        { paidByUserId: "nope" },
      ]) {
        expect(() => createCost(ctx(), input(bad), null)).toThrow();
      }
    });

    it("takes asset and room from the linked service log entry or defect", async () => {
      const a = await createTestUser();
      const room = createRoom(
        ctx(),
        createRoomRequestSchema.parse({ name: "Küche" }),
      );
      const asset = createAsset(
        ctx(),
        createAssetRequestSchema.parse({
          kind: "device",
          name: "Geschirrspüler",
          roomId: room.id,
        }),
      );
      const log = createEntry(
        ctx(),
        asset.id,
        createServiceLogRequestSchema.parse({ title: "Pumpe ersetzt" }),
        a.id,
      );
      const viaLog = createCost(ctx(), input({ serviceLogId: log.id }), a.id);
      expect(viaLog).toMatchObject({
        assetId: asset.id,
        assetName: "Geschirrspüler",
        serviceLogTitle: "Pumpe ersetzt",
      });
      const defect = await createDefect(
        ctx(),
        createDefectRequestSchema.parse({
          title: "Wasserschaden",
          roomId: room.id,
          assetId: asset.id,
          discoveredOn: "2026-06-01",
        }),
        a.id,
      );
      const viaDefect = createCost(ctx(), input({ defectId: defect.id }), a.id);
      expect(viaDefect).toMatchObject({
        roomId: room.id,
        assetId: asset.id,
        defectNumber: defect.number,
        defectTitle: "Wasserschaden",
      });
      // an explicit asset wins
      const other = createAsset(
        ctx(),
        createAssetRequestSchema.parse({ kind: "device", name: "Herd" }),
      );
      expect(
        createCost(
          ctx(),
          input({ serviceLogId: log.id, assetId: other.id }),
          a.id,
        ).assetId,
      ).toBe(other.id);
    });

    it("refuses to book one provider item twice", async () => {
      const a = await createTestUser();
      const connection = await connectionFor(a.id);
      const origin = {
        source: "finance_transaction" as const,
        connectionId: connection,
        ref: "tx:1",
        url: null,
      };
      createCost(ctx(), input(), a.id, origin);
      expect(() => createCost(ctx(), input(), a.id, origin)).toThrow(
        /already booked/,
      );
      // another connection may use the same reference
      const other = await connectionFor((await createTestUser()).id);
      expect(
        createCost(ctx(), input(), a.id, { ...origin, connectionId: other }),
      ).toBeTruthy();
    });
  });

  describe("update", () => {
    it("changes fields, keeps the frozen shares when only the amount changes", async () => {
      const { a } = await twoUsers();
      const c = createCost(ctx(), input({ amountMinor: 1000 }), a.id);
      const u = updateCost(
        ctx(),
        c.id,
        updateCostRequestSchema.parse({
          amountMinor: 1001,
          title: "Neu",
          payee: "Beispiel AG",
          notes: "Beleg im Ordner",
          paidByUserId: a.id,
          deductible: "maintenance",
        }),
      );
      expect(u).toMatchObject({
        amountMinor: 1001,
        title: "Neu",
        payee: "Beispiel AG",
        notes: "Beleg im Ordner",
        paidByUserId: a.id,
        paidByName: "Anna",
        deductible: "maintenance",
      });
      expect(u.shares.reduce((x, s) => x + s.amountMinor, 0)).toBe(1001);
      // nullable fields clear
      expect(
        updateCost(
          ctx(),
          c.id,
          updateCostRequestSchema.parse({
            payee: "",
            notes: null,
            paidByUserId: null,
          }),
        ),
      ).toMatchObject({ payee: null, notes: null, paidByUserId: null });
    });

    it("needs custom shares to change to custom, and only allows shares for custom", async () => {
      const { a, b } = await twoUsers();
      const c = createCost(ctx(), input(), a.id);
      expect(() =>
        updateCost(
          ctx(),
          c.id,
          updateCostRequestSchema.parse({ splitMode: "custom" }),
        ),
      ).toThrow();
      expect(() =>
        updateCost(
          ctx(),
          c.id,
          updateCostRequestSchema.parse({
            shares: [{ userId: a.id, shareBps: 10000 }],
          }),
        ),
      ).toThrow();
      const custom = updateCost(
        ctx(),
        c.id,
        updateCostRequestSchema.parse({
          splitMode: "custom",
          shares: [
            { userId: a.id, shareBps: 3000 },
            { userId: b.id, shareBps: 7000 },
          ],
        }),
      );
      expect(custom.splitMode).toBe("custom");
      // staying custom without new shares keeps them
      expect(
        updateCost(
          ctx(),
          c.id,
          updateCostRequestSchema.parse({ splitMode: "custom" }),
        ).shares.length,
      ).toBe(2);
      // none removes the shares
      expect(
        updateCost(
          ctx(),
          c.id,
          updateCostRequestSchema.parse({ splitMode: "none" }),
        ).shares,
      ).toEqual([]);
    });

    it("follows the category's expense default unless the person overrode it", async () => {
      await twoUsers();
      const c = createCost(ctx(), input(), null);
      expect(
        updateCost(
          ctx(),
          c.id,
          updateCostRequestSchema.parse({ category: "mortgage_principal" }),
        ).countsAsExpense,
      ).toBe(false);
      const manual = createCost(ctx(), input({ countsAsExpense: false }), null);
      expect(
        updateCost(
          ctx(),
          manual.id,
          updateCostRequestSchema.parse({ category: "maintenance" }),
        ).countsAsExpense,
      ).toBe(false);
    });

    it("404s for an unknown entry", () => {
      expect(() =>
        updateCost(
          ctx(),
          "nope",
          updateCostRequestSchema.parse({ title: "x" }),
        ),
      ).toThrow(/not found/i);
    });
  });

  describe("delete", () => {
    it("removes the entry, its shares and its comments", async () => {
      const { a } = await twoUsers();
      const c = createCost(ctx(), input(), a.id);
      await createComment(ctx(), { id: a.id, role: "member" } as never, {
        entityType: "cost",
        entityId: c.id,
        bodyMd: "Beleg liegt vor",
      });
      expect(test.db.select().from(comments).all()).toHaveLength(1);
      deleteCost(ctx(), c.id);
      expect(test.db.select().from(costEntries).all()).toHaveLength(0);
      expect(test.db.select().from(costEntryShares).all()).toHaveLength(0);
      expect(test.db.select().from(comments).all()).toHaveLength(0);
      expect(() => getCost(ctx(), c.id)).toThrow(/not found/i);
    });

    it("queues the removal of a back-link that was written", async () => {
      const a = await createTestUser();
      const connection = await connectionFor(a.id);
      const c = createCost(ctx(), input(), a.id, {
        source: "finance_transaction",
        connectionId: connection,
        ref: "tx:9",
        url: null,
      });
      test.db
        .update(costEntries)
        .set({ providerLinkId: "link-1", linkSyncedAt: new Date(NOW) })
        .where(eq(costEntries.id, c.id))
        .run();
      deleteCost(ctx(), c.id);
      expect(test.db.select().from(costLinkRemovals).all()).toMatchObject([
        { connectionId: connection, linkId: "link-1" },
      ]);
    });

    it("queues nothing when no link was written, or for a manual entry", async () => {
      const a = await createTestUser();
      const connection = await connectionFor(a.id);
      const c = createCost(ctx(), input(), a.id, {
        source: "finance_bill",
        connectionId: connection,
        ref: "bill:9",
        url: null,
      });
      deleteCost(ctx(), c.id);
      deleteCost(ctx(), createCost(ctx(), input(), a.id).id);
      expect(test.db.select().from(costLinkRemovals).all()).toHaveLength(0);
    });

    it("keeps the entries of a deleted defect, unlinked", async () => {
      const a = await createTestUser();
      const defect = await createDefect(
        ctx(),
        createDefectRequestSchema.parse({
          title: "Riss",
          discoveredOn: "2026-06-01",
        }),
        a.id,
      );
      const c = createCost(ctx(), input({ defectId: defect.id }), a.id);
      const { deleteDefect } = await import("$lib/server/defects/defects");
      await deleteDefect(ctx(), defect.id);
      expect(getCost(ctx(), c.id)).toMatchObject({
        defectId: null,
        defectTitle: null,
      });
    });
  });

  describe("totals on defects and service log entries", () => {
    it("sums the booked costs, nets refunds off and leaves other currencies out", async () => {
      const a = await createTestUser();
      const asset = createAsset(
        ctx(),
        createAssetRequestSchema.parse({ kind: "device", name: "Heizung" }),
      );
      const log = createEntry(
        ctx(),
        asset.id,
        createServiceLogRequestSchema.parse({ title: "Service" }),
        a.id,
      );
      const defect = await createDefect(
        ctx(),
        createDefectRequestSchema.parse({
          title: "Leck",
          discoveredOn: "2026-06-01",
        }),
        a.id,
      );
      expect(getEntry(ctx(), log.id).costs).toEqual({
        totalMinor: 0,
        count: 0,
      });
      expect(getDefectDetail(ctx(), defect.id).costs).toEqual({
        totalMinor: 0,
        count: 0,
      });
      createCost(
        ctx(),
        input({ serviceLogId: log.id, amountMinor: 20000 }),
        a.id,
      );
      createCost(
        ctx(),
        input({ serviceLogId: log.id, amountMinor: -2500 }),
        a.id,
      );
      createCost(
        ctx(),
        input({ serviceLogId: log.id, amountMinor: 9999, currency: "EUR" }),
        a.id,
      );
      createCost(
        ctx(),
        input({ defectId: defect.id, amountMinor: 4000 }),
        a.id,
      );
      expect(getEntry(ctx(), log.id).costs).toEqual({
        totalMinor: 17500,
        count: 3,
      });
      expect(getDefectDetail(ctx(), defect.id).costs).toEqual({
        totalMinor: 4000,
        count: 1,
      });
    });
  });

  describe("list", () => {
    async function seed() {
      const { a, b } = await twoUsers();
      const room = createRoom(
        ctx(),
        createRoomRequestSchema.parse({ name: "Bad" }),
      );
      const rows = [
        {
          title: "Januar Nebenkosten",
          date: "2026-01-31",
          category: "utilities",
          amountMinor: 30000,
          paidByUserId: a.id,
        },
        {
          title: "Silikon 100% dicht_",
          date: "2026-02-10",
          category: "maintenance",
          amountMinor: 1500,
          paidByUserId: b.id,
          roomId: room.id,
        },
        {
          title: "Versicherung",
          date: "2025-12-31",
          category: "insurance",
          amountMinor: 80000,
          payee: "Beispiel Versicherung",
        },
        {
          title: "Neuer Wasserhahn",
          date: "2026-02-10",
          category: "purchase",
          amountMinor: 9900,
          notes: "Garantie 2 Jahre",
          paidByUserId: a.id,
        },
      ].map((r) => createCost(ctx(), input(r as Create), a.id));
      return { a, b, room, rows };
    }
    const all = (
      filter = {},
      page = { limit: 50 } as { cursor?: string; limit: number },
      viewer = "x",
    ) => listCosts(ctx(), filter, page, viewer);

    it("lists newest first by date, then entry order", async () => {
      await seed();
      expect(all().items.map((c) => c.title)).toEqual([
        "Neuer Wasserhahn",
        "Silikon 100% dicht_",
        "Januar Nebenkosten",
        "Versicherung",
      ]);
    });

    it("filters by year, range, category, room, payer and text", async () => {
      const { a, room } = await seed();
      const titles = (f: object, viewer = a.id) =>
        all(f, { limit: 50 }, viewer)
          .items.map((c) => c.title)
          .sort();
      expect(titles({ year: 2025 })).toEqual(["Versicherung"]);
      expect(titles({ year: 2026 })).toHaveLength(3);
      expect(titles({ from: "2026-02-01", to: "2026-02-28" })).toEqual([
        "Neuer Wasserhahn",
        "Silikon 100% dicht_",
      ]);
      expect(titles({ category: "utilities" })).toEqual(["Januar Nebenkosten"]);
      expect(titles({ roomId: room.id })).toEqual(["Silikon 100% dicht_"]);
      expect(titles({ paidBy: a.id })).toEqual([
        "Januar Nebenkosten",
        "Neuer Wasserhahn",
      ]);
      expect(titles({ paidBy: "me" })).toEqual([
        "Januar Nebenkosten",
        "Neuer Wasserhahn",
      ]);
      expect(titles({ q: "garantie" })).toEqual(["Neuer Wasserhahn"]);
      expect(titles({ q: "beispiel versicherung" })).toEqual(["Versicherung"]);
      // LIKE wildcards are plain text
      expect(titles({ q: "100% dicht_" })).toEqual(["Silikon 100% dicht_"]);
      expect(titles({ q: "%" })).toEqual(["Silikon 100% dicht_"]);
      expect(titles({ q: "_" })).toEqual(["Silikon 100% dicht_"]);
    });

    it("pages with a cursor without skipping or repeating entries on the same day", async () => {
      await seed();
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 10; i++) {
        const page = all({}, { limit: 1, cursor });
        seen.push(...page.items.map((c) => c.title));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      expect(seen).toEqual(all().items.map((c) => c.title));
      expect(new Set(seen).size).toBe(4);
    });

    it("rejects a forged cursor", async () => {
      await seed();
      expect(() => all({}, { limit: 5, cursor: "garbage" })).toThrow();
    });
  });
});

async function connectionFor(userId: string): Promise<string> {
  const { saveConnection } =
    await import("$lib/server/connections/connections");
  const { getDB } = await import("$lib/server/db");
  return saveConnection({ db: getDB(), now: NOW }, "kept", userId, {
    baseUrl: "https://finance.example.org",
    token: "kept_example-token",
    allowInsecureTls: false,
  }).id;
}
