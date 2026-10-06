import { describe, expect, it } from "vitest";
import { createDefectRequestSchema } from "$lib/api/schemas/defects";
import { createAsset } from "$lib/server/assets/assets";
import { createComment, deleteComment } from "$lib/server/comments/comments";
import { createContact } from "$lib/server/contacts/contacts";
import { createContactRequestSchema } from "$lib/api/schemas/contacts";
import { updateHousehold } from "$lib/server/household/household";
import { createRoom } from "$lib/server/rooms/rooms";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { pdfInfo } from "$lib/testing/pdf";
import { at, ctxAt } from "$lib/testing/domain";
import { addEvent, changeStatus, createDefect } from "./defects";
import { exportDefectsPdf, plainText } from "./pdf";

describe("defect pdf", () => {
  const test = useTestDB();
  const ctx = (now?: number) => ctxAt(test.db, now);
  const make = (over: Record<string, unknown> = {}) =>
    createDefect(
      ctx(),
      createDefectRequestSchema.parse({ title: "Riss in der Wand", ...over }),
      null,
    );

  it("renders a valid A4 pdf for an empty list", async () => {
    const bytes = await exportDefectsPdf(ctx(), { filter: {}, locale: "de" });
    const info = pdfInfo(bytes);
    expect(info.header).toBe("%PDF-");
    expect(info.trailer).toBe(true);
    expect(info.pageCount).toBe(1);
    expect(bytes.length).toBeGreaterThan(1000);
    expect(info.text).toContain("/MediaBox [0 0 595.28");
  });

  it("renders a document with the defects, their history and comments", async () => {
    const user = await createTestUser({ displayName: "Anna" });
    updateHousehold(ctx(), { name: "Haushalt Muster" });
    const room = createRoom(ctx(), { name: "Bad" });
    const asset = createAsset(ctx(), {
      kind: "fixture",
      name: "Lavabo",
      showOnEmergency: false,
    });
    const contact = createContact(
      ctx(),
      createContactRequestSchema.parse({ name: "Verwaltung AG" }),
    );
    const d = await make({
      roomId: room.id,
      assetId: asset.id,
      responsibleContactId: contact.id,
      descriptionMd: "# Riss\n\nEin **langer** Riss",
      deadlineDate: "2026-12-31",
      locationDetail: "links oben",
    });
    await make({ title: "Tropfender Hahn" });
    await changeStatus(
      ctx(at("2026-06-16")),
      d.id,
      { status: "reported", note: "per Einschreiben" },
      user.id,
    );
    addEvent(
      ctx(at("2026-06-17")),
      d.id,
      { type: "correspondence", bodyMd: "Antwort der Verwaltung" },
      user.id,
    );
    await createComment(
      ctx(at("2026-06-18")),
      { id: user.id, role: "member" },
      { entityType: "defect", entityId: d.id, bodyMd: "Foto gemacht" },
    );
    const bytes = await exportDefectsPdf(ctx(), { filter: {}, locale: "de" });
    expect(pdfInfo(bytes).pageCount).toBeGreaterThanOrEqual(1);
    expect(bytes.length).toBeGreaterThan(5000);
  });

  it("is the same bytes for the same data", async () => {
    await make({ deadlineDate: "2026-12-31" });
    const a = await exportDefectsPdf(ctx(), { filter: {}, locale: "en" });
    const b = await exportDefectsPdf(ctx(), { filter: {}, locale: "en" });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("differs by language", async () => {
    await make();
    const de = await exportDefectsPdf(ctx(), { filter: {}, locale: "de" });
    const en = await exportDefectsPdf(ctx(), { filter: {}, locale: "en" });
    expect(Buffer.from(de).equals(Buffer.from(en))).toBe(false);
  });

  it("filters by status and room and handles deleted comments", async () => {
    const user = await createTestUser();
    const room = createRoom(ctx(), { name: "Bad" });
    const a = await make({ roomId: room.id });
    await make({ title: "Zweiter" });
    const c = await createComment(
      ctx(),
      { id: user.id, role: "member" },
      { entityType: "defect", entityId: a.id, bodyMd: "weg" },
    );
    deleteComment(ctx(), { id: user.id, role: "member" }, c.id);
    await changeStatus(ctx(), a.id, { status: "fixed" }, null);
    const all = await exportDefectsPdf(ctx(), { filter: {}, locale: "de" });
    const byRoom = await exportDefectsPdf(ctx(), {
      filter: { roomId: room.id },
      locale: "de",
    });
    const byStatus = await exportDefectsPdf(ctx(), {
      filter: { status: "open" },
      locale: "de",
    });
    const none = await exportDefectsPdf(ctx(), {
      filter: { status: "rejected" },
      locale: "de",
    });
    for (const bytes of [all, byRoom, byStatus, none])
      expect(pdfInfo(bytes).pageCount).toBeGreaterThanOrEqual(1);
    expect(all.length).toBeGreaterThan(byRoom.length);
    expect(none.length).toBeLessThan(byStatus.length);
  });

  it("spreads many defects over several pages", async () => {
    for (let i = 0; i < 30; i++) {
      await make({
        title: `Mangel Nummer ${i}`,
        descriptionMd: "Beschreibung ".repeat(30),
      });
    }
    const info = pdfInfo(
      await exportDefectsPdf(ctx(), { filter: {}, locale: "de" }),
    );
    expect(info.pageCount).toBeGreaterThan(3);
  });

  it("copes with umlauts, markdown and long words", async () => {
    await make({
      title: "Äpfel über Öl – Größe ß",
      descriptionMd: "[Link](https://example.org) `code` " + "x".repeat(200),
    });
    const bytes = await exportDefectsPdf(ctx(), { filter: {}, locale: "de" });
    expect(pdfInfo(bytes).pageCount).toBeGreaterThanOrEqual(1);
  });

  it("turns markdown into plain text", () => {
    expect(
      plainText(
        "# Titel\n\nEin **fetter** und _kursiver_ Text mit [Link](https://example.org) und `code`.",
      ),
    ).toBe(
      "Titel\n\nEin fetter und kursiver Text mit Link (https://example.org) und code.",
    );
    expect(plainText("> Zitat\n```js\nlet a\n```")).toBe("Zitat\nlet a");
  });
});
