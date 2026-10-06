import { describe, expect, it } from "vitest";
import { createAsset, deleteAsset } from "$lib/server/assets/assets";
import { createContact, deleteContact } from "$lib/server/contacts/contacts";
import { createContactRequestSchema } from "$lib/api/schemas/contacts";
import {
  completionServiceLogSchema,
  createServiceLogRequestSchema,
} from "$lib/api/schemas/service-log";
import { updateHousehold } from "$lib/server/household/household";
import { completeTask } from "$lib/server/tasks/completions";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt, makeTask } from "$lib/testing/domain";
import {
  checkCompletionLog,
  createEntry,
  deleteEntry,
  entryOfCompletion,
  getAssetEntry,
  getEntry,
  listAssetEntries,
  listServiceLog,
  logCompletion,
  updateEntry,
} from "./service-log";

describe("service log", () => {
  const test = useTestDB();
  const ctx = (now?: number) => ctxAt(test.db, now);
  const page = { limit: 50 };
  const asset = (name = "Boiler") =>
    createAsset(ctx(), { kind: "device", name, showOnEmergency: false });
  const entry = (
    assetId: string,
    over: Record<string, unknown> = {},
    now?: number,
    user: string | null = null,
  ) =>
    createEntry(
      ctx(now),
      assetId,
      createServiceLogRequestSchema.parse({ title: "Entkalkt", ...over }),
      user,
    );

  it("creates with defaults: today's date, maintenance, no cost", async () => {
    const user = await createTestUser();
    const a = asset();
    expect(entry(a.id, {}, undefined, user.id)).toMatchObject({
      assetId: a.id,
      assetName: "Boiler",
      date: "2026-06-15",
      kind: "maintenance",
      title: "Entkalkt",
      descriptionMd: "",
      contactId: null,
      contactName: null,
      completionId: null,
      costMinor: null,
      currency: null,
      costEntryId: null,
      performedBy: null,
      createdBy: user.id,
      commentCount: 0,
    });
  });

  it("gives a cost the household currency unless one is given", () => {
    updateHousehold(ctx(), { currency: "EUR" });
    const a = asset();
    expect(entry(a.id, { costMinor: 12000 })).toMatchObject({
      costMinor: 12000,
      currency: "EUR",
    });
    expect(entry(a.id, { costMinor: 500, currency: "CHF" })).toMatchObject({
      currency: "CHF",
    });
    expect(entry(a.id, { currency: "CHF" })).toMatchObject({
      costMinor: null,
      currency: null,
    });
  });

  it("names the contact and rejects an unknown one", () => {
    const a = asset();
    const c = createContact(
      ctx(),
      createContactRequestSchema.parse({ name: "Muster AG" }),
    );
    expect(entry(a.id, { contactId: c.id })).toMatchObject({
      contactId: c.id,
      contactName: "Muster AG",
    });
    expect(() => entry(a.id, { contactId: "nope" })).toThrow(/Invalid request/);
  });

  it("answers 404 for an unknown asset", () => {
    expect(() => entry("nope")).toThrow(/Asset not found/);
    expect(() => listAssetEntries(ctx(), "nope", {}, page)).toThrow(
      /not found/i,
    );
    expect(() => getEntry(ctx(), "nope")).toThrow(/not found/i);
  });

  it("updates fields, the cost and clears the contact", () => {
    const a = asset();
    const c = createContact(
      ctx(),
      createContactRequestSchema.parse({ name: "Muster AG" }),
    );
    const e = entry(a.id, { contactId: c.id, costMinor: 1000 });
    const updated = updateEntry(ctx(), a.id, e.id, {
      title: "Neu",
      kind: "repair",
      contactId: null,
      costMinor: 2500,
      date: "2026-05-01",
    });
    expect(updated).toMatchObject({
      title: "Neu",
      kind: "repair",
      contactId: null,
      contactName: null,
      costMinor: 2500,
      currency: "CHF",
      date: "2026-05-01",
    });
    expect(updateEntry(ctx(), a.id, e.id, { costMinor: null })).toMatchObject({
      costMinor: null,
      currency: null,
    });
    expect(
      updateEntry(ctx(), a.id, e.id, { costMinor: 100, currency: "EUR" }),
    ).toMatchObject({ costMinor: 100, currency: "EUR" });
    expect(() => updateEntry(ctx(), a.id, e.id, { contactId: "nope" })).toThrow(
      /Invalid request/,
    );
  });

  it("treats an entry of another asset as not found", () => {
    const a = asset();
    const b = asset("Ofen");
    const e = entry(a.id);
    expect(() => getAssetEntry(ctx(), b.id, e.id)).toThrow(/not found/i);
    expect(() => updateEntry(ctx(), b.id, e.id, { title: "x" })).toThrow(
      /not found/i,
    );
    expect(() => deleteEntry(ctx(), b.id, e.id)).toThrow(/not found/i);
    deleteEntry(ctx(), a.id, e.id);
    expect(() => getEntry(ctx(), e.id)).toThrow(/not found/i);
  });

  it("lists newest first across assets, filters and pages", () => {
    const a = asset();
    const b = asset("Ofen");
    entry(a.id, { title: "alt", date: "2026-01-01" });
    entry(b.id, { title: "mitte", date: "2026-03-01", kind: "repair" });
    entry(a.id, { title: "neu", date: "2026-05-01" });
    entry(a.id, { title: "neuer eingetragen", date: "2026-05-01" });
    const titles = (f = {}, p = page) =>
      listServiceLog(ctx(), f, p).items.map((e) => e.title);
    expect(titles()).toEqual(["neuer eingetragen", "neu", "mitte", "alt"]);
    expect(titles({ assetId: a.id })).toEqual([
      "neuer eingetragen",
      "neu",
      "alt",
    ]);
    expect(titles({ kind: "repair" })).toEqual(["mitte"]);
    expect(titles({ from: "2026-02-01", to: "2026-04-01" })).toEqual(["mitte"]);
    expect(
      listAssetEntries(ctx(), a.id, { kind: "maintenance" }, page).items,
    ).toHaveLength(3);
    const first = listServiceLog(ctx(), {}, { limit: 3 });
    const second = listServiceLog(
      ctx(),
      {},
      { limit: 3, cursor: first.nextCursor! },
    );
    expect(first.items.map((e) => e.title)).toEqual([
      "neuer eingetragen",
      "neu",
      "mitte",
    ]);
    expect(second.items.map((e) => e.title)).toEqual(["alt"]);
    expect(second.nextCursor).toBeNull();
  });

  it("deleting the asset removes its log, deleting the contact keeps the entries", () => {
    const a = asset();
    const c = createContact(
      ctx(),
      createContactRequestSchema.parse({ name: "Muster AG" }),
    );
    const e = entry(a.id, { contactId: c.id });
    deleteContact(ctx(), c.id);
    expect(getEntry(ctx(), e.id)).toMatchObject({
      contactId: null,
      contactName: null,
    });
    deleteAsset(ctx(), a.id);
    expect(listServiceLog(ctx(), {}, page).items).toEqual([]);
  });

  describe("with a completion", () => {
    const done = async (taskId: string) =>
      (
        await completeTask(ctx(), taskId, {
          kind: "done",
          source: "manual",
          userId: null,
        })
      ).completion;

    it("logs the work under the task's title on the completion's date", async () => {
      const a = asset();
      const task = await makeTask(ctx(), { title: "Entkalken", assetId: a.id });
      const completion = await done(task.id);
      const input = completionServiceLogSchema.parse({
        kind: "maintenance",
        costMinor: 8000,
      });
      const e = logCompletion(
        ctx(),
        completion.id,
        { assetId: a.id, title: task.title },
        input,
        completion.completedDate,
        null,
      );
      expect(e).toMatchObject({
        title: "Entkalken",
        date: "2026-06-15",
        completionId: completion.id,
        costMinor: 8000,
      });
      expect(entryOfCompletion(ctx(), completion.id)?.id).toBe(e.id);
    });

    it("uses the given title and details", async () => {
      const a = asset();
      const task = await makeTask(ctx(), { title: "Entkalken", assetId: a.id });
      const completion = await done(task.id);
      const input = completionServiceLogSchema.parse({
        kind: "inspection",
        title: "Prüfung",
        descriptionMd: "ok",
      });
      expect(
        logCompletion(
          ctx(),
          completion.id,
          { assetId: a.id, title: task.title },
          input,
          completion.completedDate,
          null,
        ),
      ).toMatchObject({
        kind: "inspection",
        title: "Prüfung",
        descriptionMd: "ok",
      });
    });

    it("writes one entry per completion", async () => {
      const a = asset();
      const task = await makeTask(ctx(), { assetId: a.id });
      const completion = await done(task.id);
      const input = completionServiceLogSchema.parse({});
      const first = logCompletion(
        ctx(),
        completion.id,
        { assetId: a.id, title: "T" },
        input,
        completion.completedDate,
        null,
      );
      const second = logCompletion(
        ctx(),
        completion.id,
        { assetId: a.id, title: "T" },
        input,
        completion.completedDate,
        null,
      );
      expect(second.id).toBe(first.id);
      expect(listServiceLog(ctx(), {}, page).items).toHaveLength(1);
    });

    it("refuses tasks without an asset and unknown contacts before anything is written", async () => {
      const task = await makeTask(ctx());
      const input = completionServiceLogSchema.parse({});
      expect(() => checkCompletionLog(ctx(), task, input)).toThrow(
        /Invalid request/,
      );
      const a = asset();
      expect(() =>
        checkCompletionLog(
          ctx(),
          { assetId: a.id },
          completionServiceLogSchema.parse({ contactId: "nope" }),
        ),
      ).toThrow(/Invalid request/);
      expect(checkCompletionLog(ctx(), { assetId: a.id }, input)).toBe(a.id);
    });

    it("an entry outlives its completion's task", async () => {
      const a = asset();
      const task = await makeTask(ctx(), { assetId: a.id });
      const completion = await done(task.id);
      const e = logCompletion(
        ctx(at("2026-06-16")),
        completion.id,
        { assetId: a.id, title: "T" },
        completionServiceLogSchema.parse({}),
        "2026-06-15",
        null,
      );
      const { deleteTask } = await import("$lib/server/tasks/tasks");
      deleteTask(ctx(), task.id);
      expect(getEntry(ctx(), e.id)).toMatchObject({ completionId: null });
    });
  });
});
