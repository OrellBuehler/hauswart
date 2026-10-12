import { describe, expect, it } from "vitest";
import { createAiTask } from "../../src/lib/server/ai-tasks/ai-tasks";
import { saveConnection } from "../../src/lib/server/connections/connections";
import { recordSuggestion } from "../../src/lib/server/finance/suggestions";
import { plainPng } from "../../src/lib/server/files/test-images";
import { ctxAt } from "../../src/lib/testing/domain";
import { useTestFilesDir } from "../../src/lib/testing/files";
import { useMcp, type Json } from "./test-harness";

const ALL = ["read", "write", "costs:write"] as const;
const later = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("booking for a receipt task with the tools", () => {
  const mcp = useMcp();
  useTestFilesDir();

  type Session = Awaited<ReturnType<typeof mcp.connect>>;

  function queue(s: Session) {
    return createAiTask(
      ctxAt(s.db.db, Date.now()),
      { kind: "receipt", bytes: plainPng(64, 48), filename: "beleg.png" },
      s.anna.id,
    );
  }
  const book = (s: Session, over: Record<string, unknown> = {}) =>
    s.call("create_cost", {
      title: "Einkauf Beispiel AG",
      amount: "23.40",
      category: "groceries",
      ...over,
    });

  it("scenario A: a client that died after booking leaves its entries on the task, and the next one sees them and finishes", async () => {
    const s = await mcp.connect({ scopes: [...ALL] });
    const task = await queue(s);
    expect((await s.ok("get_ai_task", { id: task.id })).task.bookedSoFar).toBe(
      undefined,
    );

    // the first client books one entry for the task and is gone
    const first = await book(s, { receiptTaskId: task.id });
    expect(first.isError).toBe(false);
    expect(first.json).toMatchObject({
      needsReview: true,
      receiptTask: task.id,
    });

    // the next one opens the task and finds what is booked
    const reopened = await s.call("get_ai_task", { id: task.id });
    expect(reopened.summary).toContain("1 cost entry was booked for this task");
    expect((reopened.json.task as Json).bookedSoFar).toEqual([
      expect.objectContaining({
        id: first.json.id,
        title: "Einkauf Beispiel AG",
        amount: "23.40 CHF",
        needsReview: true,
      }),
    ]);

    // it books only what is missing and completes with everything
    const second = await book(s, {
      receiptTaskId: task.id,
      title: "Pfand",
      amount: "-2.50",
      category: "household",
    });
    const done = await s.call("complete_ai_task", {
      id: task.id,
      costIds: [first.json.id, second.json.id],
    });
    expect(done.isError).toBe(false);
    expect(done.json).toMatchObject({ status: "done" });
    expect((done.json.bookedAs as Json[]).map((c) => c.id)).toEqual([
      first.json.id,
      second.json.id,
    ]);
    expect(
      (await s.ok("list_costs", { reviewNeeded: true })).costs,
    ).toHaveLength(2);
  });

  it("books nothing for a task that is unknown or closed, and says why", async () => {
    const s = await mcp.connect({ scopes: [...ALL] });
    const missing = await book(s, { receiptTaskId: "missing" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("[invalid_request]");
    const task = await queue(s);
    await s.ok("dismiss_ai_task", { id: task.id, reason: "doppelt" });
    const closed = await book(s, { receiptTaskId: task.id });
    expect(closed.isError).toBe(true);
    expect(closed.text).toContain("[conflict]");
    expect(closed.text).toContain("not waiting");
    expect((await s.ok("list_costs")).costs).toEqual([]);
  });

  it("refuses to complete with an entry that existed before the task", async () => {
    const s = await mcp.connect({ scopes: [...ALL] });
    const early = await s.ok("create_cost", {
      title: "Schon gebucht",
      amount: "23.40",
      category: "groceries",
    });
    await later();
    const task = await queue(s);
    const reply = await s.call("complete_ai_task", {
      id: task.id,
      costIds: [early.id],
    });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("[invalid_request]");
    expect(reply.text).toContain(early.id);
    expect(reply.text).toContain("before");
    expect((await s.ok("get_ai_task", { id: task.id })).task.status).toBe(
      "pending",
    );
  });

  it("books a finance suggestion for the task", async () => {
    const s = await mcp.connect({ scopes: [...ALL] });
    const ctx = ctxAt(s.db.db);
    const connection = saveConnection(ctx, "kept", s.anna.id, {
      baseUrl: "https://anna-finance.example.org",
      token: "kept_example-token",
      allowInsecureTls: false,
    });
    const offer = recordSuggestion(ctx, {
      connectionId: connection.id,
      userId: s.anna.id,
      kind: "cost",
      providerRef: "tx:1",
      payload: {
        source: "finance_transaction",
        date: "2026-06-10",
        amountMinor: 2340,
        currency: "CHF",
        title: "Zahlung",
        payee: "Beispiel AG",
        category: "groceries",
        url: null,
        assetId: null,
      },
    }).row;
    const task = await queue(s);
    const accepted = await s.call("accept_finance_suggestion", {
      id: offer.id,
      receiptTaskId: task.id,
    });
    expect(accepted.isError).toBe(false);
    const reopened = await s.ok("get_ai_task", { id: task.id });
    expect(reopened.task.bookedSoFar).toEqual([
      expect.objectContaining({
        id: (accepted.json.entity as Json).id,
        needsReview: true,
      }),
    ]);
  });

  it("logs a fill for the task", async () => {
    const s = await mcp.connect({ scopes: [...ALL] });
    await s.ok("create_asset", { name: "Familienauto", kind: "vehicle" });
    const task = await queue(s);
    const fill = await s.call("add_fuel_log", {
      vehicle: "Familienauto",
      odometer: 80_000,
      quantity: 40,
      amount: "72.00",
      receiptTaskId: task.id,
    });
    expect(fill.isError).toBe(false);
    const reopened = await s.ok("get_ai_task", { id: task.id });
    expect(reopened.task.bookedSoFar).toEqual([
      expect.objectContaining({
        id: fill.json.costEntryId,
        fuelLogId: fill.json.id,
      }),
    ]);
    const done = await s.call("complete_ai_task", {
      id: task.id,
      fuelLogIds: [fill.json.id],
    });
    expect(done.isError).toBe(false);
  });

  it("tells in the descriptions how to book for a task", async () => {
    const s = await mcp.connect({ scopes: [...ALL] });
    const tools = (await s.client.listTools()).tools;
    const text = (name: string) =>
      tools.find((t) => t.name === name)?.description ?? "";
    for (const name of [
      "create_cost",
      "accept_finance_suggestion",
      "add_fuel_log",
    ]) {
      expect(text(name), name).toContain("receiptTaskId");
    }
    expect(text("get_ai_task")).toContain("bookedSoFar");
    expect(text("complete_ai_task")).toContain("before");
  });
});
