import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  createAssetNoteRequestSchema,
  updateAssetNoteRequestSchema,
} from "$lib/api/schemas/asset-notes";
import { createAsset, deleteAsset } from "$lib/server/assets/assets";
import { createAttachment } from "$lib/server/attachments/attachments";
import {
  assetNotes,
  attachments,
  defectEvents,
  defects,
  tasks,
} from "$lib/server/db";
import { deleteDefect } from "$lib/server/defects/defects";
import { updateHousehold } from "$lib/server/household/household";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt } from "$lib/testing/domain";
import { samplePdf, useTestFilesDir } from "$lib/testing/files";
import {
  createNote,
  deleteNote,
  getNote,
  listNotes,
  noteToDefect,
  titleOfNote,
  updateNote,
} from "./notes";

describe("asset notes", () => {
  const test = useTestDB();
  useTestFilesDir();
  const ctx = (now?: number) => ctxAt(test.db, now);
  const page = { limit: 50 };
  const asset = (name = "Kombi") =>
    createAsset(ctx(), { kind: "other", name, showOnEmergency: false });
  const note = (
    assetId: string,
    body = "Bremsen quietschen",
    now?: number,
    userId: string | null = null,
  ) =>
    createNote(
      ctx(now),
      assetId,
      createAssetNoteRequestSchema.parse({ body }),
      userId,
    );
  const bodies = (items: { body: string }[]) => items.map((n) => n.body);

  describe("creating and listing", () => {
    it("starts open, names its author and its asset", async () => {
      const user = await createTestUser({ displayName: "Anna" });
      const a = await asset();
      const n = note(a.id, "Bremsen quietschen", undefined, user.id);
      expect(n).toMatchObject({
        assetId: a.id,
        assetName: "Kombi",
        body: "Bremsen quietschen",
        status: "open",
        resolvedAt: null,
        resolvedBy: null,
        resolvedByName: null,
        serviceLogId: null,
        defectId: null,
        createdBy: user.id,
        createdByName: "Anna",
      });
    });

    it("lists the open notes newest first, by default, and the resolved or all on request", async () => {
      const a = await asset();
      const first = note(a.id, "Erste", at("2026-06-10"));
      note(a.id, "Zweite", at("2026-06-11"));
      note(a.id, "Dritte", at("2026-06-12"));
      updateNote(ctx(), first.id, { status: "resolved" }, null);
      expect(
        bodies(listNotes(ctx(), a.id, { status: "open" }, page).items),
      ).toEqual(["Dritte", "Zweite"]);
      expect(
        bodies(listNotes(ctx(), a.id, { status: "resolved" }, page).items),
      ).toEqual(["Erste"]);
      expect(
        bodies(listNotes(ctx(), a.id, { status: "all" }, page).items),
      ).toEqual(["Dritte", "Zweite", "Erste"]);
    });

    it("keeps notes apart per asset, and pages", async () => {
      const a = await asset();
      const b = await asset("Anhänger");
      for (const body of ["A1", "A2", "A3"]) note(a.id, body);
      note(b.id, "B1");
      expect(
        listNotes(ctx(), b.id, { status: "all" }, page).items,
      ).toHaveLength(1);
      const first = listNotes(ctx(), a.id, { status: "all" }, { limit: 2 });
      expect(first.items).toHaveLength(2);
      const second = listNotes(
        ctx(),
        a.id,
        { status: "all" },
        { limit: 2, cursor: first.nextCursor! },
      );
      expect(second.items).toHaveLength(1);
      expect(second.nextCursor).toBeNull();
    });

    it("answers 404 for an unknown asset or note", () => {
      expect(() => listNotes(ctx(), "nope", { status: "open" }, page)).toThrow(
        /asset not found/i,
      );
      expect(() => note("nope")).toThrow(/asset not found/i);
      expect(() => getNote(ctx(), "nope")).toThrow(/note not found/i);
    });

    it("validates the text", () => {
      const parse = (body: unknown) =>
        createAssetNoteRequestSchema.safeParse({ body });
      expect(parse("").success).toBe(false);
      expect(parse("   ").success).toBe(false);
      expect(parse("x".repeat(2001)).success).toBe(false);
      expect(parse(5).success).toBe(false);
      expect(parse("x".repeat(2000)).success).toBe(true);
      expect(parse("  Bremsen  ")).toMatchObject({
        success: true,
        data: { body: "Bremsen" },
      });
      expect(
        createAssetNoteRequestSchema.safeParse({
          body: "x",
          status: "resolved",
        }).success,
      ).toBe(false);
      expect(updateAssetNoteRequestSchema.safeParse({}).success).toBe(false);
      expect(
        updateAssetNoteRequestSchema.safeParse({ status: "later" }).success,
      ).toBe(false);
    });
  });

  describe("updating", () => {
    it("changes the text", async () => {
      const a = await asset();
      const n = note(a.id);
      expect(updateNote(ctx(), n.id, { body: "Neu" }, null)).toMatchObject({
        body: "Neu",
        status: "open",
      });
    });

    it("resolving records who and when, repeating it changes nothing, reopening clears it", async () => {
      const user = await createTestUser({ displayName: "Ben" });
      const a = await asset();
      const n = note(a.id);
      const resolved = updateNote(
        ctx(at("2026-06-16")),
        n.id,
        { status: "resolved" },
        user.id,
      );
      expect(resolved).toMatchObject({
        status: "resolved",
        resolvedBy: user.id,
        resolvedByName: "Ben",
      });
      expect(resolved.resolvedAt?.getTime()).toBe(at("2026-06-16"));
      const again = updateNote(
        ctx(at("2026-06-20")),
        n.id,
        { status: "resolved" },
        null,
      );
      expect(again.resolvedAt?.getTime()).toBe(at("2026-06-16"));
      expect(again.resolvedBy).toBe(user.id);
      expect(updateNote(ctx(), n.id, { status: "open" }, null)).toMatchObject({
        status: "open",
        resolvedAt: null,
        resolvedBy: null,
        serviceLogId: null,
      });
    });

    it("answers 404 for an unknown note", () => {
      expect(() => updateNote(ctx(), "nope", { body: "x" }, null)).toThrow(
        /note not found/i,
      );
    });
  });

  describe("deleting", () => {
    it("removes the note and its photos", async () => {
      const a = await asset();
      const n = note(a.id);
      const other = note(a.id, "Bleibt");
      await createAttachment(ctx(), {
        bytes: samplePdf(),
        filename: "foto.pdf",
        ownerType: "asset_note",
        ownerId: n.id,
        uploadedBy: null,
      });
      deleteNote(ctx(), n.id);
      expect(() => getNote(ctx(), n.id)).toThrow(/not found/i);
      expect(test.db.select().from(attachments).all()).toEqual([]);
      expect(getNote(ctx(), other.id).body).toBe("Bleibt");
      expect(() => deleteNote(ctx(), n.id)).toThrow(/not found/i);
    });

    it("goes with the asset, photos included", async () => {
      const a = await asset();
      const n = note(a.id);
      await createAttachment(ctx(), {
        bytes: samplePdf(),
        filename: "foto.pdf",
        ownerType: "asset_note",
        ownerId: n.id,
        uploadedBy: null,
      });
      deleteAsset(ctx(), a.id);
      expect(test.db.select().from(assetNotes).all()).toEqual([]);
      expect(test.db.select().from(attachments).all()).toEqual([]);
    });

    it("only takes photos for a note that exists", async () => {
      await expect(
        createAttachment(ctx(), {
          bytes: samplePdf(),
          filename: "foto.pdf",
          ownerType: "asset_note",
          ownerId: "nope",
          uploadedBy: null,
        }),
      ).rejects.toMatchObject({ code: "invalid_request" });
    });
  });

  describe("titleOfNote", () => {
    it.each([
      ["Bremsen quietschen", "Bremsen quietschen"],
      ["Bremsen quietschen\nvor allem nass", "Bremsen quietschen"],
      ["\n\n  Licht flackert  \r\nrechts", "Licht flackert"],
      ["x".repeat(200), "x".repeat(200)],
      ["x".repeat(201), `${"x".repeat(199)}…`],
      ["Kurz\n" + "y".repeat(500), "Kurz"],
    ])("%j -> %j", (body, expected) => {
      expect(titleOfNote(body)).toBe(expected);
    });
  });

  describe("turning a note into a defect", () => {
    it("creates the defect on the asset and resolves the note with a link to it", async () => {
      const user = await createTestUser();
      const a = await asset();
      const n = note(
        a.id,
        "Bremsen quietschen\nvor allem bei Nässe, hinten links",
        at("2026-06-01"),
      );
      const { note: updated, defect } = noteToDefect(
        ctx(at("2026-06-15")),
        n.id,
        user.id,
      );
      expect(defect).toMatchObject({
        number: 1,
        title: "Bremsen quietschen",
        descriptionMd: "Bremsen quietschen\nvor allem bei Nässe, hinten links",
        status: "open",
        severity: "medium",
        assetId: a.id,
        assetName: "Kombi",
        roomId: null,
        discoveredOn: "2026-06-01",
        deadlineDate: null,
        reminderTaskId: null,
        createdBy: user.id,
      });
      expect(updated).toMatchObject({
        status: "resolved",
        defectId: defect.id,
        resolvedBy: user.id,
        serviceLogId: null,
      });
      expect(updated.resolvedAt?.getTime()).toBe(at("2026-06-15"));
      expect(
        test.db
          .select()
          .from(defectEvents)
          .where(eq(defectEvents.defectId, defect.id))
          .all(),
      ).toMatchObject([{ type: "created", userId: user.id }]);
      expect(test.db.select().from(tasks).all()).toEqual([]);
    });

    it("gets no deadline even when the household has a handover date", async () => {
      updateHousehold(ctx(), { handoverDate: "2026-04-03" });
      const a = await asset();
      const { defect } = noteToDefect(ctx(), note(a.id).id, null);
      expect(defect).toMatchObject({
        deadlineDate: null,
        deadlineSource: "manual",
        reminderTaskId: null,
      });
    });

    it("keeps who resolved an already resolved note and when", async () => {
      const [anna, ben] = [await createTestUser(), await createTestUser()];
      const a = await asset();
      const n = note(a.id);
      updateNote(ctx(at("2026-06-10")), n.id, { status: "resolved" }, anna.id);
      const { note: updated } = noteToDefect(
        ctx(at("2026-06-15")),
        n.id,
        ben.id,
      );
      expect(updated).toMatchObject({
        status: "resolved",
        resolvedBy: anna.id,
        defectId: expect.any(String),
      });
      expect(updated.resolvedAt?.getTime()).toBe(at("2026-06-10"));
    });

    it("is a conflict for a note that already became a defect, until that defect is gone", async () => {
      const a = await asset();
      const n = note(a.id);
      const { defect } = noteToDefect(ctx(), n.id, null);
      expect(() => noteToDefect(ctx(), n.id, null)).toThrow(/already/i);
      expect(test.db.select().from(defects).all()).toHaveLength(1);
      deleteDefect(ctx(), defect.id);
      expect(getNote(ctx(), n.id)).toMatchObject({
        defectId: null,
        status: "resolved",
      });
      const again = noteToDefect(ctx(), n.id, null);
      expect(again.defect.number).toBe(1);
      expect(again.defect.id).not.toBe(defect.id);
    });

    it("numbers the defects on", async () => {
      const a = await asset();
      expect(noteToDefect(ctx(), note(a.id).id, null).defect.number).toBe(1);
      expect(
        noteToDefect(ctx(), note(a.id, "Zwei").id, null).defect.number,
      ).toBe(2);
    });

    it("answers 404 for an unknown note", () => {
      expect(() => noteToDefect(ctx(), "nope", null)).toThrow(
        /note not found/i,
      );
    });

    it("happens in one transaction: nothing is left behind when the note cannot be updated", async () => {
      const a = await asset();
      const n = note(a.id);
      test.db.$client.exec(
        "CREATE TRIGGER block_note_update BEFORE UPDATE ON asset_notes BEGIN SELECT RAISE(ABORT, 'blocked'); END",
      );
      expect(() => noteToDefect(ctx(), n.id, null)).toThrow(/blocked/);
      expect(test.db.select().from(defects).all()).toEqual([]);
      expect(test.db.select().from(defectEvents).all()).toEqual([]);
      test.db.$client.exec("DROP TRIGGER block_note_update");
      expect(getNote(ctx(), n.id)).toMatchObject({
        status: "open",
        defectId: null,
      });
    });
  });
});
