import { access, utimes } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import type { PutTaskStepsRequest } from "$lib/api/schemas/task-steps";
import { putTaskStepsRequestSchema } from "$lib/api/schemas/task-steps";
import { createAsset } from "$lib/server/assets/assets";
import {
  createAttachment,
  deleteAttachment,
  settleBackgroundWork,
  type NewAttachment,
} from "$lib/server/attachments/attachments";
import { attachments, taskState, taskSteps, tasks } from "$lib/server/db";
import { plainPng } from "$lib/server/files/test-images";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt, makeTask, NOW } from "$lib/testing/domain";
import { samplePdf, useTestFilesDir } from "$lib/testing/files";
import { failure, fieldErrors } from "$lib/testing/vehicles";
import { getUpcomingTasks } from "./dashboard";
import {
  deleteTask,
  getTask,
  listTasks,
  updateTask,
  type TaskRecord,
} from "./tasks";
import { getTaskSteps, replaceTaskSteps } from "./steps";

const HOUR = 60 * 60 * 1000;
const present = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** The request as the API hands it to the service: parsed, defaults filled in. */
const put = (body: {
  steps: { id?: string; title: string; body?: string }[];
  source?: unknown;
}): PutTaskStepsRequest => putTaskStepsRequestSchema.parse(body);

describe("task steps", () => {
  const test = useTestDB();
  const files = useTestFilesDir();
  const ctx = (now = NOW) => ctxAt(test.db, now);
  /** Far enough ahead that files stored a moment ago count as old enough to sweep. */
  const later = () => ctxAt(test.db, Date.now() + HOUR);
  const task = (title = "Filter wechseln") => makeTask(ctx(), { title });

  async function picture(
    ownerId: string,
    extra: Partial<NewAttachment> = {},
    bytes: Uint8Array = plainPng(),
  ) {
    return createAttachment(ctx(), {
      bytes,
      filename: "schritt.png",
      ownerType: "task_step",
      ownerId,
      uploadedBy: null,
      ...extra,
    });
  }
  const idsOf = (taskId: string) =>
    getTaskSteps(ctx(), taskId).steps.map((s) => s.id);

  describe("reading", () => {
    it("a task starts without steps and without a source", async () => {
      const t = await task();
      expect(getTaskSteps(ctx(), t.id)).toEqual({
        steps: [],
        stepsSource: null,
        stepCount: 0,
      });
      expect(getTask(ctx(), t.id).stepCount).toBe(0);
    });

    it("is a 404 for a missing task", async () => {
      expect((await failure(() => getTaskSteps(ctx(), "nope"))).code).toBe(
        "not_found",
      );
    });
  });

  describe("replacing", () => {
    it("creates the steps in the order given, numbered from 0", async () => {
      const t = await task();
      const out = replaceTaskSteps(
        ctx(),
        t.id,
        put({
          steps: [
            { title: "Gerät ausschalten", body: "Netzstecker ziehen." },
            { title: "Abdeckung abnehmen" },
            { title: "Filter tauschen", body: "" },
          ],
        }),
      );
      expect(
        out.steps.map((s) => [s.position, s.title, s.body, s.images]),
      ).toEqual([
        [0, "Gerät ausschalten", "Netzstecker ziehen.", []],
        [1, "Abdeckung abnehmen", "", []],
        [2, "Filter tauschen", "", []],
      ]);
      expect(out.stepCount).toBe(3);
      expect(new Set(out.steps.map((s) => s.id)).size).toBe(3);
      expect(getTask(ctx(), t.id).stepCount).toBe(3);
      expect(getTaskSteps(ctx(), t.id)).toEqual(out);
    });

    it("keeps the id, the pictures and the creation time of a step the list names and takes its new text and place", async () => {
      const t = await task();
      const [a, b, c] = replaceTaskSteps(
        ctx(),
        t.id,
        put({ steps: [{ title: "A" }, { title: "B" }, { title: "C" }] }),
      ).steps;
      const shot = await picture(b!.id);

      const out = replaceTaskSteps(
        ctx(at("2026-07-01")),
        t.id,
        put({
          steps: [
            { id: c!.id, title: "C" },
            { id: b!.id, title: "B neu", body: "Mit Handschuhen." },
            { title: "D" },
          ],
        }),
      );

      expect(out.steps.map((s) => [s.position, s.title])).toEqual([
        [0, "C"],
        [1, "B neu"],
        [2, "D"],
      ]);
      expect(out.steps[0]!.id).toBe(c!.id);
      expect(out.steps[1]!.id).toBe(b!.id);
      expect(out.steps[1]!.body).toBe("Mit Handschuhen.");
      expect(out.steps[1]!.images.map((i) => i.id)).toEqual([shot.id]);
      expect(out.steps.map((s) => s.id)).not.toContain(a!.id);
      const row = test.db
        .select()
        .from(taskSteps)
        .where(eq(taskSteps.id, b!.id))
        .get()!;
      expect(row.createdAt.getTime()).toBe(NOW);
      expect(row.updatedAt.getTime()).toBe(at("2026-07-01"));
    });

    it("leaves a step that did not change as it is, updatedAt included", async () => {
      const t = await task();
      const [a, b] = replaceTaskSteps(
        ctx(),
        t.id,
        put({ steps: [{ title: "A" }, { title: "B", body: "x" }] }),
      ).steps;
      replaceTaskSteps(
        ctx(at("2026-07-01")),
        t.id,
        put({
          steps: [
            { id: a!.id, title: "A" },
            { id: b!.id, title: "B", body: "y" },
          ],
        }),
      );
      const updatedAt = (id: string) =>
        test.db
          .select()
          .from(taskSteps)
          .where(eq(taskSteps.id, id))
          .get()!
          .updatedAt.getTime();
      expect(updatedAt(a!.id)).toBe(NOW);
      expect(updatedAt(b!.id)).toBe(at("2026-07-01"));
    });

    it("reordering by id moves the pictures with their steps", async () => {
      const t = await task();
      const [a, b] = replaceTaskSteps(
        ctx(),
        t.id,
        put({ steps: [{ title: "A" }, { title: "B" }] }),
      ).steps;
      const onA = await picture(a!.id);
      const out = replaceTaskSteps(
        ctx(),
        t.id,
        put({
          steps: [
            { id: b!.id, title: "B" },
            { id: a!.id, title: "A" },
          ],
        }),
      );
      expect(out.steps.map((s) => s.title)).toEqual(["B", "A"]);
      expect(out.steps[1]!.images.map((i) => i.id)).toEqual([onA.id]);
    });

    it("deletes the steps the list leaves out together with their pictures, and keeps a stored file another owner still uses", async () => {
      const t = await task();
      const asset = createAsset(
        ctx(),
        createAssetRequestSchema.parse({ name: "Boiler" }),
      );
      const [a, b] = replaceTaskSteps(
        ctx(),
        t.id,
        put({ steps: [{ title: "A" }, { title: "B" }] }),
      ).steps;
      const gone = await picture(a!.id, {}, plainPng(40, 30));
      const shared = await picture(a!.id, {}, plainPng(50, 30));
      await createAttachment(ctx(), {
        bytes: plainPng(50, 30),
        filename: "gleich.png",
        ownerType: "asset",
        ownerId: asset.id,
        uploadedBy: null,
      });
      const kept = await picture(b!.id, {}, plainPng(60, 30));
      for (const row of [gone, shared, kept]) {
        const old = new Date(Date.now() - HOUR);
        await utimes(join(files.dir, row.path), old, old);
      }

      const out = replaceTaskSteps(
        later(),
        t.id,
        put({ steps: [{ id: b!.id, title: "B" }] }),
      );
      await settleBackgroundWork();

      expect(out.steps.map((s) => s.id)).toEqual([b!.id]);
      expect(test.db.select().from(taskSteps).all()).toHaveLength(1);
      expect(
        test.db
          .select({ id: attachments.id })
          .from(attachments)
          .where(eq(attachments.ownerType, "task_step"))
          .all()
          .map((r) => r.id),
      ).toEqual([kept.id]);
      expect(await present(join(files.dir, gone.path))).toBe(false);
      expect(await present(join(files.dir, shared.path))).toBe(true);
      expect(await present(join(files.dir, kept.path))).toBe(true);
    });

    it("an empty list removes every step", async () => {
      const t = await task();
      const [a] = replaceTaskSteps(
        ctx(),
        t.id,
        put({ steps: [{ title: "A" }] }),
      ).steps;
      await picture(a!.id);
      const out = replaceTaskSteps(later(), t.id, put({ steps: [] }));
      expect(out).toEqual({ steps: [], stepsSource: null, stepCount: 0 });
      expect(test.db.select().from(attachments).all()).toEqual([]);
      expect(getTask(ctx(), t.id).stepCount).toBe(0);
    });

    it("refuses an id that is no step of the task, and changes nothing", async () => {
      const t = await task();
      const other = await task("Anderes");
      const [mine] = replaceTaskSteps(
        ctx(),
        t.id,
        put({ steps: [{ title: "A" }] }),
      ).steps;
      const [theirs] = replaceTaskSteps(
        ctx(),
        other.id,
        put({ steps: [{ title: "Fremd" }] }),
      ).steps;

      for (const id of [theirs!.id, "missing"]) {
        const err = await failure(() =>
          replaceTaskSteps(
            ctx(),
            t.id,
            put({
              steps: [
                { id: mine!.id, title: "A neu" },
                { title: "Neu" },
                { id, title: "Gestohlen" },
              ],
              source: { label: "Anleitung" },
            }),
          ),
        );
        expect([err.code, fieldErrors(err, "steps").length]).toEqual([
          "invalid_request",
          1,
        ]);
      }
      expect(getTaskSteps(ctx(), t.id)).toMatchObject({
        steps: [{ id: mine!.id, title: "A" }],
        stepsSource: null,
      });
      expect(idsOf(other.id)).toEqual([theirs!.id]);
    });

    it("is a 404 for a missing task", async () => {
      expect(
        (
          await failure(() =>
            replaceTaskSteps(ctx(), "nope", put({ steps: [] })),
          )
        ).code,
      ).toBe("not_found");
    });

    it("also works on an archived task", async () => {
      const t = await task();
      await updateTask(ctx(), t.id, { archived: true });
      expect(
        replaceTaskSteps(ctx(), t.id, put({ steps: [{ title: "A" }] }))
          .stepCount,
      ).toBe(1);
    });

    it("does not touch the task: no update, no new evaluation", async () => {
      const t = await task();
      const before = {
        task: test.db.select().from(tasks).where(eq(tasks.id, t.id)).get()!,
        state: test.db
          .select()
          .from(taskState)
          .where(eq(taskState.taskId, t.id))
          .get()!,
      };
      replaceTaskSteps(
        ctx(at("2026-09-01")),
        t.id,
        put({
          steps: [{ title: "A" }],
          source: { label: "Anleitung", url: "https://docs.example.org/a" },
        }),
      );
      const after = test.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, t.id))
        .get()!;
      expect(after.updatedAt).toEqual(before.task.updatedAt);
      expect(after.stepsSource).toEqual({
        label: "Anleitung",
        url: "https://docs.example.org/a",
        attachmentId: null,
        page: null,
      });
      expect(
        test.db
          .select()
          .from(taskState)
          .where(eq(taskState.taskId, t.id))
          .get(),
      ).toEqual(before.state);
    });

    it("lists the pictures of a step in the order they were uploaded", async () => {
      const t = await task();
      const [step] = replaceTaskSteps(
        ctx(),
        t.id,
        put({ steps: [{ title: "A" }] }),
      ).steps;
      const first = await picture(step!.id, {}, plainPng(10, 10));
      const second = await picture(step!.id, {}, plainPng(11, 10));
      const third = await picture(step!.id, {}, plainPng(12, 10));
      expect(
        getTaskSteps(ctx(), t.id).steps[0]!.images.map((i) => i.id),
      ).toEqual([first.id, second.id, third.id]);
    });
  });

  describe("the source", () => {
    const source = (t: TaskRecord) => getTaskSteps(ctx(), t.id).stepsSource;

    it("is set with the steps, kept when left out, replaced as a whole and removed with null", async () => {
      const t = await task();
      replaceTaskSteps(
        ctx(),
        t.id,
        put({
          steps: [{ title: "A" }],
          source: {
            label: "Herstellerseite",
            url: "https://docs.example.org/filter",
          },
        }),
      );
      expect(source(t)).toEqual({
        label: "Herstellerseite",
        url: "https://docs.example.org/filter",
        attachmentId: null,
        page: null,
        attachment: null,
      });

      replaceTaskSteps(ctx(), t.id, put({ steps: [{ title: "A" }] }));
      expect(source(t)?.url).toBe("https://docs.example.org/filter");

      replaceTaskSteps(
        ctx(),
        t.id,
        put({ steps: [{ title: "A" }], source: { label: "Nur ein Name" } }),
      );
      expect(source(t)).toMatchObject({
        label: "Nur ein Name",
        url: null,
        attachmentId: null,
      });

      replaceTaskSteps(
        ctx(),
        t.id,
        put({ steps: [{ title: "A" }], source: null }),
      );
      expect(source(t)).toBeNull();
    });

    it("can point at a page of a file in hauswart and resolves it", async () => {
      const t = await task();
      const asset = createAsset(
        ctx(),
        createAssetRequestSchema.parse({ name: "Boiler" }),
      );
      const manual = await createAttachment(ctx(), {
        bytes: samplePdf(),
        filename: "anleitung.pdf",
        ownerType: "asset",
        ownerId: asset.id,
        uploadedBy: null,
      });
      replaceTaskSteps(
        ctx(),
        t.id,
        put({
          steps: [{ title: "A" }],
          source: { label: "Anleitung", attachmentId: manual.id, page: 12 },
        }),
      );
      expect(source(t)).toMatchObject({
        label: "Anleitung",
        url: null,
        attachmentId: manual.id,
        page: 12,
        attachment: { id: manual.id, filename: "anleitung.pdf" },
      });
    });

    it("is a 400 on source for a file that does not exist, and changes nothing", async () => {
      const t = await task();
      const err = await failure(() =>
        replaceTaskSteps(
          ctx(),
          t.id,
          put({
            steps: [{ title: "A" }],
            source: { attachmentId: "missing" },
          }),
        ),
      );
      expect(fieldErrors(err, "source")).toHaveLength(1);
      expect(getTaskSteps(ctx(), t.id).stepCount).toBe(0);
    });

    it("loses the file when it is deleted: id, page and attachment read as null, and with nothing else left the source is null", async () => {
      const t = await task();
      const labelled = await task("Mit Name");
      const asset = createAsset(
        ctx(),
        createAssetRequestSchema.parse({ name: "Boiler" }),
      );
      const manual = await createAttachment(ctx(), {
        bytes: samplePdf(),
        filename: "anleitung.pdf",
        ownerType: "asset",
        ownerId: asset.id,
        uploadedBy: null,
      });
      replaceTaskSteps(
        ctx(),
        t.id,
        put({ steps: [], source: { attachmentId: manual.id, page: 3 } }),
      );
      replaceTaskSteps(
        ctx(),
        labelled.id,
        put({
          steps: [],
          source: { label: "Anleitung", attachmentId: manual.id, page: 3 },
        }),
      );
      await deleteAttachment(ctx(), manual.id);
      expect(source(t)).toBeNull();
      expect(source(labelled)).toEqual({
        label: "Anleitung",
        url: null,
        attachmentId: null,
        page: null,
        attachment: null,
      });
    });
  });

  describe("task lists", () => {
    it("carry stepCount, and hasSteps filters on it", async () => {
      const withSteps = await task("Mit");
      const without = await task("Ohne");
      replaceTaskSteps(
        ctx(),
        withSteps.id,
        put({ steps: [{ title: "A" }, { title: "B" }] }),
      );
      const list = (hasSteps?: boolean) =>
        listTasks(ctx(), { hasSteps }, { limit: 50 }, "u").items.map(
          (t) => [t.title, t.stepCount] as const,
        );
      expect(list()).toEqual(
        expect.arrayContaining([
          ["Mit", 2],
          ["Ohne", 0],
        ]),
      );
      expect(list(true)).toEqual([["Mit", 2]]);
      expect(list(false)).toEqual([["Ohne", 0]]);
      expect(without.stepCount).toBe(0);
    });

    it("the dashboard's tasks carry stepCount", async () => {
      const t = await task();
      replaceTaskSteps(ctx(), t.id, put({ steps: [{ title: "A" }] }));
      const upcoming = await getUpcomingTasks(ctx());
      const entries = Object.values(upcoming.upcoming).flat();
      expect(entries.find((e) => e.taskId === t.id)?.stepCount).toBe(1);
    });
  });

  describe("deleting a task", () => {
    it("removes its steps and the pictures of its steps, whose rows have no foreign key to follow", async () => {
      const t = await task();
      const keep = await task("Bleibt");
      const [a, b] = replaceTaskSteps(
        ctx(),
        t.id,
        put({ steps: [{ title: "A" }, { title: "B" }] }),
      ).steps;
      const [other] = replaceTaskSteps(
        ctx(),
        keep.id,
        put({ steps: [{ title: "Anders" }] }),
      ).steps;
      const pictures = [
        await picture(a!.id, {}, plainPng(20, 20)),
        await picture(b!.id, {}, plainPng(21, 20)),
      ];
      const remaining = await picture(other!.id, {}, plainPng(22, 20));
      for (const row of [...pictures, remaining]) {
        const old = new Date(Date.now() - HOUR);
        await utimes(join(files.dir, row.path), old, old);
      }

      deleteTask(later(), t.id);
      await settleBackgroundWork();

      expect(
        test.db
          .select()
          .from(taskSteps)
          .all()
          .map((r) => r.id),
      ).toEqual([other!.id]);
      expect(
        test.db
          .select({ id: attachments.id })
          .from(attachments)
          .all()
          .map((r) => r.id),
      ).toEqual([remaining.id]);
      for (const row of pictures) {
        expect(await present(join(files.dir, row.path))).toBe(false);
      }
      expect(await present(join(files.dir, remaining.path))).toBe(true);
    });
  });
});
