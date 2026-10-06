import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  getConnectionRow,
  saveConnection,
} from "$lib/server/connections/connections";
import {
  connections,
  documentLinks,
  externalDocumentSync,
  externalDocuments,
} from "$lib/server/db";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { makeAsset } from "$lib/testing/documents";
import { syncAll, syncConnection } from "./sync";
import { useFakePaperless } from "./testing";

const T0 = Date.parse("2026-10-01T12:00:00Z");
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const CONFIG = {
  sharedTagIds: [1],
  receiptTagIds: [2],
  manualTagIds: [3],
  warrantyFieldId: 7,
  warrantyExtendedFieldId: 8,
};

describe("Paperless document sync", () => {
  const test = useTestDB();
  const { fake, connect } = useFakePaperless();
  const ctx = (now = T0) => ({ db: test.db, now });
  afterEach(() => vi.restoreAllMocks());

  function seed() {
    fake.tags = [
      { id: 1, name: "Apartment" },
      { id: 2, name: "Receipt" },
      { id: 3, name: "Manual" },
      { id: 4, name: "Private" },
    ];
    fake.correspondents = [{ id: 20, name: "Example Shop" }];
    fake.customFields = [
      { id: 7, name: "Warranty until", data_type: "date" },
      { id: 8, name: "Warranty extended", data_type: "date" },
    ];
  }

  const rows = (connectionId: string) =>
    test.db
      .select()
      .from(externalDocuments)
      .where(eq(externalDocuments.connectionId, connectionId))
      .all()
      .sort((a, b) => a.externalId - b.externalId);

  async function setup(config: Record<string, unknown> = CONFIG) {
    const user = await createTestUser();
    const row = connect(user.id, { config });
    seed();
    return { user, row };
  }

  it("reads the documents with a tag of the scope and keeps what the household needs of them", async () => {
    const { row } = await setup();
    fake.addDoc({
      id: 10,
      title: "Dishwasher receipt",
      tags: [2, 4],
      correspondent: 20,
      created: "2026-03-04",
      page_count: 2,
      custom_fields: [
        { field: 7, value: "2028-03-04" },
        { field: 8, value: "2029-03-04" },
        { field: 99, value: "ignored" },
      ],
      notes: [{ id: 1, note: "x", created: "2026-03-05", user: 1 }],
    });
    fake.addDoc({ id: 11, title: "Boiler manual", tags: [3] });
    fake.addDoc({ id: 12, title: "Lease", tags: [1] });
    fake.addDoc({ id: 13, title: "Private letter", tags: [4] });
    fake.addDoc({ id: 14, title: "Untagged" });

    const result = await syncConnection(ctx(), row);
    expect(result).toMatchObject({ status: "ok", full: true, stored: 3 });
    const stored = rows(row.id);
    expect(stored.map((r) => r.externalId)).toEqual([10, 11, 12]);
    expect(stored[0]).toMatchObject({
      provider: "paperless",
      title: "Dishwasher receipt",
      createdDate: "2026-03-04",
      correspondentId: 20,
      correspondentName: "Example Shop",
      tagIds: [2, 4],
      tagNames: ["Receipt", "Private"],
      mimeType: "application/pdf",
      pageCount: 2,
      noteCount: 1,
      ownerVisible: true,
      customFieldsJson: {
        warrantyUntil: "2028-03-04",
        warrantyExtendedUntil: "2029-03-04",
      },
    });
    expect(stored[2].customFieldsJson).toEqual({
      warrantyUntil: null,
      warrantyExtendedUntil: null,
    });
    expect(getConnectionRow(ctx(), "paperless", row.userId!)).toMatchObject({
      status: "ok",
      consecutiveFailures: 0,
    });
    // The request carries the person's own token and only the fields the list needs (no OCR text).
    const list = fake.requestsTo("/api/documents/", "GET")[0];
    expect(list.headers.get("authorization")).toBe(`Token ${fake.token}`);
    expect(list.query.get("fields")).not.toContain("content");
    expect(list.query.get("tags__id__in")).toBe("1,2,3");
  });

  it("without a scope nothing is read but linked documents, and the connection is still checked", async () => {
    const { row } = await setup({});
    fake.addDoc({ id: 10, tags: [1] });
    expect(await syncConnection(ctx(), row)).toMatchObject({
      status: "ok",
      stored: 0,
    });
    expect(rows(row.id)).toEqual([]);
  });

  describe("incremental", () => {
    it("asks only for documents changed since the newest one seen", async () => {
      const { row } = await setup();
      fake.addDoc({ id: 10, title: "Old", tags: [1] });
      fake.addDoc({
        id: 11,
        title: "Newer",
        tags: [1],
        modified: "2026-09-10T08:00:00+00:00",
      });
      await syncConnection(ctx(), row);
      fake.requests = [];

      fake.addDoc({
        id: 12,
        title: "Added later",
        tags: [1],
        modified: "2026-09-20T08:00:00+00:00",
      });
      fake.docs.get(10)!.title = "Old but not touched";
      const result = await syncConnection(ctx(T0 + 30 * MIN), row);
      // The newest document seen is read again (a second of overlap), the new one is added.
      expect(result).toMatchObject({ status: "ok", full: false, stored: 2 });
      const asked = fake.requestsTo("/api/documents/", "GET")[0];
      expect(asked.query.get("modified__gt")).toBe("2026-09-10T07:59:59.000Z");
      expect(asked.query.get("ordering")).toBe("modified");
      expect(rows(row.id).map((r) => [r.externalId, r.title])).toEqual([
        [10, "Old"],
        [11, "Newer"],
        [12, "Added later"],
      ]);
    });

    it("picks up a change to a document that is already cached", async () => {
      const { row } = await setup();
      fake.addDoc({ id: 10, title: "Receipt", tags: [2] });
      await syncConnection(ctx(), row);
      const doc = fake.docs.get(10)!;
      doc.modified = "2026-09-25T08:00:00+00:00";
      doc.custom_fields = [{ field: 7, value: "2030-01-01" }];
      doc.title = "Receipt (corrected)";
      await syncConnection(ctx(T0 + 30 * MIN), row);
      expect(rows(row.id)[0]).toMatchObject({
        title: "Receipt (corrected)",
        customFieldsJson: { warrantyUntil: "2030-01-01" },
      });
    });

    it("reads everything again once a day, which drops what left the scope or the account's view", async () => {
      const { row } = await setup();
      fake.addDoc({ id: 10, tags: [1] });
      fake.addDoc({ id: 11, tags: [1] });
      fake.addDoc({ id: 12, tags: [1] });
      await syncConnection(ctx(), row);
      fake.docs.get(10)!.tags = [4];
      fake.docs.delete(11);
      const quick = await syncConnection(ctx(T0 + 30 * MIN), row);
      expect(quick).toMatchObject({ full: false, removed: 0 });
      expect(rows(row.id)).toHaveLength(3);

      const daily = await syncConnection(ctx(T0 + DAY + MIN), row);
      expect(daily).toMatchObject({ full: true, removed: 2 });
      expect(rows(row.id).map((r) => r.externalId)).toEqual([12]);
    });

    it("reads everything again when the scope or the warranty fields change", async () => {
      const { user, row } = await setup();
      fake.addDoc({ id: 10, tags: [1] });
      fake.addDoc({ id: 11, tags: [4] });
      await syncConnection(ctx(), row);
      const changed = saveConnection(ctx(), "paperless", user.id, {
        baseUrl: row.baseUrl,
        allowInsecureTls: false,
        config: { ...CONFIG, sharedTagIds: [1, 4] },
      });
      const result = await syncConnection(ctx(T0 + MIN), changed);
      expect(result).toMatchObject({ full: true, stored: 2 });
      expect(rows(row.id).map((r) => r.externalId)).toEqual([10, 11]);
    });

    it("forgets the cache of another address", async () => {
      const { user, row } = await setup();
      fake.addDoc({ id: 10, title: "Here", tags: [1] });
      await syncConnection(ctx(), row);
      fake.prefix = "/paperless";
      const moved = saveConnection(ctx(), "paperless", user.id, {
        baseUrl: fake.baseUrl,
        token: fake.token,
        allowInsecureTls: false,
      });
      fake.docs.clear();
      fake.addDoc({ id: 77, title: "There", tags: [1] });
      const result = await syncConnection(ctx(T0 + MIN), moved);
      expect(result).toMatchObject({ full: true, removed: 1 });
      expect(rows(row.id).map((r) => r.externalId)).toEqual([77]);
    });
  });

  describe("linked documents", () => {
    it("are read whatever their tags are, and kept without content when the account cannot see them", async () => {
      const { user, row } = await setup();
      fake.strictPermissions = true;
      fake.addDoc({ id: 10, title: "Not in scope", tags: [4], owner: null });
      fake.addDoc({ id: 11, title: "Secret", tags: [4], owner: 99 });
      const asset = makeAsset(ctx());
      for (const externalId of [10, 11, 12]) {
        test.db
          .insert(documentLinks)
          .values({
            provider: "paperless",
            externalId,
            connectionId: row.id,
            ownerType: "asset",
            ownerId: asset.id,
            role: "other",
            createdBy: user.id,
          })
          .run();
      }
      const result = await syncConnection(ctx(), row);
      expect(result).toMatchObject({ status: "ok", stored: 1, hidden: 2 });
      expect(
        rows(row.id).map((r) => [r.externalId, r.title, r.ownerVisible]),
      ).toEqual([
        [10, "Not in scope", true],
        [11, "", false],
        [12, "", false],
      ]);
    });

    it("are read again at every run, so a change to a linked document shows at once", async () => {
      const { user, row } = await setup();
      fake.addDoc({ id: 10, title: "Before", tags: [4] });
      const asset = makeAsset(ctx());
      test.db
        .insert(documentLinks)
        .values({
          provider: "paperless",
          externalId: 10,
          connectionId: row.id,
          ownerType: "asset",
          ownerId: asset.id,
          role: "other",
          createdBy: user.id,
        })
        .run();
      await syncConnection(ctx(), row);
      fake.docs.get(10)!.title = "After";
      // Same modification instant: only the link refresh can notice.
      await syncConnection(ctx(T0 + MIN), row);
      expect(rows(row.id)[0].title).toBe("After");
    });

    it("of a connection at another address are not asked for", async () => {
      const { user, row } = await setup();
      fake.addDoc({ id: 10, title: "Same id elsewhere", tags: [4] });
      const asset = makeAsset(ctx());
      const other = test.db
        .insert(connections)
        .values({
          kind: "paperless",
          userId: (await createTestUser()).id,
          baseUrl: "https://elsewhere.example.org",
          tokenEnc: "x",
        })
        .returning()
        .get();
      test.db
        .insert(documentLinks)
        .values({
          provider: "paperless",
          externalId: 10,
          connectionId: other.id,
          ownerType: "asset",
          ownerId: asset.id,
          role: "other",
          createdBy: user.id,
        })
        .run();
      await syncConnection(ctx(), row);
      expect(rows(row.id)).toEqual([]);
    });
  });

  describe("each person reads with their own account", () => {
    it("caches what that account sees and nothing of the other's private documents", async () => {
      const [a, b] = [await createTestUser(), await createTestUser()];
      fake.addAccount("token-b", { id: 2, username: "second", groups: [50] });
      const rowA = connect(a.id, { config: CONFIG });
      const rowB = connect(b.id, { token: "token-b", config: CONFIG });
      seed();
      fake.strictPermissions = true;
      fake.addDoc({ id: 10, title: "Shared lease", tags: [1], owner: 1 });
      fake.docs.get(10)!.permissions.view.groups = [50];
      fake.addDoc({
        id: 11,
        title: "A's private receipt",
        tags: [2],
        owner: 1,
      });
      fake.addDoc({
        id: 12,
        title: "B's private receipt",
        tags: [2],
        owner: 2,
      });

      await syncAll(ctx());
      expect(rows(rowA.id).map((r) => r.title)).toEqual([
        "Shared lease",
        "A's private receipt",
      ]);
      expect(rows(rowB.id).map((r) => r.title)).toEqual([
        "Shared lease",
        "B's private receipt",
      ]);
      const tokens = fake
        .requestsTo("/api/documents/", "GET")
        .map((r) => r.headers.get("authorization"));
      expect(new Set(tokens)).toEqual(
        new Set([`Token ${fake.token}`, "Token token-b"]),
      );
    });

    it("skips switched-off connections", async () => {
      const user = await createTestUser();
      connect(user.id, { config: CONFIG, enabled: false });
      expect((await syncAll(ctx())).size).toBe(0);
      expect(fake.requests).toEqual([]);
    });
  });

  describe("failures", () => {
    it("are recorded on the connection and back off, 1 minute after the first", async () => {
      const user = await createTestUser();
      const row = connect(user.id, { token: "wrong-token", config: CONFIG });
      seed();
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const first = await syncConnection(ctx(), row);
      expect(first).toEqual({
        status: "failed",
        code: "unauthorized",
        failures: 1,
      });
      expect(getConnectionRow(ctx(), "paperless", user.id)).toMatchObject({
        status: "error",
        lastError: "unauthorized",
        consecutiveFailures: 1,
      });
      const failing = getConnectionRow(ctx(), "paperless", user.id)!;
      expect(await syncConnection(ctx(T0 + 30_000), failing)).toEqual({
        status: "backoff",
      });
      expect(await syncConnection(ctx(T0 + 61_000), failing)).toMatchObject({
        status: "failed",
        failures: 2,
      });
      expect(
        await syncConnection(
          ctx(T0 + 62_000),
          getConnectionRow(ctx(), "paperless", user.id)!,
          {
            ignoreBackoff: true,
          },
        ),
      ).toMatchObject({ status: "failed", failures: 3 });
    });

    it("do not touch the cache, and a later success clears the error", async () => {
      const { user, row } = await setup();
      fake.addDoc({ id: 10, title: "Kept", tags: [1] });
      await syncConnection(ctx(), row);
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      fake.failNext("/api/documents/", 500);
      const failed = await syncConnection(
        ctx(T0 + DAY + MIN),
        getConnectionRow(ctx(), "paperless", user.id)!,
      );
      expect(failed.status).toBe("failed");
      expect(rows(row.id)).toHaveLength(1);
      const ok = await syncConnection(
        ctx(T0 + DAY + 20 * MIN),
        getConnectionRow(ctx(), "paperless", user.id)!,
        { ignoreBackoff: true },
      );
      expect(ok.status).toBe("ok");
      expect(getConnectionRow(ctx(), "paperless", user.id)).toMatchObject({
        status: "ok",
        lastError: null,
        consecutiveFailures: 0,
      });
    });

    it("never put the token or a response into the log", async () => {
      const user = await createTestUser();
      const row = connect(user.id, {
        token: "very-secret-token",
        config: CONFIG,
      });
      const log = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      await syncConnection(ctx(), row);
      const logged = JSON.stringify(log.mock.calls);
      expect(logged).toContain("paperless.sync_failed");
      expect(logged).not.toContain("very-secret-token");
      expect(logged).not.toContain("Invalid token");
    });
  });

  it("removes the cache with the connection, but not the links", async () => {
    const { user, row } = await setup();
    fake.addDoc({ id: 10, tags: [1] });
    await syncConnection(ctx(), row);
    expect(rows(row.id)).toHaveLength(1);
    const asset = makeAsset(ctx());
    test.db
      .insert(documentLinks)
      .values({
        provider: "paperless",
        externalId: 10,
        connectionId: row.id,
        ownerType: "asset",
        ownerId: asset.id,
        role: "other",
        createdBy: user.id,
      })
      .run();
    test.db.delete(connections).where(eq(connections.userId, user.id)).run();
    expect(test.db.select().from(externalDocuments).all()).toEqual([]);
    expect(test.db.select().from(externalDocumentSync).all()).toEqual([]);
    // The household's links outlive the person's connection.
    expect(
      test.db
        .select()
        .from(documentLinks)
        .all()
        .map((l) => [l.externalId, l.connectionId]),
    ).toEqual([[10, null]]);
  });
});
