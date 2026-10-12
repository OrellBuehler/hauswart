import { describe, expect, it } from "vitest";
import { createAiTask } from "../../src/lib/server/ai-tasks/ai-tasks";
import { plainPng } from "../../src/lib/server/files/test-images";
import { ctxAt } from "../../src/lib/testing/domain";
import { useTestFilesDir } from "../../src/lib/testing/files";
import { useMcp, type Json } from "./test-harness";

const ALL = ["read", "write", "costs:write"] as const;

describe("working on the same receipt task with two clients", () => {
  const mcp = useMcp();
  useTestFilesDir();

  type Session = Awaited<ReturnType<typeof mcp.connect>>;
  const queue = (s: Session) =>
    createAiTask(
      ctxAt(s.db.db, Date.now()),
      { kind: "receipt", bytes: plainPng(64, 48), filename: "beleg.png" },
      s.anna.id,
    );

  it("does not warn the client that opened the task first, nor itself when it opens it again", async () => {
    const s = await mcp.connect({ scopes: [...ALL] });
    const task = await queue(s);
    const first = await s.call("get_ai_task", { id: task.id });
    expect(first.summary).not.toContain("Warning");
    expect((first.json.task as Json).claim).toMatchObject({
      by: "you",
      minutesLeft: 15,
    });
    const again = await s.call("get_ai_task", { id: task.id });
    expect(again.summary).not.toContain("Warning");
  });

  it("scenario B: the second client is told that another member's client opened the task a moment ago", async () => {
    const s = await mcp.connect({ scopes: [...ALL] });
    const task = await queue(s);
    await s.ok("get_ai_task", { id: task.id });

    const other = await s.attach(s.ben, { scopes: [...ALL] });
    const reply = await other.call("get_ai_task", { id: task.id });
    expect(reply.isError).toBe(false);
    expect(reply.summary).toContain("Warning: Anna's client opened this task");
    expect(reply.summary).toContain("may be booking it right now");
    expect((reply.json.task as Json).claim).toMatchObject({ by: "Anna" });

    // it is a warning, not a lock: the second client can book and finish
    const booked = await other.call("create_cost", {
      title: "Einkauf",
      amount: "23.40",
      category: "groceries",
      receiptTaskId: task.id,
    });
    expect(booked.isError).toBe(false);
    const done = await other.call("complete_ai_task", {
      id: task.id,
      costIds: [booked.json.id],
    });
    expect(done.isError).toBe(false);

    // the first client, still going, is stopped by the rules of the queue
    const late = await s.call("create_cost", {
      title: "Zu spät",
      amount: "23.40",
      category: "groceries",
      receiptTaskId: task.id,
    });
    expect(late.isError).toBe(true);
    expect(late.text).toContain("[conflict]");
    const lateClose = await s.call("complete_ai_task", {
      id: task.id,
      costIds: [booked.json.id, "other"],
    });
    expect(lateClose.isError).toBe(true);
    expect((await s.ok("get_ai_task", { id: task.id })).task.closedBy).toBe(
      "Ben",
    );
  });

  it("shows the task as being worked on in the list", async () => {
    const s = await mcp.connect({ scopes: [...ALL] });
    const task = await queue(s);
    await s.ok("get_ai_task", { id: task.id });
    const other = await s.attach(s.ben, { scopes: [...ALL] });
    const rows = (await other.ok("list_ai_tasks")).tasks as Json[];
    expect(rows[0].claim).toMatchObject({ by: "Anna" });
    const mine = (await s.ok("list_ai_tasks")).tasks as Json[];
    expect(mine[0].claim).toMatchObject({ by: "you" });
  });

  it("claims nothing for a token that can only read, but still reports the holder", async () => {
    const s = await mcp.connect({ scopes: [...ALL] });
    const task = await queue(s);
    const reader = await s.attach(s.ben, { scopes: ["read"] });
    const quiet = await reader.call("get_ai_task", { id: task.id });
    expect(quiet.isError).toBe(false);
    expect(quiet.summary).not.toContain("Warning");
    expect((quiet.json.task as Json).claim).toBeUndefined();
    await s.ok("get_ai_task", { id: task.id });
    const informed = await reader.call("get_ai_task", { id: task.id });
    expect(informed.summary).toContain("Warning: Anna's client");
  });
});
