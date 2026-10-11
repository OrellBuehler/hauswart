import { describe, expect, it } from "vitest";
import type { Task } from "$lib/api/schemas/tasks";
import { isActionable, roomStats, sortTasks, taskRoomId } from "./tasks";

function task(
  id: string,
  over: {
    status?: "ok" | "open" | "due" | "overdue" | "snoozed" | "unknown";
    dueDate?: string | null;
    assetId?: string | null;
    roomId?: string | null;
    title?: string;
  } = {},
): Task {
  return {
    id,
    title: over.title ?? id,
    assetId: over.assetId ?? null,
    roomId: over.roomId ?? null,
    state: {
      status: over.status ?? "ok",
      dueDate: over.dueDate ?? null,
    },
  } as unknown as Task;
}

describe("isActionable", () => {
  it("covers overdue, due and open only", () => {
    expect(isActionable(task("a", { status: "overdue" }))).toBe(true);
    expect(isActionable(task("a", { status: "due" }))).toBe(true);
    expect(isActionable(task("a", { status: "open" }))).toBe(true);
    expect(isActionable(task("a", { status: "ok" }))).toBe(false);
    expect(isActionable(task("a", { status: "snoozed" }))).toBe(false);
    expect(isActionable({ ...task("a"), state: null })).toBe(false);
  });
});

describe("sortTasks", () => {
  it("orders by urgency, then date", () => {
    const sorted = sortTasks([
      task("ok", { status: "ok", dueDate: "2026-11-01" }),
      task("due-late", { status: "due", dueDate: "2026-10-09" }),
      task("overdue", { status: "overdue", dueDate: "2026-10-01" }),
      task("due-early", { status: "due", dueDate: "2026-10-07" }),
    ]);
    expect(sorted.map((t) => t.id)).toEqual([
      "overdue",
      "due-early",
      "due-late",
      "ok",
    ]);
  });
});

describe("sortTasks, dates that are estimates", () => {
  const estimated = (id: string, dueDate: string | null, guess: string) =>
    ({
      ...task(id, { status: "ok" }),
      state: {
        status: "ok",
        dueDate,
        dueKind: "estimated",
        estimate: { date: guess, confidence: "medium" },
      },
    }) as unknown as Task;

  it("sorts a task whose estimate comes before its hard limit by the estimate", () => {
    const sorted = sortTasks([
      task("middle", { dueDate: "2026-11-15" }),
      estimated("limit", "2027-03-01", "2026-11-01"),
      task("last", { dueDate: "2026-12-01" }),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(["limit", "middle", "last"]);
  });

  it("an estimate alone sorts by its date, not behind everything", () => {
    const sorted = sortTasks([
      task("later", { dueDate: "2026-12-01" }),
      estimated("guess", null, "2026-11-01"),
      task("none"),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(["guess", "later", "none"]);
  });
});

describe("taskRoomId", () => {
  const rooms = new Map([["asset", "room-a"]]);
  it("prefers the task's own room, then the asset's", () => {
    expect(
      taskRoomId(task("t", { roomId: "room-b", assetId: "asset" }), rooms),
    ).toBe("room-b");
    expect(taskRoomId(task("t", { assetId: "asset" }), rooms)).toBe("room-a");
    expect(taskRoomId(task("t"), rooms)).toBeNull();
  });
});

describe("roomStats", () => {
  it("counts assets and actionable tasks per room", () => {
    const stats = roomStats(
      [
        { id: "a1", roomId: "r1" },
        { id: "a2", roomId: "r1" },
        { id: "a3", roomId: null },
      ],
      [
        task("t1", { status: "overdue", assetId: "a1" }),
        task("t2", { status: "due", roomId: "r2" }),
        task("t3", { status: "ok", assetId: "a2" }),
        task("t4", { status: "due", assetId: "a3" }),
      ],
    );
    expect(stats.get("r1")).toEqual({ assets: 2, actionable: 1, overdue: 1 });
    expect(stats.get("r2")).toEqual({ assets: 0, actionable: 1, overdue: 0 });
    expect(stats.size).toBe(2);
  });
});
