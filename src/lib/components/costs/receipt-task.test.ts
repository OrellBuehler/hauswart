import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import type { AiTask } from "$lib/api/schemas/ai-tasks";
import ReceiptTask from "./receipt-task.svelte";

function task(over: Partial<AiTask> = {}): AiTask {
  return {
    id: "t1",
    kind: "receipt",
    status: "pending",
    note: "Wocheneinkauf, bar bezahlt",
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
    bookId: "b1",
    bookName: "Haushalt",
    assetId: null,
    assetName: null,
    claim: null,
    bookedSoFar: [],
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

const html = (t: AiTask, over: Record<string, unknown> = {}) =>
  render(ReceiptTask as never, {
    props: {
      task: t,
      timeZone: "Europe/Zurich",
      canDismiss: true,
      canDelete: true,
      onopen: () => {},
      ondismiss: () => {},
      ondelete: () => {},
      ...over,
    } as never,
  }).body.replace(/[\u00a0\u202f]/g, " ");

const done = (over: Partial<AiTask> = {}) =>
  task({
    status: "done",
    completedAt: "2026-10-12T09:00:00.000Z",
    completedVia: "mcp",
    result: {
      createdCostIds: ["c1", "c2"],
      createdFuelLogIds: [],
      note: "Pfand als Rückerstattung gebucht.",
      costs: [
        {
          id: "c1",
          date: "2026-10-12",
          title: "Beispiel Markt",
          amountMinor: 2670,
          currency: "CHF",
          reviewNeeded: true,
          fuelLogId: null,
        },
        {
          id: "c2",
          date: "2026-10-12",
          title: "Pfand",
          amountMinor: -250,
          currency: "CHF",
          reviewNeeded: false,
          fuelLogId: null,
        },
      ],
    },
    ...over,
  });

describe("a receipt in the queue", () => {
  it("shows a waiting receipt with its thumbnail, uploader, note and hints", () => {
    const body = html(task());
    expect(body).toContain("Offen");
    expect(body).toContain('src="/api/v1/attachments/f1/thumb"');
    expect(body).toContain("Eingereicht von Anna Beispiel");
    expect(body).toContain("Wocheneinkauf, bar bezahlt");
    expect(body).toContain("Buch: Haushalt");
    expect(body).toContain("Verwerfen");
    expect(body).toContain("Löschen");
  });

  it("offers dismissing and deleting only to those who may", () => {
    const body = html(task(), { canDismiss: false, canDelete: false });
    expect(body).not.toContain("Verwerfen");
    expect(body).not.toContain("Löschen");
    expect(html(task(), { canDelete: false })).not.toContain("Löschen");
  });

  it("lists the entries a done task booked, with links, amounts and the review mark", () => {
    const body = html(done());
    expect(body).toContain("Verbucht");
    expect(body).toContain("Gebuchte Einträge");
    expect(body).toContain('href="/costs/c1"');
    expect(body).toContain('href="/costs/c2"');
    expect(body).toContain("CHF 26.70");
    expect(body).toContain("-2.50");
    expect(body.match(/Zu prüfen/g)).toHaveLength(1);
    expect(body).toContain("Hinweis zur Buchung");
    expect(body).toContain("über die MCP-Verbindung abgeschlossen");
    // a task that is done cannot be dismissed any more
    expect(body).not.toContain("Verwerfen");
  });

  it("names the person who closed a task, next to when and how", () => {
    const body = html(
      done({ completedByUserId: "u2", completedByName: "Ben Beispiel" }),
    );
    expect(body).toContain("Von Ben Beispiel");
    expect(body).toContain("über die MCP-Verbindung abgeschlossen");
    const dismissed = html(
      task({
        status: "dismissed",
        completedAt: "2026-10-12T09:00:00.000Z",
        completedVia: "session",
        completedByUserId: "u1",
        completedByName: "Anna Beispiel",
      }),
    );
    expect(dismissed).toContain("Von Anna Beispiel");
  });

  it("says who is working on a waiting task right now", () => {
    const body = html(
      task({
        claim: {
          byUserId: "u2",
          byName: "Ben Beispiel",
          at: "2026-10-12T08:05:00.000Z",
          expiresAt: "2026-10-12T08:20:00.000Z",
        },
      }),
    );
    expect(body).toContain("Wird gerade bearbeitet von Ben Beispiel");
    expect(html(task())).not.toContain("Wird gerade bearbeitet");
  });

  it("shows no name for a task closed before the closer was recorded, or by a person who is gone", () => {
    const body = html(done());
    expect(body).not.toContain("Von ");
    expect(body).toContain("über die MCP-Verbindung abgeschlossen");
  });

  it("says so when the entries of a done task are gone", () => {
    const body = html(
      done({
        result: {
          createdCostIds: ["c1"],
          createdFuelLogIds: [],
          note: null,
          costs: [],
        },
      }),
    );
    expect(body).toContain("wurden inzwischen gelöscht");
  });

  it("shows why a task was dismissed", () => {
    const body = html(
      task({
        status: "dismissed",
        dismissReason: "Beleg ist nicht lesbar",
        completedAt: "2026-10-12T09:00:00.000Z",
        completedVia: "session",
      }),
    );
    expect(body).toContain("Verworfen");
    expect(body).toContain("Grund: Beleg ist nicht lesbar");
    expect(body).toContain("im Browser abgeschlossen");
  });

  it("opens a PDF in a new tab and shows a tile instead of a thumbnail", () => {
    const body = html(
      task({
        attachment: {
          ...task().attachment!,
          mime: "application/pdf",
          thumbUrl: null,
        },
      }),
    );
    expect(body).not.toContain("<img");
    expect(body).toContain('href="/api/v1/attachments/f1/content"');
    expect(body).toContain('target="_blank"');
    expect(body).toContain('rel="noopener noreferrer"');
    expect(body).toContain("PDF öffnen");
  });

  it("says when the file is gone", () => {
    const body = html(task({ attachment: null }));
    expect(body).toContain("Die Datei gibt es nicht mehr.");
    expect(body).not.toContain("<img");
  });

  it("names an uploader who is gone", () => {
    const body = html(task({ createdByUserId: null, createdByName: null }));
    expect(body).toContain("Eingereicht von einer gelöschten Person");
  });

  it("keeps a long unbroken note from widening the page", () => {
    const body = html(task({ note: "x".repeat(300) }));
    expect(body).toContain("wrap-anywhere");
  });
});
