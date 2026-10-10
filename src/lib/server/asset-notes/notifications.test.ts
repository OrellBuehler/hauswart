import { describe, expect, it } from "vitest";
import { createAssetNoteRequestSchema } from "$lib/api/schemas/asset-notes";
import { createAsset } from "$lib/server/assets/assets";
import { notifications } from "$lib/server/db";
import { createPreparation } from "$lib/server/tasks/preparations";
import { runEvaluationCycle } from "$lib/server/tasks/scheduler";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt, everyDays, makeTask } from "$lib/testing/domain";
import { createNote, updateNote } from "./notes";

describe("notices of a task whose asset has open notes", () => {
  const test = useTestDB();
  const ctx = (when: string, time = "07:00") => ctxAt(test.db, at(when, time));
  const rows = () => test.db.select().from(notifications).all();

  async function setup() {
    await createTestUser({ displayName: "Anna" });
    const asset = createAsset(ctx("2026-06-15"), {
      kind: "other",
      name: "Kombi",
      showOnEmergency: false,
    });
    const task = await makeTask(ctx("2026-06-15"), {
      title: "Service",
      assetId: asset.id,
      trigger: everyDays(30, "2026-06-20"),
    });
    const note = (body: string) =>
      createNote(
        ctx("2026-06-15"),
        asset.id,
        createAssetNoteRequestSchema.parse({ body }),
        null,
      );
    return { asset, task, note };
  }

  it("count the notes in the due soon and due notices", async () => {
    const { task, note } = await setup();
    note("Eins");
    note("Zwei");
    await runEvaluationCycle(ctx("2026-06-18"));
    const soon = rows().filter((r) => r.kind === "due_soon");
    expect(soon).toHaveLength(1);
    expect(soon[0]).toMatchObject({
      titleKey: "notification_due_soon_notes",
      paramsJson: { title: "Service", date: "2026-06-20", notes: 2 },
      taskId: task.id,
    });
    // A note that arrives later is counted in the notice of the next stage.
    note("Drei");
    await runEvaluationCycle(ctx("2026-06-20"));
    const due = rows().filter((r) => r.kind === "due");
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      titleKey: "notification_due_notes",
      paramsJson: { title: "Service", date: "2026-06-20", notes: 3 },
    });
  });

  it("keep the plain wording without open notes, or with resolved ones", async () => {
    const { note } = await setup();
    const n = note("Eins");
    updateNote(ctx("2026-06-15"), n.id, { status: "resolved" }, null);
    await runEvaluationCycle(ctx("2026-06-18"));
    expect(rows().find((r) => r.kind === "due_soon")).toMatchObject({
      titleKey: "notification_due_soon",
      paramsJson: { title: "Service", date: "2026-06-20" },
    });
  });

  it("do not change the other stages, and a stage is still announced once", async () => {
    const { task, note } = await setup();
    note("Eins");
    await createPreparation(ctx("2026-06-15"), task.id, {
      title: "Termin machen",
      kind: "generic",
      leadDays: 10,
      qty: 1,
    });
    await runEvaluationCycle(ctx("2026-06-15"));
    expect(rows().find((r) => r.kind === "prep")).toMatchObject({
      titleKey: "notification_prep",
    });
    await runEvaluationCycle(ctx("2026-06-18"));
    await runEvaluationCycle(ctx("2026-06-18", "09:00"));
    expect(rows().filter((r) => r.kind === "due_soon")).toHaveLength(1);
    await runEvaluationCycle(ctx("2026-06-27"));
    expect(rows().find((r) => r.kind === "overdue")).toMatchObject({
      titleKey: "notification_overdue",
    });
  });

  it("are not about tasks without an asset", async () => {
    await createTestUser();
    await makeTask(ctx("2026-06-15"), {
      title: "Frei",
      trigger: everyDays(30, "2026-06-20"),
    });
    await runEvaluationCycle(ctx("2026-06-18"));
    expect(rows()[0].titleKey).toBe("notification_due_soon");
  });
});
