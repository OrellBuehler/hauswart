import { describe, expect, it } from "vitest";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import {
  cacheDocument,
  linkDocument,
  makeAsset,
  makeConnection,
} from "$lib/testing/documents";
import { searchLinkedDocuments } from "./search";

describe("search over linked documents", () => {
  const test = useTestDB();
  const ctx = () => ({ db: test.db });

  async function setup() {
    const user = await createTestUser();
    const connection = makeConnection(test.db, user.id);
    const asset = makeAsset(ctx(), { name: "Boiler" });
    return { user, connection, asset };
  }

  it("finds linked documents by every word of the title, never by anything else", async () => {
    const { user, connection, asset } = await setup();
    cacheDocument(test.db, connection.id, 1, {
      title: "Boiler service contract",
      correspondentName: "Acme Heating",
    });
    linkDocument(test.db, { externalId: 1, ownerId: asset.id });
    expect(
      searchLinkedDocuments(ctx(), user.id, "service CONTRACT", 10),
    ).toEqual([
      {
        id: "paperless:1",
        title: "Boiler service contract",
        snippet: "Boiler",
        url: `/assets/${asset.id}`,
      },
    ]);
    expect(
      searchLinkedDocuments(ctx(), user.id, "service invoice", 10),
    ).toEqual([]);
    expect(searchLinkedDocuments(ctx(), user.id, "acme", 10)).toEqual([]);
    expect(searchLinkedDocuments(ctx(), user.id, "   ", 10)).toEqual([]);
  });

  it("treats wildcards and quotes in the text as plain characters", async () => {
    const { user, connection, asset } = await setup();
    cacheDocument(test.db, connection.id, 1, { title: "100% done_ok" });
    linkDocument(test.db, { externalId: 1, ownerId: asset.id });
    expect(searchLinkedDocuments(ctx(), user.id, "100", 10)).toHaveLength(1);
    expect(searchLinkedDocuments(ctx(), user.id, '"; drop table', 10)).toEqual(
      [],
    );
  });

  it("leaves out documents that are linked nowhere, or whose owner is gone", async () => {
    const { user, connection, asset } = await setup();
    cacheDocument(test.db, connection.id, 1, { title: "Unlinked manual" });
    cacheDocument(test.db, connection.id, 2, { title: "Orphaned manual" });
    cacheDocument(test.db, connection.id, 3, { title: "Linked manual" });
    linkDocument(test.db, { externalId: 2, ownerId: "gone" });
    linkDocument(test.db, { externalId: 3, ownerId: asset.id });
    expect(
      searchLinkedDocuments(ctx(), user.id, "manual", 10).map((h) => h.id),
    ).toEqual(["paperless:3"]);
  });

  it("opens the first thing a document is linked to, once", async () => {
    const { user, connection, asset } = await setup();
    const room = makeAsset(ctx(), { name: "Other" });
    cacheDocument(test.db, connection.id, 1, { title: "Shared manual" });
    linkDocument(test.db, {
      externalId: 1,
      ownerId: asset.id,
      createdAt: new Date(1000),
    });
    linkDocument(test.db, {
      externalId: 1,
      ownerId: room.id,
      createdAt: new Date(2000),
    });
    const hits = searchLinkedDocuments(ctx(), user.id, "manual", 10);
    expect(hits).toHaveLength(1);
    expect(hits[0].url).toBe(`/assets/${asset.id}`);
  });

  it("only searches what the caller's own account can read", async () => {
    const [a, b] = [await createTestUser(), await createTestUser()];
    const ca = makeConnection(test.db, a.id);
    const cb = makeConnection(test.db, b.id);
    const asset = makeAsset(ctx());
    cacheDocument(test.db, ca.id, 1, { title: "A private letter" });
    cacheDocument(test.db, cb.id, 1, { title: "", ownerVisible: false });
    linkDocument(test.db, {
      externalId: 1,
      ownerId: asset.id,
      connectionId: ca.id,
    });
    expect(searchLinkedDocuments(ctx(), a.id, "letter", 10)).toHaveLength(1);
    expect(searchLinkedDocuments(ctx(), b.id, "letter", 10)).toEqual([]);
    const nobody = await createTestUser();
    expect(searchLinkedDocuments(ctx(), nobody.id, "letter", 10)).toEqual([]);
  });

  it("limits and sorts by title", async () => {
    const { user, connection, asset } = await setup();
    for (const [i, title] of [
      "Zeta manual",
      "Alpha manual",
      "Beta manual",
    ].entries()) {
      cacheDocument(test.db, connection.id, i + 1, { title });
      linkDocument(test.db, { externalId: i + 1, ownerId: asset.id });
    }
    expect(
      searchLinkedDocuments(ctx(), user.id, "manual", 2).map((h) => h.title),
    ).toEqual(["Alpha manual", "Beta manual"]);
    expect(searchLinkedDocuments(ctx(), user.id, "manual", 0)).toEqual([]);
  });
});
