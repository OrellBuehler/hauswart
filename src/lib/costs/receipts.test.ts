import { describe, expect, it } from "vitest";
import type { AiTask } from "$lib/api/schemas/ai-tasks";
import {
  appendTasks,
  canDeleteTask,
  closedViaLabel,
  isImageTask,
  mergePendingFirst,
  parseReceiptView,
  receiptViewQuery,
  receiptViewStatus,
  statusLabels,
  taskThumbSrc,
} from "./receipts";

function task(over: Partial<AiTask> = {}): AiTask {
  return {
    id: "t1",
    kind: "receipt",
    status: "pending",
    note: null,
    createdByUserId: "u1",
    createdByName: "Anna Beispiel",
    attachment: {
      id: "f1",
      ownerType: "ai_task",
      ownerId: "t1",
      filename: "beleg.jpg",
      mime: "image/jpeg",
      size: 1000,
      width: 800,
      height: 600,
      caption: null,
      guestVisible: false,
      url: "/api/v1/attachments/f1/content",
      thumbUrl: "/api/v1/attachments/f1/thumb",
      uploadedBy: "u1",
      createdAt: "2026-10-12T08:00:00.000Z",
      updatedAt: "2026-10-12T08:00:00.000Z",
    },
    bookId: null,
    bookName: null,
    assetId: null,
    assetName: null,
    result: null,
    dismissReason: null,
    completedAt: null,
    completedVia: null,
    completedByUserId: null,
    completedByName: null,
    createdAt: "2026-10-12T08:00:00.000Z",
    updatedAt: "2026-10-12T08:00:00.000Z",
    ...over,
  };
}

const ids = (tasks: AiTask[]) => tasks.map((t) => t.id);

describe("the receipts view", () => {
  it("is read from the address and falls back to everything", () => {
    const view = (qs: string) => parseReceiptView(new URLSearchParams(qs));
    expect(view("")).toBe("all");
    expect(view("status=pending")).toBe("pending");
    expect(view("status=done")).toBe("done");
    expect(view("status=dismissed")).toBe("dismissed");
    expect(view("status=all")).toBe("all");
    expect(view("status=nope")).toBe("all");
  });

  it("writes the address and the status the API is asked for", () => {
    expect(receiptViewQuery("all")).toBe("");
    expect(receiptViewQuery("done")).toBe("?status=done");
    expect(receiptViewStatus("all")).toBeUndefined();
    expect(receiptViewStatus("dismissed")).toBe("dismissed");
  });
});

describe("the order of the tasks", () => {
  const p1 = task({ id: "p1" });
  const p2 = task({ id: "p2" });
  const d1 = task({ id: "d1", status: "done" });
  const d2 = task({ id: "d2", status: "dismissed" });

  it("lists what waits first and the rest behind it as the page gave it", () => {
    expect(ids(mergePendingFirst([p1, p2], [d1, p1, d2]))).toEqual([
      "p1",
      "p2",
      "d1",
      "d2",
    ]);
  });

  it("does not show a task twice that is on a later page and also waits", () => {
    expect(ids(mergePendingFirst([p2], [d1, p2, d2]))).toEqual([
      "p2",
      "d1",
      "d2",
    ]);
  });

  it("shows an empty queue as the page", () => {
    expect(ids(mergePendingFirst([], [d1]))).toEqual(["d1"]);
    expect(mergePendingFirst([], [])).toEqual([]);
  });

  it("appends a further page without repeating a task the list moved onto it", () => {
    expect(ids(appendTasks([p1, d1], [d1, d2]))).toEqual(["p1", "d1", "d2"]);
  });
});

describe("who may delete a task", () => {
  it("is the uploader and an administrator", () => {
    const own = task({ createdByUserId: "u1" });
    expect(canDeleteTask(own, { id: "u1", role: "member" })).toBe(true);
    expect(canDeleteTask(own, { id: "u2", role: "member" })).toBe(false);
    expect(canDeleteTask(own, { id: "u2", role: "admin" })).toBe(true);
  });

  it("is an administrator only for a task whose uploader is gone", () => {
    const orphan = task({ createdByUserId: null });
    expect(canDeleteTask(orphan, { id: "u1", role: "member" })).toBe(false);
    expect(canDeleteTask(orphan, { id: "u1", role: "admin" })).toBe(true);
  });
});

describe("the picture of a task", () => {
  it("uses the thumbnail of the file", () => {
    expect(taskThumbSrc(task())).toBe("/api/v1/attachments/f1/thumb");
    expect(isImageTask(task())).toBe(true);
  });

  it("falls back to the task's preview for a picture without a thumbnail", () => {
    const t = task({
      attachment: { ...task().attachment!, thumbUrl: null },
    });
    expect(taskThumbSrc(t)).toBe("/api/v1/ai-tasks/t1/preview");
  });

  it("shows no picture for a PDF or a task whose file is gone", () => {
    const pdf = task({
      attachment: {
        ...task().attachment!,
        mime: "application/pdf",
        thumbUrl: null,
      },
    });
    expect(taskThumbSrc(pdf)).toBeNull();
    expect(isImageTask(pdf)).toBe(false);
    expect(taskThumbSrc(task({ attachment: null }))).toBeNull();
    expect(isImageTask(task({ attachment: null }))).toBe(false);
  });
});

describe("the words", () => {
  it("names the three statuses", () => {
    expect(statusLabels.pending()).toBe("Offen");
    expect(statusLabels.done()).toBe("Verbucht");
    expect(statusLabels.dismissed()).toBe("Verworfen");
  });

  it("says how a task was closed, if it was", () => {
    expect(closedViaLabel(null)).toBeNull();
    expect(closedViaLabel("session")).toContain("Browser");
    expect(closedViaLabel("mcp")).toContain("MCP");
    for (const via of ["ha", "mobile", "integration"] as const) {
      expect(closedViaLabel(via)).toBeTruthy();
    }
  });
});
