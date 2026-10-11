import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { assetNotes, assets, defects, serviceLog, users } from "$lib/server/db";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";

describe("asset notes table", () => {
  const test = useTestDB();

  async function fixture() {
    const db = test.db;
    const user = await createTestUser();
    const asset = db
      .insert(assets)
      .values({ name: "Kombi", slug: "kombi", qrSlug: "qrkombi001" })
      .returning()
      .get();
    const entry = db
      .insert(serviceLog)
      .values({
        assetId: asset.id,
        title: "Service",
        kind: "maintenance",
        date: "2026-06-01",
      })
      .returning()
      .get();
    const defect = db
      .insert(defects)
      .values({ number: 1, title: "Quietschen", discoveredOn: "2026-06-01" })
      .returning()
      .get();
    const note = db
      .insert(assetNotes)
      .values({
        assetId: asset.id,
        body: "Bremsen quietschen",
        status: "resolved",
        resolvedAt: new Date(),
        resolvedBy: user.id,
        serviceLogId: entry.id,
        defectId: defect.id,
        createdBy: user.id,
      })
      .returning()
      .get();
    return { user, asset, entry, defect, note };
  }

  const reload = (id: string) =>
    test.db.select().from(assetNotes).where(eq(assetNotes.id, id)).get();

  it("starts open, without a resolver or a link", () => {
    const asset = test.db
      .insert(assets)
      .values({ name: "Kombi", slug: "kombi", qrSlug: "qrkombi001" })
      .returning()
      .get();
    const note = test.db
      .insert(assetNotes)
      .values({ assetId: asset.id, body: "Bremsen quietschen" })
      .returning()
      .get();
    expect(note).toMatchObject({
      status: "open",
      resolvedAt: null,
      resolvedBy: null,
      serviceLogId: null,
      defectId: null,
      createdBy: null,
    });
  });

  it("goes with its asset", async () => {
    const { asset, note } = await fixture();
    test.db.delete(assets).where(eq(assets.id, asset.id)).run();
    expect(reload(note.id)).toBeUndefined();
  });

  it("stays, with the link cleared, when the entry or the defect it points at is deleted", async () => {
    const { entry, defect, note } = await fixture();
    test.db.delete(serviceLog).where(eq(serviceLog.id, entry.id)).run();
    expect(reload(note.id)).toMatchObject({
      status: "resolved",
      serviceLogId: null,
      defectId: defect.id,
    });
    test.db.delete(defects).where(eq(defects.id, defect.id)).run();
    expect(reload(note.id)).toMatchObject({
      status: "resolved",
      defectId: null,
    });
  });

  it("stays when the people behind it are deleted", async () => {
    const { user, note } = await fixture();
    test.db.delete(users).where(eq(users.id, user.id)).run();
    expect(reload(note.id)).toMatchObject({
      createdBy: null,
      resolvedBy: null,
    });
  });
});
