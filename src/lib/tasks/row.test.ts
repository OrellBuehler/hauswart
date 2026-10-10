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
