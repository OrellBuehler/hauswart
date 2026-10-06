import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assets,
  connections,
  costEntries,
  costLinkRemovals,
  financeSuggestions,
  financeSyncState,
  taskCompletions,
  tasks,
} from "$lib/server/db";
import type { Minor } from "$lib/money";
import { getConnectionRow } from "$lib/server/connections/connections";
import { deleteCost, getCost, updateCost } from "$lib/server/costs/costs";
import {
  acceptSuggestion,
  dismissSuggestion,
  listSuggestions,
  type SuggestionRow,
} from "$lib/server/finance/suggestions";
import { getTask } from "$lib/server/tasks/tasks";
import { createTestUser } from "$lib/testing/auth";
import { ctxAt, NOW } from "$lib/testing/domain";
import { useTestDB } from "$lib/testing/db";
import { fakeBill, fakeTransaction } from "./fake-server";
import { syncConnection } from "./sync";
import { useFakeKept } from "./testing";

const ORIGIN = "https://hauswart.example.org";
const DAY = 86_400_000;

describe("Kept sync", () => {
  const test = useTestDB();
  const { fake, connect } = useFakeKept();
  const ctx = (now = NOW) => ctxAt(test.db, now);
  let previousOrigin: string | undefined;
  beforeEach(() => {
    previousOrigin = process.env.ORIGIN;
    process.env.ORIGIN = ORIGIN;
  });
  afterEach(() => {
    if (previousOrigin === undefined) delete process.env.ORIGIN;
    else process.env.ORIGIN = previousOrigin;
    vi.restoreAllMocks();
  });

  const CONFIG = {
    categoryMap: { "cat-repair": "repair", "cat-utilities": "utilities" },
  };

  async function setup(
    config: Record<string, unknown> = CONFIG,
    name = "Anna",
  ) {
    const user = await createTestUser({ displayName: name });
    const connection = connect(user.id, { config });
    return { user, connection };
  }
  const run = (userId: string, now = NOW) =>
    syncConnection(ctx(now), getConnectionRow(ctx(), "kept", userId)!);
  const pending = (userId: string, kind?: "cost" | "asset" | "bill_task") =>
    listSuggestions(ctx(), userId, { kind, status: "pending" }, { limit: 200 })
      .items;
  const payload = (s: SuggestionRow) =>
    s.payloadJson as Record<string, unknown>;
  const tx = (over: Parameters<typeof fakeTransaction>[0] = {}) =>
    fakeTransaction({ categoryId: "cat-repair", ...over });

  describe("transactions", () => {
    it("offers transactions of mapped categories as cost suggestions", async () => {
      const { user } = await setup();
      fake.transactions = [
        tx({
          id: "t1",
          amount: -12050,
          description: "Rechnung Sanitär",
          counterpartyName: "Muster Sanitär AG",
          bookingDate: "2026-05-12",
        }),
        tx({ id: "t2", categoryId: "cat-other", amount: -999 }),
        tx({ id: "t3", categoryId: null }),
        tx({ id: "t4", amount: 3000, description: "Rückerstattung" }),
        tx({ id: "t5", amount: 0 }),
        tx({
          id: "t6",
          categoryId: "cat-utilities",
          amount: -8800,
          description: null,
          counterpartyName: "Beispiel Energie",
        }),
      ];
      const result = await run(user.id);
      expect(result).toMatchObject({
        ok: true,
        stats: { suggestions: 3, autoAccepted: 0 },
      });
      const rows = pending(user.id, "cost");
      const by = Object.fromEntries(
        rows.map((r) => [r.providerRef, payload(r)]),
      );
      expect(Object.keys(by).sort()).toEqual(["tx:t1", "tx:t4", "tx:t6"]);
      expect(by["tx:t1"]).toEqual({
        source: "finance_transaction",
        date: "2026-05-12",
        amountMinor: 12050,
        currency: "CHF",
        title: "Rechnung Sanitär",
        payee: "Muster Sanitär AG",
        category: "repair",
        url: "https://kept.example.org/accounts/acc-0001?tx=t1",
        assetId: null,
      });
      // a refund is a negative expense
      expect(by["tx:t4"]).toMatchObject({
        amountMinor: -3000,
        title: "Rückerstattung",
      });
      // without a description the payee is the title
      expect(by["tx:t6"]).toMatchObject({
        category: "utilities",
        title: "Beispiel Energie",
      });
      expect(rows.every((r) => r.userId === user.id)).toBe(true);
    });

    it("reads only what is mapped, since the start date, and sends the token as a bearer", async () => {
      const { user } = await setup({
        categoryMap: { "cat-repair": "repair" },
        purchaseCategoryIds: ["cat-home"],
        syncFrom: "2026-03-01",
      });
      fake.transactions = [
        tx({ id: "old", bookingDate: "2026-02-28" }),
        tx({ id: "new", bookingDate: "2026-03-01" }),
        tx({ id: "other", categoryId: "cat-other" }),
      ];
      await run(user.id);
      expect(pending(user.id, "cost").map((r) => r.providerRef)).toEqual([
        "tx:new",
      ]);
      const reads = fake.requestsTo("/transactions", "GET");
      expect(reads.map((r) => r.query.get("categoryId")).sort()).toEqual([
        "cat-home",
        "cat-repair",
      ]);
      expect(reads.every((r) => r.query.get("from") === "2026-03-01")).toBe(
        true,
      );
      expect(reads[0].headers.get("authorization")).toBe(
        `Bearer ${fake.token}`,
      );
      expect(fake.requestsTo("/bills")).toEqual([]);
    });

    it("starts at the first of January of the current year by default", async () => {
      const { user } = await setup();
      await run(user.id);
      expect(fake.requestsTo("/transactions")[0].query.get("from")).toBe(
        "2026-01-01",
      );
    });

    it("does nothing with an empty category map", async () => {
      const { user } = await setup({});
      expect(await run(user.id)).toMatchObject({ ok: true });
      expect(fake.requests).toEqual([]);
    });

    it("reads only what changed afterwards and updates pending suggestions", async () => {
      const { user } = await setup();
      fake.transactions = [
        tx({
          id: "t1",
          description: "Alt",
          updatedAt: "2026-05-01T10:00:00.000Z",
        }),
      ];
      await run(user.id);
      const state = test.db.select().from(financeSyncState).get()!;
      expect(state.transactionsSince).toBe("2026-05-01T10:00:00.000Z");

      fake.requests = [];
      fake.transactions = [
        tx({
          id: "t1",
          description: "Neu",
          updatedAt: "2026-05-02T10:00:00.000Z",
        }),
        tx({ id: "t2", updatedAt: "2026-05-03T10:00:00.000Z" }),
      ];
      const second = await run(user.id);
      expect(
        fake.requestsTo("/transactions")[0].query.get("updatedSince"),
      ).toBe("2026-05-01T10:00:00.000Z");
      expect(second.stats.suggestions).toBe(1);
      const rows = pending(user.id, "cost");
      expect(rows).toHaveLength(2);
      expect(payload(rows.find((r) => r.providerRef === "tx:t1")!).title).toBe(
        "Neu",
      );

      // nothing changed: nothing new, the same cursor
      const third = await run(user.id);
      expect(third.stats.suggestions).toBe(0);
      expect(pending(user.id, "cost")).toHaveLength(2);
    });

    it("never offers a dismissed transaction again, even when it changes", async () => {
      const { user } = await setup();
      fake.transactions = [
        tx({
          id: "t1",
          description: "Alt",
          updatedAt: "2026-05-01T10:00:00.000Z",
        }),
      ];
      await run(user.id);
      dismissSuggestion(ctx(), user.id, pending(user.id)[0].id);
      fake.transactions = [
        tx({
          id: "t1",
          description: "Geändert",
          updatedAt: "2026-05-09T10:00:00.000Z",
        }),
      ];
      await run(user.id);
      expect(pending(user.id)).toEqual([]);
      const all = test.db.select().from(financeSuggestions).all();
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({ status: "dismissed" });
      expect(payload(all[0]).title).toBe("Alt");
    });

    it("starts over for a category added later (the cursor belongs to its scope)", async () => {
      const { user } = await setup({ categoryMap: { "cat-repair": "repair" } });
      fake.transactions = [
        tx({ id: "t1", updatedAt: "2026-05-10T10:00:00.000Z" }),
        tx({
          id: "u1",
          categoryId: "cat-utilities",
          updatedAt: "2026-04-01T10:00:00.000Z",
        }),
      ];
      await run(user.id);
      expect(pending(user.id).map((r) => r.providerRef)).toEqual(["tx:t1"]);
      connect(user.id, { config: CONFIG });
      fake.requests = [];
      await run(user.id);
      expect(
        fake
          .requestsTo("/transactions")
          .every((r) => r.query.get("updatedSince") === null),
      ).toBe(true);
      expect(
        pending(user.id)
          .map((r) => r.providerRef)
          .sort(),
      ).toEqual(["tx:t1", "tx:u1"]);
    });

    it("pages through everything", async () => {
      const { user } = await setup();
      fake.transactions = Array.from({ length: 230 }, (_, i) =>
        tx({ id: `t${i}`, bookingDate: "2026-05-01" }),
      );
      const result = await run(user.id);
      expect(result.stats.suggestions).toBe(230);
      expect(fake.requestsTo("/transactions").length).toBeGreaterThan(2);
    });
  });

  describe("automatic booking", () => {
    it("books transactions of automatic categories without asking, paid by the owner", async () => {
      const { user } = await setup({
        ...CONFIG,
        autoAcceptCategoryIds: ["cat-utilities"],
      });
      fake.transactions = [
        tx({ id: "t1", amount: -5000 }),
        tx({
          id: "t2",
          categoryId: "cat-utilities",
          amount: -8800,
          description: "Nebenkosten",
        }),
      ];
      const result = await run(user.id);
      expect(result.stats).toMatchObject({ suggestions: 1, autoAccepted: 1 });
      expect(pending(user.id).map((r) => r.providerRef)).toEqual(["tx:t1"]);
      const entries = test.db.select().from(costEntries).all();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        title: "Nebenkosten",
        category: "utilities",
        amountMinor: 8800,
        paidByUserId: user.id,
        splitMode: "ownership",
        source: "finance_transaction",
        providerRef: "tx:t2",
        createdBy: user.id,
      });
      const accepted = test.db
        .select()
        .from(financeSuggestions)
        .where(eq(financeSuggestions.status, "accepted"))
        .all();
      expect(accepted).toHaveLength(1);
      expect(accepted[0].acceptedEntityId).toBe(entries[0].id);

      // a second run books nothing again
      await run(user.id);
      expect(test.db.select().from(costEntries).all()).toHaveLength(1);
    });

    it("books an automatic transaction once even when the cost is deleted", async () => {
      const { user } = await setup({
        ...CONFIG,
        autoAcceptCategoryIds: ["cat-repair"],
      });
      fake.transactions = [tx({ id: "t1" })];
      await run(user.id);
      const entry = test.db.select().from(costEntries).get()!;
      deleteCost(ctx(), entry.id);
      fake.transactions = [
        tx({ id: "t1", updatedAt: "2026-09-30T10:00:00.000Z" }),
      ];
      await run(user.id);
      expect(test.db.select().from(costEntries).all()).toHaveLength(0);
    });

    it("keeps an automatic transaction in the inbox when booking fails, and retries", async () => {
      const { user } = await setup({
        ...CONFIG,
        autoAcceptCategoryIds: ["cat-repair"],
      });
      fake.transactions = [tx({ id: "t1" })];
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      // an entry for the same item exists already (booked another way): booking again conflicts
      test.db
        .insert(costEntries)
        .values({
          date: "2026-05-01",
          title: "schon da",
          amountMinor: 1 as Minor,
          currency: "CHF",
          category: "repair",
          providerConnectionId: getConnectionRow(ctx(), "kept", user.id)!.id,
          providerRef: "tx:t1",
        })
        .run();
      const result = await run(user.id);
      expect(result.ok).toBe(false);
      expect(pending(user.id).map((r) => r.providerRef)).toEqual(["tx:t1"]);
      expect(JSON.stringify(spy.mock.calls)).not.toContain("schon da");
      // the cursor did not move, so it is read again next time
      expect(
        test.db.select().from(financeSyncState).get()?.transactionsSince ??
          null,
      ).toBeNull();
    });
  });

  describe("purchases", () => {
    const CFG = { ...CONFIG, purchaseCategoryIds: ["cat-home"] };

    it("offers a large outgoing payment in a purchase category as an asset", async () => {
      const { user } = await setup(CFG);
      fake.transactions = [
        tx({
          id: "p1",
          categoryId: "cat-home",
          amount: -89900,
          description: "Geschirrspüler G7000",
          bookingDate: "2026-02-01",
        }),
        tx({
          id: "p2",
          categoryId: "cat-home",
          amount: -4900,
          description: "Kabel",
        }),
        tx({
          id: "p3",
          categoryId: "cat-home",
          amount: 20000,
          description: "Rückerstattung",
        }),
        tx({
          id: "p4",
          categoryId: "cat-home",
          amount: -50000,
          description: null,
          counterpartyName: null,
        }),
      ];
      const result = await run(user.id);
      expect(result.stats.assetSuggestions).toBe(1);
      const rows = pending(user.id, "asset");
      expect(rows).toHaveLength(1);
      expect(payload(rows[0])).toEqual({
        name: "Geschirrspüler G7000",
        purchaseDate: "2026-02-01",
        priceMinor: 89900,
        currency: "CHF",
        url: "https://kept.example.org/accounts/acc-0001?tx=p1",
      });
      // the category is not mapped, so no cost is offered
      expect(pending(user.id, "cost")).toEqual([]);
      const accepted = await acceptSuggestion(ctx(), user.id, rows[0].id, {
        name: "Miele Geschirrspüler",
      });
      expect(
        test.db
          .select()
          .from(assets)
          .where(eq(assets.id, accepted.entity.id))
          .get(),
      ).toMatchObject({
        name: "Miele Geschirrspüler",
        purchaseDate: "2026-02-01",
      });
    });

    it("offers both a cost and an asset for a mapped purchase category, and ties them together", async () => {
      const { user } = await setup({
        categoryMap: { "cat-home": "purchase" },
        purchaseCategoryIds: ["cat-home"],
      });
      fake.transactions = [
        tx({
          id: "p1",
          categoryId: "cat-home",
          amount: -89900,
          description: "Backofen",
        }),
      ];
      await run(user.id);
      const [cost] = pending(user.id, "cost");
      const [asset] = pending(user.id, "asset");
      const created = await acceptSuggestion(ctx(), user.id, asset.id, {});
      const booked = await acceptSuggestion(ctx(), user.id, cost.id, {});
      expect(getCost(ctx(), booked.entity.id)).toMatchObject({
        category: "purchase",
        assetId: created.entity.id,
        assetName: "Backofen",
      });
    });
  });

  describe("bills", () => {
    const BILLS = { ...CONFIG, billTasks: true };
    const billTasks = () => test.db.select().from(tasks).all();

    it("makes a task of an open bill, for its owner, due on the due date", async () => {
      const { user, connection } = await setup(BILLS);
      fake.bills = [
        fakeBill({
          id: "b1",
          creditorName: "Muster Verwaltung AG",
          invoiceNumber: "INV-7",
          amount: 45000,
          remainingAmount: 45000,
          dueDate: "2026-07-01",
        }),
      ];
      const result = await run(user.id);
      expect(result.stats.tasksCreated).toBe(1);
      const [task] = billTasks();
      expect(getTask(ctx(), task.id)).toMatchObject({
        title: "Muster Verwaltung AG: INV-7",
        category: "payment",
        assigneeUserId: user.id,
        assignMode: "fixed",
        source: "kept",
        externalSource: "finance_bill",
        externalRef: `${connection.id}:b1`,
        externalUrl: "https://kept.example.org/bills/b1",
        trigger: {
          type: "kept_bill",
          billId: "b1",
          dueDate: "2026-07-01",
          status: "open",
        },
      });
      expect(task.descriptionMd).toContain("450.00");
      expect(fake.requestsTo("/bills", "GET")[0].query.get("status")).toBe(
        "open,overdue",
      );
      // a second run changes nothing
      expect((await run(user.id)).stats).toMatchObject({
        tasksCreated: 0,
        tasksUpdated: 0,
      });
      expect(billTasks()).toHaveLength(1);
    });

    it("shows what is still to pay of a partly paid bill and goes overdue", async () => {
      const { user } = await setup(BILLS);
      fake.bills = [
        fakeBill({
          id: "b1",
          status: "partially_paid",
          amount: 45000,
          paidAmount: 20000,
          remainingAmount: 25000,
          dueDate: "2026-06-01",
          overdue: true,
        }),
      ];
      await run(user.id);
      const [task] = billTasks();
      expect(task.descriptionMd).toContain("250.00");
      expect(task.trigger).toMatchObject({ status: "overdue" });
      expect(getTask(ctx(), task.id).state).toMatchObject({
        status: "overdue",
        reasons: expect.arrayContaining(["bill_overdue"]),
      });
    });

    it("only follows bills of the listed creditors (case-insensitive)", async () => {
      const { user } = await setup({
        ...BILLS,
        billCreditorFilter: ["muster verwaltung ag"],
      });
      fake.bills = [
        fakeBill({ id: "b1", creditorName: "Muster Verwaltung AG" }),
        fakeBill({ id: "b2", creditorName: "Beispiel Energie AG" }),
        fakeBill({ id: "b3", creditorName: null }),
      ];
      await run(user.id);
      expect(billTasks().map((t) => t.externalRef!.split(":")[1])).toEqual([
        "b1",
      ]);
    });

    it("skips bills without a due date and credit notes", async () => {
      const { user } = await setup(BILLS);
      fake.bills = [
        fakeBill({ id: "b1", dueDate: null }),
        fakeBill({
          id: "b2",
          kind: "credit_note",
          status: "credit_due",
          amount: 5000,
        }),
      ];
      const result = await run(user.id);
      expect(billTasks()).toHaveLength(0);
      expect(result.stats.skipped).toBe(1);
    });

    it("reads no bills unless the person switched bill tasks on", async () => {
      const { user } = await setup(CONFIG);
      fake.bills = [fakeBill({ id: "b1" })];
      await run(user.id);
      expect(billTasks()).toHaveLength(0);
      expect(fake.requestsTo("/bills")).toEqual([]);
    });

    it("completes the task when the bill is paid", async () => {
      const { user } = await setup(BILLS);
      fake.bills = [fakeBill({ id: "b1" })];
      await run(user.id);
      const [task] = billTasks();
      fake.bills = [
        fakeBill({
          id: "b1",
          status: "paid",
          paidAmount: 12345,
          remainingAmount: 0,
          lastPaymentDate: "2026-06-20",
        }),
      ];
      const result = await run(user.id);
      expect(result.stats.tasksCompleted).toBe(1);
      const completions = test.db
        .select()
        .from(taskCompletions)
        .where(eq(taskCompletions.taskId, task.id))
        .all();
      expect(completions).toHaveLength(1);
      expect(completions[0]).toMatchObject({
        source: "kept",
        kind: "done",
        userId: null,
        revokedAt: null,
      });
      expect(getTask(ctx(), task.id)).toMatchObject({
        archivedAt: null,
        trigger: { status: "paid" },
        state: { status: "ok" },
      });
      // the next run does not ask about it again, nor complete twice
      fake.requests = [];
      await run(user.id);
      expect(fake.requestsTo("/bills/b1")).toEqual([]);
      expect(test.db.select().from(taskCompletions).all()).toHaveLength(1);
    });

    it("settles the task of a cancelled bill", async () => {
      const { user } = await setup(BILLS);
      fake.bills = [fakeBill({ id: "b1" })];
      await run(user.id);
      fake.bills = [fakeBill({ id: "b1", status: "cancelled" })];
      await run(user.id);
      const [task] = billTasks();
      expect(task.trigger).toMatchObject({ status: "cancelled" });
      expect(getTask(ctx(), task.id).state).toMatchObject({
        status: "ok",
        reasons: ["completed", "bill_cancelled"],
      });
    });

    it("opens the task again when a paid bill becomes payable again", async () => {
      const { user } = await setup(BILLS);
      fake.bills = [fakeBill({ id: "b1" })];
      await run(user.id);
      fake.bills = [fakeBill({ id: "b1", status: "paid", remainingAmount: 0 })];
      await run(user.id);
      fake.bills = [fakeBill({ id: "b1" })];
      const result = await run(user.id);
      expect(result.stats.tasksReopened).toBe(1);
      const [task] = billTasks();
      expect(task.trigger).toMatchObject({ status: "open" });
      expect(getTask(ctx(), task.id).state?.reasons).not.toContain("completed");
    });

    it("archives the task of a bill Kept no longer knows", async () => {
      const { user } = await setup(BILLS);
      fake.bills = [fakeBill({ id: "b1" }), fakeBill({ id: "b2" })];
      await run(user.id);
      fake.bills = [fakeBill({ id: "b2" })];
      const result = await run(user.id);
      expect(result.stats.tasksArchived).toBe(1);
      const byRef = Object.fromEntries(
        billTasks().map((t) => [t.externalRef!.split(":")[1], t.archivedAt]),
      );
      expect(byRef.b1).not.toBeNull();
      expect(byRef.b2).toBeNull();
    });

    it("does not touch a task somebody archived, and does not read the bill again for it", async () => {
      const { user } = await setup(BILLS);
      fake.bills = [fakeBill({ id: "b1" })];
      await run(user.id);
      const [task] = billTasks();
      test.db
        .update(tasks)
        .set({ archivedAt: new Date(NOW) })
        .where(eq(tasks.id, task.id))
        .run();
      fake.bills = [fakeBill({ id: "b1", dueDate: "2026-12-01" })];
      await run(user.id);
      expect(billTasks()).toHaveLength(1);
      expect(billTasks()[0].trigger).toMatchObject({ dueDate: "2026-10-01" });
    });

    it("keeps the failure of the bills part from stopping the rest, and reports it", async () => {
      const { user } = await setup(BILLS);
      fake.setToken({
        scopes: ["transactions:read", "links:write", "categories:read"],
      });
      fake.transactions = [tx({ id: "t1" })];
      vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await run(user.id);
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
      expect(pending(user.id)).toHaveLength(1);
      expect(getConnectionRow(ctx(), "kept", user.id)).toMatchObject({
        status: "error",
        lastError: "forbidden",
        consecutiveFailures: 1,
      });
    });

    it("does not archive anything when the list of open bills could not be read completely", async () => {
      const { user } = await setup(BILLS);
      fake.bills = [fakeBill({ id: "b1" })];
      await run(user.id);
      fake.bills = [];
      fake.failNext("/bills", 401);
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect((await run(user.id)).ok).toBe(false);
      expect(billTasks()[0].archivedAt).toBeNull();
    });
  });

  describe("payments of bills are booked once", () => {
    const CFG = { ...CONFIG, billCostCategory: "utilities" as const };

    it("offers a paid invoice as a cost when no mapped transaction covers it", async () => {
      const { user } = await setup(CFG);
      fake.bills = [
        fakeBill({
          id: "b1",
          status: "paid",
          creditorName: "Beispiel Energie AG",
          invoiceNumber: "E-55",
          amount: 33000,
          remainingAmount: 0,
          lastPaymentDate: "2026-04-20",
        }),
        fakeBill({ id: "b2" }),
        fakeBill({
          id: "b3",
          kind: "credit_note",
          status: "paid",
          amount: 1000,
        }),
      ];
      await run(user.id);
      const rows = pending(user.id, "cost");
      expect(rows.map((r) => r.providerRef)).toEqual(["bill:b1"]);
      expect(payload(rows[0])).toMatchObject({
        source: "finance_bill",
        date: "2026-04-20",
        amountMinor: 33000,
        title: "Beispiel Energie AG: E-55",
        payee: "Beispiel Energie AG",
        category: "utilities",
      });
      const booked = await acceptSuggestion(ctx(), user.id, rows[0].id, {});
      expect(getCost(ctx(), booked.entity.id)).toMatchObject({
        source: "finance_bill",
        providerRef: "bill:b1",
      });
    });

    it("does not offer the bill when the transaction that pays it is offered", async () => {
      const { user } = await setup(CFG);
      fake.bills = [
        fakeBill({
          id: "b1",
          status: "paid",
          amount: 33000,
          remainingAmount: 0,
          lastPaymentDate: "2026-04-20",
        }),
      ];
      fake.transactions = [
        tx({
          id: "t1",
          categoryId: "cat-utilities",
          amount: -33000,
          billIds: ["b1"],
        }),
      ];
      await run(user.id);
      expect(pending(user.id, "cost").map((r) => r.providerRef)).toEqual([
        "tx:t1",
      ]);
    });

    it("withdraws a pending offer made from the bill when its transaction shows up", async () => {
      const { user } = await setup(CFG);
      fake.bills = [
        fakeBill({
          id: "b1",
          status: "paid",
          amount: 33000,
          remainingAmount: 0,
          lastPaymentDate: "2026-04-20",
        }),
      ];
      await run(user.id);
      expect(pending(user.id, "cost").map((r) => r.providerRef)).toEqual([
        "bill:b1",
      ]);
      fake.transactions = [
        tx({
          id: "t1",
          categoryId: "cat-utilities",
          amount: -33000,
          billIds: ["b1"],
          updatedAt: "2026-09-21T10:00:00.000Z",
        }),
      ];
      await run(user.id);
      expect(pending(user.id, "cost").map((r) => r.providerRef)).toEqual([
        "tx:t1",
      ]);
      expect(test.db.select().from(financeSuggestions).all()).toHaveLength(
        2 - 1,
      );
    });

    it("books the payment once when the bill was decided first", async () => {
      const { user } = await setup(CFG);
      fake.bills = [
        fakeBill({
          id: "b1",
          status: "paid",
          amount: 33000,
          remainingAmount: 0,
          lastPaymentDate: "2026-04-20",
        }),
      ];
      await run(user.id);
      await acceptSuggestion(ctx(), user.id, pending(user.id)[0].id, {});
      fake.transactions = [
        tx({
          id: "t1",
          categoryId: "cat-utilities",
          amount: -33000,
          billIds: ["b1"],
        }),
      ];
      const result = await run(user.id);
      expect(pending(user.id)).toEqual([]);
      expect(result.stats.skipped).toBe(1);
      expect(test.db.select().from(costEntries).all()).toHaveLength(1);
    });

    it("books the payment once when the bill was dismissed", async () => {
      const { user } = await setup(CFG);
      fake.bills = [
        fakeBill({
          id: "b1",
          status: "paid",
          amount: 33000,
          remainingAmount: 0,
          lastPaymentDate: "2026-04-20",
        }),
      ];
      await run(user.id);
      dismissSuggestion(ctx(), user.id, pending(user.id)[0].id);
      fake.transactions = [
        tx({
          id: "t1",
          categoryId: "cat-utilities",
          amount: -33000,
          billIds: ["b1"],
        }),
      ];
      await run(user.id);
      expect(pending(user.id)).toEqual([]);
    });

    it("does not offer a bill twice and only reads paid bills that changed", async () => {
      const { user } = await setup(CFG);
      fake.bills = [
        fakeBill({
          id: "b1",
          status: "paid",
          amount: 33000,
          remainingAmount: 0,
          lastPaymentDate: "2026-04-20",
          updatedAt: "2026-04-21T10:00:00.000Z",
        }),
      ];
      await run(user.id);
      fake.requests = [];
      const second = await run(user.id);
      expect(second.stats.suggestions).toBe(0);
      expect(pending(user.id)).toHaveLength(1);
      const paid = fake
        .requestsTo("/bills", "GET")
        .find((r) => r.query.get("status") === "paid")!;
      expect(paid.query.get("updatedSince")).toBe("2026-04-21T10:00:00.000Z");
    });

    it("ignores paid bills when no category is set for them", async () => {
      const { user } = await setup(CONFIG);
      fake.bills = [
        fakeBill({
          id: "b1",
          status: "paid",
          amount: 33000,
          remainingAmount: 0,
        }),
      ];
      await run(user.id);
      expect(pending(user.id)).toEqual([]);
    });
  });

  describe("links back to the apartment", () => {
    async function booked(config: Record<string, unknown> = CONFIG, over = {}) {
      const { user, connection } = await setup(config);
      fake.transactions = [
        tx({ id: "t1", description: "Pumpe ersetzt", ...over }),
      ];
      await run(user.id);
      const accepted = await acceptSuggestion(
        ctx(),
        user.id,
        pending(user.id)[0].id,
        {},
      );
      return { user, connection, costId: accepted.entity.id };
    }

    it("writes a link on the transaction once the cost is booked", async () => {
      const { user, costId } = await booked();
      const result = await run(user.id);
      expect(result.stats.linksWritten).toBe(1);
      expect(fake.links).toHaveLength(1);
      expect(fake.links[0]).toMatchObject({
        entityType: "transaction",
        entityId: "t1",
        source: "hauswart",
        label: "Pumpe ersetzt",
        url: `${ORIGIN}/costs/${costId}`,
      });
      const entry = getCost(ctx(), costId);
      expect(entry.linkSyncedAt).not.toBeNull();
      expect(test.db.select().from(costEntries).get()?.providerLinkId).toBe(
        fake.links[0].id,
      );
      // nothing more to do the next time
      fake.requests = [];
      await run(user.id);
      expect(fake.requestsTo("/transactions/t1/links", "POST")).toEqual([]);
    });

    it("does not look like an edit: the entry's change time stays", async () => {
      const { user, costId } = await booked();
      const before = getCost(ctx(), costId).updatedAt.getTime();
      await run(user.id);
      expect(getCost(ctx(), costId).updatedAt.getTime()).toBe(before);
    });

    it("puts the asset's name in the label and refreshes it when the entry changes", async () => {
      const { user, costId } = await booked();
      await run(user.id);
      const { createAsset } = await import("$lib/server/assets/assets");
      const { createAssetRequestSchema } =
        await import("$lib/api/schemas/assets");
      const asset = createAsset(
        ctx(),
        createAssetRequestSchema.parse({
          kind: "device",
          name: "Geschirrspüler",
        }),
      );
      const { updateCostRequestSchema } =
        await import("$lib/api/schemas/costs");
      updateCost(
        ctx(),
        costId,
        updateCostRequestSchema.parse({
          assetId: asset.id,
          title: "Pumpe neu",
        }),
      );
      expect(getCost(ctx(), costId).linkSyncedAt).toBeNull();
      const result = await run(user.id);
      expect(result.stats.linksWritten).toBe(1);
      // the same link, with a fresh label
      expect(fake.links).toHaveLength(1);
      expect(fake.links[0].label).toBe("Pumpe neu (Geschirrspüler)");
      // a change that does not show in the link needs no call
      updateCost(
        ctx(),
        costId,
        updateCostRequestSchema.parse({ notes: "Beleg im Ordner" }),
      );
      fake.requests = [];
      await run(user.id);
      expect(fake.requestsTo("/transactions/t1/links", "POST")).toEqual([]);
    });

    it("writes the link of a bill-sourced cost on the bill", async () => {
      const { user } = await setup({
        ...CONFIG,
        billCostCategory: "utilities",
      });
      fake.bills = [
        fakeBill({
          id: "b1",
          status: "paid",
          amount: 33000,
          remainingAmount: 0,
          lastPaymentDate: "2026-04-20",
        }),
      ];
      await run(user.id);
      const accepted = await acceptSuggestion(
        ctx(),
        user.id,
        pending(user.id)[0].id,
        {},
      );
      await run(user.id);
      expect(fake.links).toHaveLength(1);
      expect(fake.links[0]).toMatchObject({
        entityType: "bill",
        entityId: "b1",
        url: `${ORIGIN}/costs/${accepted.entity.id}`,
      });
    });

    it("removes the link when the cost is deleted", async () => {
      const { user, costId } = await booked();
      await run(user.id);
      deleteCost(ctx(), costId);
      expect(test.db.select().from(costLinkRemovals).all()).toHaveLength(1);
      const result = await run(user.id);
      expect(result.stats.linksRemoved).toBe(1);
      expect(fake.links).toEqual([]);
      expect(test.db.select().from(costLinkRemovals).all()).toEqual([]);
      expect(fake.requestsTo("/links/", "DELETE")).toHaveLength(1);
    });

    it("writes nothing for a cost that was deleted before its link was written", async () => {
      const { user, costId } = await booked();
      deleteCost(ctx(), costId);
      await run(user.id);
      expect(fake.links).toEqual([]);
      expect(fake.requestsTo("/transactions/t1/links", "POST")).toEqual([]);
    });

    it("retries a link that could not be written, by code in the log and without losing it", async () => {
      const { user, costId } = await booked();
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      fake.failNext("/transactions/t1/links", 500, { method: "POST" });
      const failed = await run(user.id);
      expect(failed).toMatchObject({
        ok: false,
        error: { code: "server" },
        stats: { linksFailed: 1 },
      });
      expect(getCost(ctx(), costId).linkSyncedAt).toBeNull();
      expect(fake.links).toEqual([]);
      const logged = spy.mock.calls.flat().join("\n");
      expect(logged).toContain("kept.link_failed");
      expect(logged).toContain('"code":"server"');
      expect(logged).not.toContain("Pumpe");
      expect(logged).not.toContain(fake.token);
      expect(getConnectionRow(ctx(), "kept", user.id)).toMatchObject({
        status: "error",
        lastError: "server",
      });

      const retried = await run(user.id);
      expect(retried).toMatchObject({ ok: true, stats: { linksWritten: 1 } });
      expect(fake.links).toHaveLength(1);
      expect(getCost(ctx(), costId).linkSyncedAt).not.toBeNull();
      expect(getConnectionRow(ctx(), "kept", user.id)).toMatchObject({
        status: "ok",
        consecutiveFailures: 0,
      });
    });

    it("retries the removal of a link that could not be deleted", async () => {
      const { user, costId } = await booked();
      await run(user.id);
      deleteCost(ctx(), costId);
      vi.spyOn(console, "error").mockImplementation(() => {});
      fake.failNext("/links/", 500, { method: "DELETE" });
      const failed = await run(user.id);
      expect(failed.ok).toBe(false);
      expect(fake.links).toHaveLength(1);
      expect(test.db.select().from(costLinkRemovals).all()).toHaveLength(1);
      const retried = await run(user.id);
      expect(retried.ok).toBe(true);
      expect(fake.links).toEqual([]);
      expect(test.db.select().from(costLinkRemovals).all()).toEqual([]);
    });

    it("treats a link Kept does not have any more as removed", async () => {
      const { user, costId } = await booked();
      await run(user.id);
      fake.links = [];
      deleteCost(ctx(), costId);
      expect((await run(user.id)).ok).toBe(true);
      expect(test.db.select().from(costLinkRemovals).all()).toEqual([]);
    });

    it("gives up on an item Kept does not know, instead of retrying forever", async () => {
      const { user, costId } = await booked();
      fake.transactions = [];
      vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await run(user.id);
      expect(result.stats.linksFailed).toBe(1);
      expect(getCost(ctx(), costId).linkSyncedAt).not.toBeNull();
      fake.requests = [];
      await run(user.id);
      expect(fake.requestsTo("/transactions/t1/links", "POST")).toEqual([]);
    });

    it("keeps the entry for later when the app's address is not known", async () => {
      const { user, costId } = await booked();
      delete process.env.ORIGIN;
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await run(user.id);
      expect(result.ok).toBe(true);
      expect(fake.requestsTo("/transactions/t1/links")).toEqual([]);
      expect(getCost(ctx(), costId).linkSyncedAt).toBeNull();
      process.env.ORIGIN = ORIGIN;
      await run(user.id);
      expect(fake.links).toHaveLength(1);
    });

    it("needs the permission to write links: a missing one is reported, not hidden", async () => {
      const { user, costId } = await booked();
      fake.setToken({
        scopes: ["transactions:read", "bills:read", "categories:read"],
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await run(user.id);
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
      expect(getCost(ctx(), costId).linkSyncedAt).toBeNull();
    });

    it("keeps the link of a cost that was edited while its link was being written current", async () => {
      const { user, costId } = await booked();
      const { updateCostRequestSchema } =
        await import("$lib/api/schemas/costs");
      fake.delayMs = 40;
      const running = run(user.id);
      await new Promise((r) => setTimeout(r, 15));
      updateCost(
        ctx(),
        costId,
        updateCostRequestSchema.parse({ title: "Anders" }),
      );
      await running;
      fake.delayMs = 0;
      await run(user.id);
      expect(fake.links).toHaveLength(1);
      expect(fake.links[0].label).toBe("Anders");
    });
  });

  describe("health and failure", () => {
    it("records a rejected token as the connection's status and recovers", async () => {
      const { user } = await setup();
      fake.transactions = [tx({ id: "t1" })];
      vi.spyOn(console, "error").mockImplementation(() => {});
      connect(user.id, { token: "kept_wrong-token" });
      const failed = await run(user.id);
      expect(failed).toMatchObject({
        ok: false,
        error: { code: "unauthorized" },
      });
      expect(failed.error?.message).not.toContain("kept_wrong-token");
      expect(getConnectionRow(ctx(), "kept", user.id)).toMatchObject({
        status: "error",
        lastError: "unauthorized",
        consecutiveFailures: 1,
      });
      connect(user.id, { token: fake.token });
      expect((await run(user.id)).ok).toBe(true);
      expect(getConnectionRow(ctx(), "kept", user.id)).toMatchObject({
        status: "ok",
        lastError: null,
        consecutiveFailures: 0,
      });
    });

    it("does not leave the cursor behind a failed read", async () => {
      const { user } = await setup();
      fake.transactions = [
        tx({ id: "t1", updatedAt: "2026-05-01T10:00:00.000Z" }),
      ];
      vi.spyOn(console, "error").mockImplementation(() => {});
      fake.failNext("/transactions", 401);
      expect((await run(user.id)).ok).toBe(false);
      expect(
        test.db.select().from(financeSyncState).get()?.transactionsSince ??
          null,
      ).toBeNull();
      await run(user.id);
      expect(pending(user.id)).toHaveLength(1);
    });

    it("rejects a malformed answer by name, without keeping part of it", async () => {
      const { user } = await setup();
      fake.replyNext("/transactions", {
        status: 200,
        body: JSON.stringify({ items: [{ id: "t1" }], nextCursor: null }),
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await run(user.id);
      expect(result).toMatchObject({
        ok: false,
        error: { code: "invalid_response" },
      });
      expect(pending(user.id)).toEqual([]);
    });

    it("answers for an unreadable token without calling Kept", async () => {
      const { user, connection } = await setup();
      test.db
        .update(connections)
        .set({ tokenEnc: "garbage" })
        .where(eq(connections.id, connection.id))
        .run();
      vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await run(user.id);
      expect(result).toMatchObject({
        ok: false,
        error: { code: "token_unreadable" },
      });
      expect(fake.requests).toEqual([]);
    });

    it("shares one run between concurrent requests", async () => {
      const { user } = await setup();
      fake.transactions = [tx({ id: "t1" })];
      fake.delayMs = 20;
      const [a, b] = await Promise.all([run(user.id), run(user.id)]);
      expect(a).toBe(b);
      // one read per mapped category, not per caller
      expect(fake.requestsTo("/transactions", "GET")).toHaveLength(2);
    });
  });

  describe("privacy between household members", () => {
    it("keeps two people's suggestions, tasks and links apart, even for the same ids", async () => {
      const anna = await setup({ ...CONFIG, billTasks: true }, "Anna");
      fake.transactions = [tx({ id: "t1", description: "Annas Reparatur" })];
      fake.bills = [fakeBill({ id: "b1", invoiceNumber: "A-1" })];
      await run(anna.user.id);

      // Ben connects to another account that happens to use the same ids
      const other = await createTestUser({ displayName: "Ben" });
      connect(other.id, { config: { ...CONFIG, billTasks: true } });
      fake.transactions = [tx({ id: "t1", description: "Bens Reparatur" })];
      fake.bills = [fakeBill({ id: "b1", invoiceNumber: "B-1" })];
      await run(other.id);

      expect(pending(anna.user.id).map((r) => payload(r).title)).toEqual([
        "Annas Reparatur",
      ]);
      expect(pending(other.id).map((r) => payload(r).title)).toEqual([
        "Bens Reparatur",
      ]);
      const taskTitles = test.db
        .select()
        .from(tasks)
        .all()
        .map((t) => [t.title.split(": ")[1], t.assigneeUserId]);
      expect(taskTitles).toEqual(
        expect.arrayContaining([
          ["A-1", anna.user.id],
          ["B-1", other.id],
        ]),
      );
      // Ben books his; Anna's remains hers and unbooked
      await acceptSuggestion(ctx(), other.id, pending(other.id)[0].id, {});
      expect(pending(anna.user.id)).toHaveLength(1);
      expect(test.db.select().from(costEntries).all()).toHaveLength(1);
      await run(other.id);
      expect(fake.links).toHaveLength(1);
      expect(fake.links[0].label).toBe("Bens Reparatur");
    });

    it("a person's run reads and changes nothing of somebody else's connection", async () => {
      const anna = await setup(CONFIG, "Anna");
      const ben = await setup(CONFIG, "Ben");
      fake.transactions = [tx({ id: "t1" })];
      await run(ben.user.id);
      expect(pending(anna.user.id)).toEqual([]);
      expect(getConnectionRow(ctx(), "kept", anna.user.id)).toMatchObject({
        status: "unknown",
      });
      expect(
        test.db
          .select()
          .from(financeSyncState)
          .all()
          .map((s) => s.connectionId),
      ).toEqual([ben.connection.id]);
    });
  });

  it("lets the number of days pass without surprises (clock injection)", async () => {
    const { user } = await setup(CONFIG);
    fake.transactions = [tx({ id: "t1", bookingDate: "2026-12-30" })];
    expect((await run(user.id, NOW + 200 * DAY)).ok).toBe(true);
    // next year's default start date
    fake.requests = [];
    await run(user.id, NOW + 400 * DAY);
    expect(fake.requestsTo("/transactions")[0].query.get("from")).toBe(
      "2027-01-01",
    );
  });
});
