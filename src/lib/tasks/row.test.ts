import { describe, expect, it } from "vitest";
import type { Task } from "$lib/api/schemas/tasks";
import { rowFromTask } from "./row";

const taskWith = (state: object | null): Task =>
  ({
    id: "t1",
    title: "Service",
    assetId: null,
    assetName: null,
    roomId: null,
    roomName: null,
    archivedAt: null,
    snoozedUntil: null,
    commentCount: 0,
    state,
  }) as unknown as Task;

const guess = { date: "2026-11-03", confidence: "medium" };

describe("rowFromTask, the date and whether it is a guess", () => {
  it.each([
    ["no state", null, null, false],
    [
      "an exact date",
      { status: "ok", dueDate: "2026-12-01", dueKind: "exact", estimate: null },
      "2026-12-01",
      false,
    ],
    [
      "an estimate alone",
      { status: "ok", dueDate: null, dueKind: "estimated", estimate: guess },
      "2026-11-03",
      true,
    ],
    [
      "an estimate that comes before the hard limit",
      {
        status: "ok",
        dueDate: "2027-01-15",
        dueKind: "estimated",
        estimate: guess,
      },
      "2026-11-03",
      true,
    ],
    [
      "nothing yet",
      { status: "unknown", dueDate: null, dueKind: "none", estimate: null },
      null,
      false,
    ],
  ])("%s", (_name, state, date, estimated) => {
    const row = rowFromTask(taskWith(state), new Map());
    expect(row.date).toBe(date);
    expect(row.estimated).toBe(estimated);
  });
});
