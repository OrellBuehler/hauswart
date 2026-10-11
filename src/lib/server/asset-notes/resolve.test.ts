import { describe, expect, it } from "vitest";
import { createAssetNoteRequestSchema } from "$lib/api/schemas/asset-notes";
import {
  completionServiceLogSchema,
  createServiceLogRequestSchema,
} from "$lib/api/schemas/service-log";
import { createAsset } from "$lib/server/assets/assets";
import { deleteDefect } from "$lib/server/defects/defects";
import { defects, serviceLog, taskCompletions } from "$lib/server/db";
import {
  checkCompletionLog,
  createEntry,
  deleteEntry,
  logCompletion,
  updateEntry,
} from "$lib/server/service-log/service-log";
import { completeTask, undoCompletion } from "$lib/server/tasks/completions";
import { getTask } from "$lib/server/tasks/tasks";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt, makeTask } from "$lib/testing/domain";
import { createNote, getNote, noteToDefect, updateNote } from "./notes";

describe("notes resolved by service log entries", () => {
  const test = useTestDB();
  const ctx = (now?: number) => ctxAt(test.db, now);
  const asset = (name = "Kombi") =>
    createAsset(ctx(), { kind: "other", name, showOnEmergency: false });
  const note = (assetId: string, body = "Bremsen quietschen") =>
    createNote(
      ctx(),
      assetId,
      createAssetNoteRequestSchema.parse({ body }),
      null,
    );
  const entry = (
    assetId: string,
    over: Record<string, unknown> = {},
    now?: number,
    userId: string | null = null,
  ) =>
    createEntry(
      ctx(now),
      assetId,
      createServiceLogRequestSchema.parse({ title: "Service", ...over }),
      userId,
    );
  const entries = () => test.db.select().from(serviceLog).all();

  describe("creating an entry", () => {
    it("resolves the notes it names with the entry, by the person who wrote it, and leaves the others open", async () => {
      const user = await createTestUser({ displayName: "Anna" });
      const a = await asset();
      const [one, two, other] = [
        note(a.id, "Eins"),
        note(a.id, "Zwei"),
        note(a.id, "Drei"),
      ];
      const e = entry(
        a.id,
        { resolvedNoteIds: [one.id, two.id] },
        at("2026-06-20"),
        user.id,
      );
      for (const id of [one.id, two.id]) {
        const n = getNote(ctx(), id);
        expect(n).toMatchObject({
          status: "resolved",
          serviceLogId: e.id,
          resolvedBy: user.id,
          resolvedByName: "Anna",
        });
        expect(n.resolvedAt?.getTime()).toBe(at("2026-06-20"));
      }
      expect(getNote(ctx(), other.id)).toMatchObject({
        status: "open",
        serviceLogId: null,
      });
    });

    it("takes no notes by default and accepts an empty list and repeated ids", async () => {
      const a = await asset();
      const n = note(a.id);
      entry(a.id);
      entry(a.id, { resolvedNoteIds: [] });
      expect(getNote(ctx(), n.id).status).toBe("open");
      entry(a.id, { resolvedNoteIds: [n.id, n.id] });
      expect(getNote(ctx(), n.id).status).toBe("resolved");
    });

    it("refuses another asset's note or an unknown id, and creates nothing", async () => {
      const a = await asset();
      const b = await asset("Anhänger");
      const mine = note(a.id);
      const foreign = note(b.id);
      for (const ids of [[foreign.id], ["nope"], [mine.id, foreign.id]]) {
        expect(() => entry(a.id, { resolvedNoteIds: ids })).toThrowError(
          expect.objectContaining({
            code: "invalid_request",
            details: {
              body: {
                formErrors: [],
                fieldErrors: { resolvedNoteIds: [expect.any(String)] },
              },
            },
          }),
        );
      }
      expect(entries()).toEqual([]);
      expect(getNote(ctx(), mine.id).status).toBe("open");
      expect(getNote(ctx(), foreign.id).status).toBe("open");
    });

    it("leaves a note that is resolved already as it is", async () => {
      const [anna, ben] = [await createTestUser(), await createTestUser()];
      const a = await asset();
      const n = note(a.id);
      updateNote(ctx(at("2026-06-10")), n.id, { status: "resolved" }, anna.id);
      entry(a.id, { resolvedNoteIds: [n.id] }, at("2026-06-20"), ben.id);
      const after = getNote(ctx(), n.id);
      expect(after).toMatchObject({
        resolvedBy: anna.id,
        serviceLogId: null,
      });
      expect(after.resolvedAt?.getTime()).toBe(at("2026-06-10"));
    });

    it("is one transaction: a failing step leaves no entry and no resolved note", async () => {
      const a = await asset();
      const n = note(a.id);
      test.db.$client.exec(
        "CREATE TRIGGER block_note_update BEFORE UPDATE ON asset_notes BEGIN SELECT RAISE(ABORT, 'blocked'); END",
      );
      expect(() => entry(a.id, { resolvedNoteIds: [n.id] })).toThrow(/blocked/);
      test.db.$client.exec("DROP TRIGGER block_note_update");
      expect(entries()).toEqual([]);
      expect(getNote(ctx(), n.id).status).toBe("open");
    });
  });

  describe("updating an entry", () => {
    it("adds notes to those it resolved, also when nothing else changes", async () => {
      const user = await createTestUser();
      const a = await asset();
      const [one, two] = [note(a.id, "Eins"), note(a.id, "Zwei")];
      const e = entry(a.id, { resolvedNoteIds: [one.id] });
      const updated = updateEntry(
        ctx(at("2026-06-21")),
        a.id,
        e.id,
        { resolvedNoteIds: [two.id] },
        user.id,
      );
      expect(updated.updatedAt.getTime()).toBe(at("2026-06-21"));
      expect(getNote(ctx(), one.id).serviceLogId).toBe(e.id);
      expect(getNote(ctx(), two.id)).toMatchObject({
        status: "resolved",
        serviceLogId: e.id,
        resolvedBy: user.id,
      });
    });

    it("changes the entry and the notes together", async () => {
      const a = await asset();
      const n = note(a.id);
      const e = entry(a.id);
      expect(
        updateEntry(ctx(), a.id, e.id, {
          title: "Bremsen gemacht",
          resolvedNoteIds: [n.id],
        }),
      ).toMatchObject({ title: "Bremsen gemacht" });
      expect(getNote(ctx(), n.id).serviceLogId).toBe(e.id);
    });

    it("refuses a note of another asset and changes nothing", async () => {
      const a = await asset();
      const b = await asset("Anhänger");
      const foreign = note(b.id);
      const e = entry(a.id);
      expect(() =>
        updateEntry(ctx(), a.id, e.id, {
          title: "Neu",
          resolvedNoteIds: [foreign.id],
        }),
      ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
      expect(entries()[0].title).toBe("Service");
      expect(getNote(ctx(), foreign.id).status).toBe("open");
    });
  });

  describe("deleting an entry", () => {
    it("reopens the notes it resolved, and only those", async () => {
      const a = await asset();
      const [one, two, manual] = [
        note(a.id, "Eins"),
        note(a.id, "Zwei"),
        note(a.id, "Von Hand"),
      ];
      const e = entry(a.id, { resolvedNoteIds: [one.id] });
      entry(a.id, { resolvedNoteIds: [two.id] });
      updateNote(ctx(), manual.id, { status: "resolved" }, null);
      deleteEntry(ctx(), a.id, e.id);
      expect(getNote(ctx(), one.id)).toMatchObject({
        status: "open",
        serviceLogId: null,
        resolvedAt: null,
        resolvedBy: null,
      });
      expect(getNote(ctx(), two.id).status).toBe("resolved");
      expect(getNote(ctx(), manual.id).status).toBe("resolved");
    });

    it("leaves a note that became a defect resolved, and reopens the others of the entry", async () => {
      const a = await asset();
      const [turned, plain] = [note(a.id, "Wird Mangel"), note(a.id, "Bleibt")];
      const e = entry(a.id, { resolvedNoteIds: [turned.id, plain.id] });
      const { defect } = noteToDefect(ctx(), turned.id, null);
      deleteEntry(ctx(), a.id, e.id);
      expect(getNote(ctx(), turned.id)).toMatchObject({
        status: "resolved",
        defectId: defect.id,
        serviceLogId: null,
      });
      expect(getNote(ctx(), plain.id).status).toBe("open");
      expect(test.db.select().from(defects).all()).toHaveLength(1);
    });

    it("reopens a note again once its defect is gone", async () => {
      const a = await asset();
      const n = note(a.id);
      const e = entry(a.id, { resolvedNoteIds: [n.id] });
      const { defect } = noteToDefect(ctx(), n.id, null);
      deleteDefect(ctx(), defect.id);
      expect(getNote(ctx(), n.id).defectId).toBeNull();
      deleteEntry(ctx(), a.id, e.id);
      expect(getNote(ctx(), n.id).status).toBe("open");
    });
  });

  describe("completing a task", () => {
    async function setup() {
      const user = await createTestUser({ displayName: "Anna" });
      const a = await asset();
      const task = await makeTask(ctx(), { title: "Service", assetId: a.id });
      return { user, a, task };
    }

    const complete = async (
      taskId: string,
      userId: string,
      log: Record<string, unknown> | null,
      key?: string,
    ) => {
      const t = getTask(ctx(), taskId);
      if (log) {
        checkCompletionLog(ctx(), t, createCompletionLog(log));
      }
      const result = await completeTask(ctx(), taskId, {
        kind: "done",
        source: "manual",
        userId,
        idempotencyKey: key,
      });
      const written =
        log && !result.replayed
          ? logCompletion(
              ctx(),
              result.completion.id,
              { assetId: t.assetId!, title: t.title },
              createCompletionLog(log),
              result.completion.completedDate,
              userId,
            )
          : null;
      return { ...result, written };
    };

    it("resolves the notes with the entry written for the completion", async () => {
      const { user, a, task } = await setup();
      const n = note(a.id);
      const { written } = await complete(task.id, user.id, {
        resolvedNoteIds: [n.id],
      });
      expect(written).not.toBeNull();
      expect(getNote(ctx(), n.id)).toMatchObject({
        status: "resolved",
        serviceLogId: written!.id,
        resolvedBy: user.id,
      });
    });

    it("refuses a bad note before the task is completed", async () => {
      const { user, task } = await setup();
      const b = await asset("Anhänger");
      const foreign = note(b.id);
      await expect(
        complete(task.id, user.id, { resolvedNoteIds: [foreign.id] }),
      ).rejects.toMatchObject({
        code: "invalid_request",
        details: {
          body: { fieldErrors: { serviceLog: [expect.any(String)] } },
        },
      });
      expect(test.db.select().from(taskCompletions).all()).toEqual([]);
      expect(entries()).toEqual([]);
      expect(getNote(ctx(), foreign.id).status).toBe("open");
    });

    it("leaves the notes alone without a service log entry", async () => {
      const { user, a, task } = await setup();
      const n = note(a.id);
      await complete(task.id, user.id, null);
      expect(getNote(ctx(), n.id).status).toBe("open");
    });

    it("a retried completion changes nothing more", async () => {
      const { user, a, task } = await setup();
      const [one, two] = [note(a.id, "Eins"), note(a.id, "Zwei")];
      const first = await complete(
        task.id,
        user.id,
        { resolvedNoteIds: [one.id] },
        "retry-key-1",
      );
      const again = await complete(
        task.id,
        user.id,
        { resolvedNoteIds: [one.id, two.id] },
        "retry-key-1",
      );
      expect(again.replayed).toBe(true);
      expect(again.written).toBeNull();
      expect(entries()).toHaveLength(1);
      expect(getNote(ctx(), one.id).serviceLogId).toBe(first.written!.id);
      expect(getNote(ctx(), two.id).status).toBe("open");
    });

    it("undoing the completion reopens the notes its entry resolved, not others", async () => {
      const { user, a, task } = await setup();
      const [one, byHand, other] = [
        note(a.id, "Eins"),
        note(a.id, "Von Hand"),
        note(a.id, "Anderer Eintrag"),
      ];
      entry(a.id, { resolvedNoteIds: [other.id] });
      updateNote(ctx(), byHand.id, { status: "resolved" }, null);
      const { completion } = await complete(task.id, user.id, {
        resolvedNoteIds: [one.id],
      });
      await undoCompletion(ctx(), completion.id, user.id);
      expect(getNote(ctx(), one.id)).toMatchObject({
        status: "open",
        serviceLogId: null,
        resolvedAt: null,
        resolvedBy: null,
      });
      expect(getNote(ctx(), byHand.id).status).toBe("resolved");
      expect(getNote(ctx(), other.id).status).toBe("resolved");
      // The entry itself stays in the log.
      expect(entries()).toHaveLength(2);
      // Undoing again is harmless.
      await undoCompletion(ctx(), completion.id, user.id);
      expect(getNote(ctx(), one.id).status).toBe("open");
    });

    it("undoing the completion leaves a note that became a defect resolved", async () => {
      const { user, a, task } = await setup();
      const [turned, plain] = [note(a.id, "Wird Mangel"), note(a.id, "Bleibt")];
      const { completion } = await complete(task.id, user.id, {
        resolvedNoteIds: [turned.id, plain.id],
      });
      const { defect } = noteToDefect(ctx(), turned.id, user.id);
      await undoCompletion(ctx(), completion.id, user.id);
      expect(getNote(ctx(), turned.id)).toMatchObject({
        status: "resolved",
        defectId: defect.id,
      });
      expect(getNote(ctx(), plain.id).status).toBe("open");
    });

    it("undoing a completion without an entry touches no note", async () => {
      const { user, a, task } = await setup();
      const n = note(a.id);
      updateNote(ctx(), n.id, { status: "resolved" }, null);
      const { completion } = await complete(task.id, user.id, null);
      await undoCompletion(ctx(), completion.id, user.id);
      expect(getNote(ctx(), n.id).status).toBe("resolved");
    });

    it("a note that was reopened and resolved again by another entry stays resolved when the first completion is undone", async () => {
      const { user, a, task } = await setup();
      const n = note(a.id);
      const { completion } = await complete(task.id, user.id, {
        resolvedNoteIds: [n.id],
      });
      updateNote(ctx(), n.id, { status: "open" }, null);
      const later = entry(a.id, { resolvedNoteIds: [n.id] });
      await undoCompletion(ctx(), completion.id, user.id);
      expect(getNote(ctx(), n.id)).toMatchObject({
        status: "resolved",
        serviceLogId: later.id,
      });
    });
  });
});

const createCompletionLog = (over: Record<string, unknown>) =>
  completionServiceLogSchema.parse(over);
