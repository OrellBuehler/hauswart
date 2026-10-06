import { describe, expect, it } from "vitest";
import { createContact } from "$lib/server/contacts/contacts";
import { createContactRequestSchema } from "$lib/api/schemas/contacts";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import {
  cacheDocument,
  linkDocument,
  makeAsset,
  makeConnection,
} from "$lib/testing/documents";
import {
  CORRESPONDENT_SOURCE,
  assetSuggestions,
  contactSuggestions,
  correspondentRef,
} from "./suggestions";

const WARRANTY = {
  warrantyUntil: "2028-01-01",
  warrantyExtendedUntil: null,
};
const NONE = { warrantyUntil: null, warrantyExtendedUntil: null };

describe("suggestions", () => {
  const test = useTestDB();
  const ctx = () => ({ db: test.db });

  describe("assets from receipts", () => {
    it("offers receipts with a warranty date that no asset is linked to, newest first", async () => {
      const user = await createTestUser();
      const c = makeConnection(test.db, user.id, {
        config: { receiptTagIds: [2] },
      });
      cacheDocument(test.db, c.id, 1, {
        title: "Oven receipt",
        tagIds: [2],
        customFieldsJson: WARRANTY,
        createdDate: "2026-02-01",
      });
      cacheDocument(test.db, c.id, 2, {
        title: "Fridge receipt",
        tagIds: [2, 9],
        customFieldsJson: {
          warrantyUntil: null,
          warrantyExtendedUntil: "2030-01-01",
        },
        createdDate: "2026-05-01",
      });
      cacheDocument(test.db, c.id, 3, {
        title: "Receipt without a warranty",
        tagIds: [2],
        customFieldsJson: NONE,
      });
      cacheDocument(test.db, c.id, 4, {
        title: "Not a receipt",
        tagIds: [9],
        customFieldsJson: WARRANTY,
      });
      cacheDocument(test.db, c.id, 5, {
        title: "Gone",
        tagIds: [2],
        customFieldsJson: WARRANTY,
        ownerVisible: false,
      });
      expect(
        assetSuggestions(ctx(), user.id).map((s) => [s.provider, s.meta.title]),
      ).toEqual([
        ["paperless", "Fridge receipt"],
        ["paperless", "Oven receipt"],
      ]);
    });

    it("leaves out receipts that an asset is already linked to, whatever the role", async () => {
      const user = await createTestUser();
      const c = makeConnection(test.db, user.id, {
        config: { receiptTagIds: [2] },
      });
      const asset = makeAsset({ db: test.db });
      cacheDocument(test.db, c.id, 1, {
        tagIds: [2],
        customFieldsJson: WARRANTY,
      });
      cacheDocument(test.db, c.id, 2, {
        tagIds: [2],
        customFieldsJson: WARRANTY,
      });
      linkDocument(test.db, {
        externalId: 1,
        ownerId: asset.id,
        role: "manual",
      });
      // A link to a room is not an asset.
      linkDocument(test.db, { externalId: 2, ownerType: "room", ownerId: "r" });
      expect(
        assetSuggestions(ctx(), user.id).map((s) => s.meta.externalId),
      ).toEqual([2]);
    });

    it("offers nothing when no receipt tag is configured", async () => {
      const user = await createTestUser();
      const c = makeConnection(test.db, user.id);
      cacheDocument(test.db, c.id, 1, {
        tagIds: [2],
        customFieldsJson: WARRANTY,
      });
      expect(assetSuggestions(ctx(), user.id)).toEqual([]);
    });

    it("is built from the caller's own documents only", async () => {
      const [a, b] = [await createTestUser(), await createTestUser()];
      const ca = makeConnection(test.db, a.id, {
        config: { receiptTagIds: [2] },
      });
      makeConnection(test.db, b.id, { config: { receiptTagIds: [2] } });
      cacheDocument(test.db, ca.id, 1, {
        title: "A's receipt",
        tagIds: [2],
        customFieldsJson: WARRANTY,
      });
      expect(assetSuggestions(ctx(), a.id)).toHaveLength(1);
      expect(assetSuggestions(ctx(), b.id)).toEqual([]);
    });

    it("is a 404 without a connection", async () => {
      const user = await createTestUser();
      expect(() => assetSuggestions(ctx(), user.id)).toThrow(/not found/i);
    });
  });

  describe("contacts from correspondents", () => {
    it("offers each correspondent of the synced documents once, with the count", async () => {
      const user = await createTestUser();
      const c = makeConnection(test.db, user.id);
      cacheDocument(test.db, c.id, 1, {
        correspondentId: 20,
        correspondentName: "Example Shop",
      });
      cacheDocument(test.db, c.id, 2, {
        correspondentId: 20,
        correspondentName: "Example Shop",
      });
      cacheDocument(test.db, c.id, 3, {
        correspondentId: 21,
        correspondentName: "Acme Heating",
      });
      cacheDocument(test.db, c.id, 4, { correspondentId: null });
      cacheDocument(test.db, c.id, 5, {
        correspondentId: 22,
        correspondentName: "Not visible",
        ownerVisible: false,
      });
      expect(contactSuggestions(ctx(), user.id)).toEqual([
        {
          provider: "paperless",
          correspondentId: 21,
          name: "Acme Heating",
          documentCount: 1,
          externalSource: CORRESPONDENT_SOURCE,
          externalRef: "paperless:21",
        },
        {
          provider: "paperless",
          correspondentId: 20,
          name: "Example Shop",
          documentCount: 2,
          externalSource: CORRESPONDENT_SOURCE,
          externalRef: "paperless:20",
        },
      ]);
    });

    it("leaves out correspondents a contact already stands for, whoever made the contact", async () => {
      const [a, b] = [await createTestUser(), await createTestUser()];
      const ca = makeConnection(test.db, a.id);
      const cb = makeConnection(test.db, b.id);
      for (const c of [ca, cb]) {
        cacheDocument(test.db, c.id, 1, {
          correspondentId: 20,
          correspondentName: "Example Shop",
        });
        cacheDocument(test.db, c.id, 2, {
          correspondentId: 21,
          correspondentName: "Acme Heating",
        });
      }
      createContact(
        ctx(),
        createContactRequestSchema.parse({
          name: "Example Shop",
          externalSource: CORRESPONDENT_SOURCE,
          externalRef: correspondentRef("paperless", 20),
        }),
      );
      for (const user of [a, b]) {
        expect(contactSuggestions(ctx(), user.id).map((s) => s.name)).toEqual([
          "Acme Heating",
        ]);
      }
    });

    it("does not count a contact from another source", async () => {
      const user = await createTestUser();
      const c = makeConnection(test.db, user.id);
      cacheDocument(test.db, c.id, 1, {
        correspondentId: 20,
        correspondentName: "Example Shop",
      });
      createContact(
        ctx(),
        createContactRequestSchema.parse({
          name: "Example Shop",
          externalSource: "other_system",
          externalRef: "paperless:20",
        }),
      );
      expect(contactSuggestions(ctx(), user.id)).toHaveLength(1);
    });

    it("only reads the caller's own cache", async () => {
      const [a, b] = [await createTestUser(), await createTestUser()];
      const ca = makeConnection(test.db, a.id);
      makeConnection(test.db, b.id);
      cacheDocument(test.db, ca.id, 1, {
        correspondentId: 20,
        correspondentName: "A's Doctor",
      });
      expect(contactSuggestions(ctx(), b.id)).toEqual([]);
    });
  });
});
