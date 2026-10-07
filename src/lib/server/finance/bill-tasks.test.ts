import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { taskCompletions, tasks } from "$lib/server/db";
import {
  saveConnection,
  deleteConnection,
} from "$lib/server/connections/connections";
import { completeTask } from "$lib/server/tasks/completions";
import { updateTask, getTask } from "$lib/server/tasks/tasks";
import { createTestUser } from "$lib/testing/auth";
import { ctxAt, NOW } from "$lib/testing/domain";
import { useTestDB } from "$lib/testing/db";
import {
  FINANCE_BILL_SOURCE,
  FINISHED_BILL_TASK_DAYS,
  activeBillTasks,
  archiveSettledBillTasks,
  upsertFinanceBillTask,
  type BillTaskInput,
} from "./bill-tasks";

const DAY = 86_400_000;

describe("tasks that follow bills", () => {
  const test = useTestDB();
  const ctx = (now = NOW) => ctxAt(test.db, now);

  async function setup() {
    const user = await createTestUser({ displayName: "Anna" });
    const connection = saveConnection(ctx(), "kept", user.id, {
      baseUrl: "https://finance.example.org",
      token: "kept_example-token",
      allowInsecureTls: false,
    });
    const bill = (over: Partial<BillTaskInput> = {}): BillTaskInput => ({
      connectionId: connection.id,
      kind: "kept",
      ownerId: user.id,
      billId: "b1",
      title: "Muster Verwaltung AG: INV-1",
      dueDate: "2026-07-01",
      status: "open",
      amountMinor: 45000,
      currency: "CHF",
      url: "https://finance.example.org/bills/b1",
      ...over,
    });
    return { user, connection, bill };
  }

  it("creates a payment task for the owner, due on the bill's date", async () => {
    const { user, connection, bill } = await setup();
    const result = await upsertFinanceBillTask(ctx(), bill());
    expect(result.outcome).toBe("created");
    const task = getTask(ctx(), result.taskId!);
    expect(task).toMatchObject({
      title: "Muster Verwaltung AG: INV-1",
      category: "payment",
      assignMode: "fixed",
      assigneeUserId: user.id,
      notifyMode: "assignee",
      source: "kept",
      externalSource: FINANCE_BILL_SOURCE,
      externalRef: `${connection.id}:b1`,
      externalUrl: "https://finance.example.org/bills/b1",
      trigger: {
        v: 1,
        type: "kept_bill",
        billId: "b1",
        dueDate: "2026-07-01",
        status: "open",
      },
    });
    expect(task.state).toMatchObject({
      dueDate: "2026-07-01",
      dueKind: "deadline",
    });
    // creditor, amount and due date: nothing more
    expect(task.descriptionMd).toContain("CHF");
    expect(task.descriptionMd).toContain("2026-07-01");
    expect(task.descriptionMd).toContain("450.00");
  });

  it("does nothing for an unchanged bill and updates what changed", async () => {
    const { bill } = await setup();
    const first = await upsertFinanceBillTask(ctx(), bill());
    expect((await upsertFinanceBillTask(ctx(), bill())).outcome).toBe(
      "unchanged",
    );
    const changed = await upsertFinanceBillTask(
      ctx(),
      bill({ dueDate: "2026-07-15", amountMinor: 30000 }),
    );
    expect(changed).toEqual({ outcome: "updated", taskId: first.taskId });
    expect(getTask(ctx(), first.taskId!)).toMatchObject({
      trigger: { dueDate: "2026-07-15" },
      state: { dueDate: "2026-07-15" },
    });
    expect(getTask(ctx(), first.taskId!).descriptionMd).toContain("300.00");
  });

  it("goes overdue with the bill", async () => {
    const { bill } = await setup();
    const { taskId } = await upsertFinanceBillTask(
      ctx(NOW + 30 * DAY),
      bill({ dueDate: "2026-06-20", status: "overdue" }),
    );
    expect(getTask(ctx(NOW + 30 * DAY), taskId!).state).toMatchObject({
      status: "overdue",
    });
  });

  it("completes the task when the bill is paid, attributed to the provider", async () => {
    const { bill } = await setup();
    const { taskId } = await upsertFinanceBillTask(ctx(), bill());
    const paid = await upsertFinanceBillTask(
      ctx(),
      bill({ status: "paid", amountMinor: 0 }),
    );
    expect(paid.outcome).toBe("completed");
    const rows = test.db
      .select()
      .from(taskCompletions)
      .where(eq(taskCompletions.taskId, taskId!))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: "kept",
      kind: "done",
      userId: null,
      occurrenceKey: "bill:b1",
      revokedAt: null,
    });
    expect(getTask(ctx(), taskId!).state).toMatchObject({ status: "ok" });
    // repeating changes nothing
    expect(
      (
        await upsertFinanceBillTask(
          ctx(),
          bill({ status: "paid", amountMinor: 0 }),
        )
      ).outcome,
    ).toBe("unchanged");
    expect(test.db.select().from(taskCompletions).all()).toHaveLength(1);
  });

  it("takes the completion back when the bill becomes payable again", async () => {
    const { bill } = await setup();
    const { taskId } = await upsertFinanceBillTask(ctx(), bill());
    await upsertFinanceBillTask(ctx(), bill({ status: "paid" }));
    const reopened = await upsertFinanceBillTask(
      ctx(),
      bill({ status: "open" }),
    );
    expect(reopened.outcome).toBe("reopened");
    const rows = test.db.select().from(taskCompletions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].revokedAt).not.toBeNull();
    const state = getTask(ctx(), taskId!).state!;
    expect(state.dueDate).toBe("2026-07-01");
    expect(state.reasons).not.toContain("completed");
    // and paid again completes again
    expect(
      (await upsertFinanceBillTask(ctx(), bill({ status: "paid" }))).outcome,
    ).toBe("completed");
    expect(
      test.db
        .select()
        .from(taskCompletions)
        .all()
        .filter((c) => c.revokedAt === null),
    ).toHaveLength(1);
  });

  it("adds no second completion when somebody ticked the task off before the bill showed as paid", async () => {
    const { user, bill } = await setup();
    const { taskId } = await upsertFinanceBillTask(ctx(), bill());
    await completeTask(ctx(), taskId!, {
      kind: "done",
      source: "manual",
      userId: user.id,
    });
    const paid = await upsertFinanceBillTask(
      ctx(),
      bill({ status: "paid", amountMinor: 0 }),
    );
    expect(paid.outcome).not.toBe("completed");
    const rows = test.db
      .select()
      .from(taskCompletions)
      .where(eq(taskCompletions.taskId, taskId!))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "manual", userId: user.id });
    // a bill that is open again does not take back what a person recorded
    const reopened = await upsertFinanceBillTask(ctx(), bill());
    expect(reopened.outcome).not.toBe("reopened");
    expect(
      test.db
        .select()
        .from(taskCompletions)
        .all()
        .filter((c) => c.revokedAt === null),
    ).toHaveLength(1);
  });

  it("settles the task of a cancelled bill without a completion", async () => {
    const { bill } = await setup();
    const { taskId } = await upsertFinanceBillTask(ctx(), bill());
    await upsertFinanceBillTask(ctx(), bill({ status: "cancelled" }));
    expect(getTask(ctx(), taskId!).state).toMatchObject({
      status: "ok",
      reasons: ["completed", "bill_cancelled"],
    });
    expect(test.db.select().from(taskCompletions).all()).toHaveLength(0);
  });

  it("creates nothing for a bill that is already paid or cancelled", async () => {
    const { bill } = await setup();
    expect(
      await upsertFinanceBillTask(ctx(), bill({ status: "paid" })),
    ).toEqual({ outcome: "skipped", taskId: null });
    expect(
      await upsertFinanceBillTask(ctx(), bill({ status: "cancelled" })),
    ).toEqual({ outcome: "skipped", taskId: null });
    expect(test.db.select().from(tasks).all()).toHaveLength(0);
  });

  it("leaves a task alone that somebody archived", async () => {
    const { bill } = await setup();
    const { taskId } = await upsertFinanceBillTask(ctx(), bill());
    await updateTask(ctx(), taskId!, { archived: true });
    expect(
      (await upsertFinanceBillTask(ctx(), bill({ dueDate: "2026-08-01" })))
        .outcome,
    ).toBe("skipped");
    expect(
      (await upsertFinanceBillTask(ctx(), bill({ status: "paid" }))).outcome,
    ).toBe("skipped");
    expect(getTask(ctx(), taskId!).trigger).toMatchObject({
      dueDate: "2026-07-01",
    });
    expect(test.db.select().from(taskCompletions).all()).toHaveLength(0);
  });

  it("keeps the bills of two connections apart, even with the same bill id", async () => {
    const { bill, connection } = await setup();
    const other = await createTestUser({ displayName: "Ben" });
    const otherConnection = saveConnection(ctx(), "kept", other.id, {
      baseUrl: "https://other-finance.example.org",
      token: "kept_other-token",
      allowInsecureTls: false,
    });
    const a = await upsertFinanceBillTask(ctx(), bill());
    const b = await upsertFinanceBillTask(
      ctx(),
      bill({
        connectionId: otherConnection.id,
        ownerId: other.id,
        title: "Andere Rechnung",
      }),
    );
    expect(a.taskId).not.toBe(b.taskId);
    expect(getTask(ctx(), a.taskId!).title).toBe("Muster Verwaltung AG: INV-1");
    expect(getTask(ctx(), b.taskId!)).toMatchObject({
      title: "Andere Rechnung",
      assigneeUserId: other.id,
    });
    expect(activeBillTasks(ctx(), connection.id).map((t) => t.taskId)).toEqual([
      a.taskId,
    ]);
    expect(
      activeBillTasks(ctx(), otherConnection.id).map((t) => t.taskId),
    ).toEqual([b.taskId]);
  });

  describe("housekeeping", () => {
    it("archives tasks of bills that have been settled for a long time", async () => {
      const { bill } = await setup();
      const fresh = await upsertFinanceBillTask(
        ctx(),
        bill({ billId: "fresh" }),
      );
      const old = await upsertFinanceBillTask(ctx(), bill({ billId: "old" }));
      const open = await upsertFinanceBillTask(ctx(), bill({ billId: "open" }));
      await upsertFinanceBillTask(
        ctx(),
        bill({ billId: "old", status: "paid" }),
      );
      await upsertFinanceBillTask(
        ctx(),
        bill({ billId: "fresh", status: "cancelled" }),
      );
      const later = ctx(NOW + (FINISHED_BILL_TASK_DAYS + 1) * DAY);
      // "fresh" was settled just now in test time; make it recent
      test.db
        .update(tasks)
        .set({ updatedAt: new Date(later.now - DAY) })
        .where(eq(tasks.id, fresh.taskId!))
        .run();
      test.db
        .update(tasks)
        .set({ updatedAt: new Date(NOW) })
        .where(eq(tasks.id, old.taskId!))
        .run();
      expect(await archiveSettledBillTasks(later)).toBe(1);
      expect(getTask(later, old.taskId!).archivedAt).not.toBeNull();
      expect(getTask(later, fresh.taskId!).archivedAt).toBeNull();
      expect(getTask(later, open.taskId!).archivedAt).toBeNull();
    });

    it("archives the tasks of a connection that is gone", async () => {
      const { bill, connection } = await setup();
      const { taskId } = await upsertFinanceBillTask(ctx(), bill());
      deleteConnection(ctx(), "kept", connection.userId);
      expect(await archiveSettledBillTasks(ctx())).toBe(1);
      expect(getTask(ctx(), taskId!).archivedAt).not.toBeNull();
    });
  });
});
