import { describe, expect, it } from "vitest";
import type { Dashboard } from "$lib/api/schemas/dashboard";
import type { Task } from "$lib/api/schemas/tasks";
import { rowFromDashboard, rowFromTask } from "./row";

const task = {
  id: "t1",
  title: "Service",
  assetId: "a1",
  assetName: "Familienauto",
  roomId: null,
  roomName: null,
  archivedAt: null,
  snoozedUntil: null,
  commentCount: 2,
  openNoteCount: 3,
  state: null,
} as unknown as Task;

describe("the open notes of a task's asset on its row", () => {
  it("come along from a listed task", () => {
    expect(rowFromTask(task, new Map()).openNoteCount).toBe(3);
  });

  it("come along from a dashboard entry", () => {
    const entry = {
      taskId: "t1",
      title: "Service",
      assetId: "a1",
      assetName: "Familienauto",
      roomId: null,
      roomName: null,
      assigneeUserId: null,
      assigneeName: null,
      status: "open",
      date: null,
      estimated: false,
      progress: null,
      openNoteCount: 1,
    } as unknown as Dashboard["upcoming"]["today"][number];
    expect(rowFromDashboard(entry).openNoteCount).toBe(1);
  });

  it("are 0 for a task without notes", () => {
    expect(
      rowFromTask({ ...task, openNoteCount: 0 }, new Map()).openNoteCount,
    ).toBe(0);
  });
});

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
