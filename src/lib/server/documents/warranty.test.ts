import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { assets, externalDocuments } from "$lib/server/db";
import { updateAsset } from "$lib/server/assets/assets";
import { updateAssetRequestSchema } from "$lib/api/schemas/assets";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import {
  cacheDocument,
  linkDocument,
  makeAsset,
  makeConnection,
} from "$lib/testing/documents";
import { applyDocumentWarranties } from "./warranty";

describe("warranty dates from linked documents", () => {
  const test = useTestDB();
  const ctx = () => ({ db: test.db, now: Date.now() });

  async function setup() {
    const user = await createTestUser();
    const connection = makeConnection(test.db, user.id);
    return { user, connection };
  }

  const asset = (id: string) =>
    test.db.select().from(assets).where(eq(assets.id, id)).get()!;

  const doc = (
    connectionId: string,
    externalId: number,
    until: string | null,
    extended: string | null = null,
    over = {},
  ) =>
    cacheDocument(test.db, connectionId, externalId, {
      customFieldsJson: {
        warrantyUntil: until,
        warrantyExtendedUntil: extended,
      },
      ...over,
    });

  it("fills empty dates from a receipt and marks them as coming from a document", async () => {
    const { connection } = await setup();
    const a = makeAsset(ctx());
    doc(connection.id, 10, "2028-03-04", "2029-03-04");
    linkDocument(test.db, {
      externalId: 10,
      ownerId: a.id,
      role: "receipt",
      connectionId: connection.id,
    });
    expect(applyDocumentWarranties(ctx())).toEqual([a.id]);
    expect(asset(a.id)).toMatchObject({
      warrantyUntil: "2028-03-04",
      warrantyExtendedUntil: "2029-03-04",
      warrantySource: "document",
    });
  });

  it("works for warranty documents too, and for one asset only when asked", async () => {
    const { connection } = await setup();
    const [a, b] = [
      makeAsset(ctx(), { name: "A" }),
      makeAsset(ctx(), { name: "B" }),
    ];
    doc(connection.id, 10, "2028-01-01");
    for (const owner of [a, b]) {
      linkDocument(test.db, {
        externalId: 10,
        ownerId: owner.id,
        role: "warranty",
        connectionId: connection.id,
      });
    }
    expect(applyDocumentWarranties(ctx(), { assetId: a.id })).toEqual([a.id]);
    expect(asset(a.id).warrantyUntil).toBe("2028-01-01");
    expect(asset(b.id).warrantyUntil).toBeNull();
  });

  it.each([
    "manual",
    "datasheet",
    "correspondence",
    "invoice",
    "other",
  ] as const)("ignores a %s link", async (role) => {
    const { connection } = await setup();
    const a = makeAsset(ctx());
    doc(connection.id, 10, "2028-01-01");
    linkDocument(test.db, {
      externalId: 10,
      ownerId: a.id,
      role,
      connectionId: connection.id,
    });
    expect(applyDocumentWarranties(ctx())).toEqual([]);
    expect(asset(a.id).warrantyUntil).toBeNull();
  });

  it("only reads links to assets", async () => {
    const { connection } = await setup();
    const a = makeAsset(ctx());
    doc(connection.id, 10, "2028-01-01");
    linkDocument(test.db, {
      externalId: 10,
      ownerType: "room",
      ownerId: a.id,
      role: "receipt",
      connectionId: connection.id,
    });
    expect(applyDocumentWarranties(ctx())).toEqual([]);
  });

  it("never overwrites dates a person typed", async () => {
    const { connection } = await setup();
    const a = makeAsset(ctx(), { warrantyUntil: "2027-06-01" });
    expect(asset(a.id).warrantySource).toBe("manual");
    doc(connection.id, 10, "2030-01-01", "2031-01-01");
    linkDocument(test.db, {
      externalId: 10,
      ownerId: a.id,
      role: "receipt",
      connectionId: connection.id,
    });
    expect(applyDocumentWarranties(ctx())).toEqual([]);
    expect(asset(a.id)).toMatchObject({
      warrantyUntil: "2027-06-01",
      warrantyExtendedUntil: null,
      warrantySource: "manual",
    });
  });

  it("follows the document while it is the source, until a person edits the dates", async () => {
    const { connection } = await setup();
    const a = makeAsset(ctx());
    const cached = doc(connection.id, 10, "2028-01-01");
    linkDocument(test.db, {
      externalId: 10,
      ownerId: a.id,
      role: "receipt",
      connectionId: connection.id,
    });
    applyDocumentWarranties(ctx());

    test.db
      .update(externalDocuments)
      .set({
        customFieldsJson: {
          warrantyUntil: "2029-01-01",
          warrantyExtendedUntil: "2030-01-01",
        },
      })
      .where(eq(externalDocuments.id, cached.id))
      .run();
    expect(applyDocumentWarranties(ctx())).toEqual([a.id]);
    expect(asset(a.id)).toMatchObject({
      warrantyUntil: "2029-01-01",
      warrantyExtendedUntil: "2030-01-01",
      warrantySource: "document",
    });
    expect(applyDocumentWarranties(ctx())).toEqual([]);

    updateAsset(
      ctx(),
      a.id,
      updateAssetRequestSchema.parse({ warrantyUntil: "2026-12-31" }),
    );
    expect(asset(a.id).warrantySource).toBe("manual");
    test.db
      .update(externalDocuments)
      .set({
        customFieldsJson: {
          warrantyUntil: "2040-01-01",
          warrantyExtendedUntil: null,
        },
      })
      .where(eq(externalDocuments.id, cached.id))
      .run();
    expect(applyDocumentWarranties(ctx())).toEqual([]);
    expect(asset(a.id).warrantyUntil).toBe("2026-12-31");
  });

  it("takes the latest date of each field when several documents speak", async () => {
    const { connection } = await setup();
    const a = makeAsset(ctx());
    doc(connection.id, 10, "2027-01-01", null);
    doc(connection.id, 11, "2028-06-01", "2029-01-01");
    doc(connection.id, 12, null, "2028-12-31");
    for (const [i, role] of [
      [10, "receipt"],
      [11, "warranty"],
      [12, "receipt"],
    ] as const) {
      linkDocument(test.db, {
        externalId: i,
        ownerId: a.id,
        role,
        connectionId: connection.id,
      });
    }
    applyDocumentWarranties(ctx());
    expect(asset(a.id)).toMatchObject({
      warrantyUntil: "2028-06-01",
      warrantyExtendedUntil: "2029-01-01",
    });
  });

  it("changes nothing for a document without a warranty date, or that the account cannot see", async () => {
    const { connection } = await setup();
    const a = makeAsset(ctx());
    doc(connection.id, 10, null, null);
    doc(connection.id, 11, "2030-01-01", null, { ownerVisible: false });
    for (const i of [10, 11, 12]) {
      linkDocument(test.db, {
        externalId: i,
        ownerId: a.id,
        role: "receipt",
        connectionId: connection.id,
      });
    }
    expect(applyDocumentWarranties(ctx())).toEqual([]);
    expect(asset(a.id)).toMatchObject({
      warrantyUntil: null,
      warrantySource: "manual",
    });
  });

  it("does not erase the dates when the document loses its own", async () => {
    const { connection } = await setup();
    const a = makeAsset(ctx());
    const cached = doc(connection.id, 10, "2028-01-01");
    linkDocument(test.db, {
      externalId: 10,
      ownerId: a.id,
      role: "receipt",
      connectionId: connection.id,
    });
    applyDocumentWarranties(ctx());
    test.db
      .update(externalDocuments)
      .set({
        customFieldsJson: { warrantyUntil: null, warrantyExtendedUntil: null },
      })
      .where(eq(externalDocuments.id, cached.id))
      .run();
    expect(applyDocumentWarranties(ctx())).toEqual([]);
    expect(asset(a.id).warrantyUntil).toBe("2028-01-01");
  });

  it("reads another connection's cache when the one that linked it is gone", async () => {
    const [{ connection }, second] = [await setup(), await setup()];
    const a = makeAsset(ctx());
    doc(second.connection.id, 10, "2028-01-01");
    linkDocument(test.db, {
      externalId: 10,
      ownerId: a.id,
      role: "receipt",
      connectionId: null,
    });
    expect(connection.id).not.toBe(second.connection.id);
    expect(applyDocumentWarranties(ctx())).toEqual([a.id]);
  });

  it("editing other fields of an asset, or saving the same dates again, keeps the source", async () => {
    const { connection } = await setup();
    const a = makeAsset(ctx());
    doc(connection.id, 10, "2028-01-01");
    linkDocument(test.db, {
      externalId: 10,
      ownerId: a.id,
      role: "receipt",
      connectionId: connection.id,
    });
    applyDocumentWarranties(ctx());
    updateAsset(
      ctx(),
      a.id,
      updateAssetRequestSchema.parse({ name: "Renamed" }),
    );
    expect(asset(a.id).warrantySource).toBe("document");
    updateAsset(
      ctx(),
      a.id,
      updateAssetRequestSchema.parse({
        warrantyUntil: "2028-01-01",
        warrantyExtendedUntil: null,
      }),
    );
    expect(asset(a.id).warrantySource).toBe("document");
  });
});
