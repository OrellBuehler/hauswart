import { describe, expect, it } from "vitest";
import { createAssetNoteRequestSchema } from "$lib/api/schemas/asset-notes";
import { createAsset } from "$lib/server/assets/assets";
import { getDashboard } from "$lib/server/tasks/dashboard";
import { getTask, listTasks } from "$lib/server/tasks/tasks";
import { useTestDB } from "$lib/testing/db";
import { ctxAt, everyDays, makeTask } from "$lib/testing/domain";
import { createNote, updateNote } from "./notes";

describe("open notes on a task's asset", () => {
  const test = useTestDB();
  const ctx = () => ctxAt(test.db);
  const asset = (name: string) =>
    createAsset(ctx(), { kind: "other", name, showOnEmergency: false });
  const note = (assetId: string, body = "Bremsen quietschen") =>
    createNote(
      ctx(),
      assetId,
      createAssetNoteRequestSchema.parse({ body }),
      null,
    );

  it("counts the open notes of the asset, per task", async () => {
    const [kombi, boiler] = [await asset("Kombi"), await asset("Boiler")];
    const service = await makeTask(ctx(), {
      title: "Service",
      assetId: kombi.id,
    });
    const other = await makeTask(ctx(), {
      title: "Entkalken",
      assetId: boiler.id,
    });
    const loose = await makeTask(ctx(), { title: "Ohne Gerät" });
    expect(getTask(ctx(), service.id).openNoteCount).toBe(0);
    const [a] = [note(kombi.id, "Eins"), note(kombi.id, "Zwei")];
    note(boiler.id, "Tropft");
    expect(getTask(ctx(), service.id).openNoteCount).toBe(2);
    expect(getTask(ctx(), other.id).openNoteCount).toBe(1);
    expect(getTask(ctx(), loose.id).openNoteCount).toBe(0);
    updateNote(ctx(), a.id, { status: "resolved" }, null);
    expect(getTask(ctx(), service.id).openNoteCount).toBe(1);
    updateNote(ctx(), a.id, { status: "open" }, null);
    expect(getTask(ctx(), service.id).openNoteCount).toBe(2);
  });

  it("is on every listed task", async () => {
    const kombi = await asset("Kombi");
    await makeTask(ctx(), { title: "Service", assetId: kombi.id });
    await makeTask(ctx(), { title: "Frei" });
    note(kombi.id);
    const { items } = listTasks(ctx(), {}, { limit: 50 }, "nobody");
    expect(
      Object.fromEntries(items.map((t) => [t.title, t.openNoteCount])),
    ).toEqual({ Service: 1, Frei: 0 });
  });

  it("is on the dashboard's tasks", async () => {
    const kombi = await asset("Kombi");
    await makeTask(ctx(), {
      title: "Service",
      assetId: kombi.id,
      trigger: everyDays(30, "2026-06-15"),
    });
    await makeTask(ctx(), {
      title: "Frei",
      trigger: everyDays(30, "2026-06-15"),
    });
    note(kombi.id, "Eins");
    note(kombi.id, "Zwei");
    const { upcoming } = await getDashboard(ctx());
    const tasks = Object.values(upcoming).flat();
    expect(
      Object.fromEntries(tasks.map((t) => [t.title, t.openNoteCount])),
    ).toEqual({ Service: 2, Frei: 0 });
  });
});
