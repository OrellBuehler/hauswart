import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DocumentLinkOwnerType } from "$lib/api/enums";
import {
  connections,
  contacts,
  defects,
  docPages,
  documentLinks,
  parts,
  rooms,
  serviceLog,
  tasks,
} from "$lib/server/db";
import { deleteAsset } from "$lib/server/assets/assets";
import { deleteRoom } from "$lib/server/rooms/rooms";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { makeTask } from "$lib/testing/domain";
import {
  cacheDocument,
  linkDocument,
  makeAsset,
  makeConnection,
} from "$lib/testing/documents";
import { linkSummaries, linkViews, listLinks } from "./links";
import { ownerInfo } from "./owners";

describe("document links", () => {
  const test = useTestDB();
  const ctx = () => ({ db: test.db, now: Date.now() });

  describe("owners", () => {
    it("tells the title and the app path of each kind of owner", async () => {
      const asset = makeAsset(ctx(), { name: "Dishwasher" });
      expect(ownerInfo(test.db, "asset", asset.id)).toEqual({
        title: "Dishwasher",
        url: `/assets/${asset.id}`,
      });
      const task = await makeTask(ctx(), { title: "Descale" });
      expect(ownerInfo(test.db, "task", task.id)).toEqual({
        title: "Descale",
        url: `/tasks/${task.id}`,
      });
      expect(ownerInfo(test.db, "asset", "missing")).toBeNull();
    });

    it("pages open by slug", () => {
      const page = test.db
        .insert(docPages)
        .values({
          slug: "house-rules",
          title: "House rules",
          bodyMd: "x",
          section: "rules",
        })
        .returning()
        .get();
      expect(ownerInfo(test.db, "page", page.id)).toEqual({
        title: "House rules",
        url: "/docs/house-rules",
      });
    });
  });

  describe("deleting an owner removes its links", () => {
    let n = 0;
    const owners: Record<
      DocumentLinkOwnerType,
      () => { id: string; remove: () => void }
    > = {
      asset: () => {
        const a = makeAsset(ctx());
        return { id: a.id, remove: () => deleteAsset(ctx(), a.id) };
      },
      room: () => {
        const r = test.db
          .insert(rooms)
          .values({ name: "Kitchen", slug: `room-${++n}` })
          .returning()
          .get();
        return { id: r.id, remove: () => deleteRoom(ctx(), r.id) };
      },
      page: () => {
        const p = test.db
          .insert(docPages)
          .values({ slug: `page-${++n}`, title: "P", bodyMd: "x" })
          .returning()
          .get();
        return {
          id: p.id,
          remove: () =>
            void test.db.delete(docPages).where(eq(docPages.id, p.id)).run(),
        };
      },
      task: () => {
        const t = test.db
          .insert(tasks)
          .values({
            title: "T",
            trigger: { v: 1, type: "one_off", dueDate: "2027-01-01" },
          })
          .returning()
          .get();
        return {
          id: t.id,
          remove: () =>
            void test.db.delete(tasks).where(eq(tasks.id, t.id)).run(),
        };
      },
      defect: () => {
        const d = test.db
          .insert(defects)
          .values({ number: ++n, title: "D", discoveredOn: "2026-01-01" })
          .returning()
          .get();
        return {
          id: d.id,
          remove: () =>
            void test.db.delete(defects).where(eq(defects.id, d.id)).run(),
        };
      },
      service_log: () => {
        const a = makeAsset(ctx());
        const e = test.db
          .insert(serviceLog)
          .values({
            assetId: a.id,
            title: "Service",
            kind: "maintenance",
            date: "2026-01-01",
          })
          .returning()
          .get();
        return {
          id: e.id,
          remove: () =>
            void test.db
              .delete(serviceLog)
              .where(eq(serviceLog.id, e.id))
              .run(),
        };
      },
      part: () => {
        const p = test.db
          .insert(parts)
          .values({ name: "Filter" })
          .returning()
          .get();
        return {
          id: p.id,
          remove: () =>
            void test.db.delete(parts).where(eq(parts.id, p.id)).run(),
        };
      },
      contact: () => {
        const c = test.db
          .insert(contacts)
          .values({ name: "Installer" })
          .returning()
          .get();
        return {
          id: c.id,
          remove: () =>
            void test.db.delete(contacts).where(eq(contacts.id, c.id)).run(),
        };
      },
    };

    it.each(Object.keys(owners) as DocumentLinkOwnerType[])("%s", (type) => {
      const owner = owners[type]();
      const other = owners[type]();
      for (const o of [owner, other]) {
        linkDocument(test.db, {
          externalId: 1,
          ownerType: type,
          ownerId: o.id,
        });
        linkDocument(test.db, {
          externalId: 2,
          ownerType: type,
          ownerId: o.id,
          role: "manual",
        });
      }
      owner.remove();
      const left = test.db.select().from(documentLinks).all();
      expect(left.map((l) => l.ownerId)).toEqual([other.id, other.id]);
    });

    it("deleting an asset also removes the links of its service log entries", () => {
      const a = makeAsset(ctx());
      const entry = test.db
        .insert(serviceLog)
        .values({
          assetId: a.id,
          title: "Service",
          kind: "maintenance",
          date: "2026-01-01",
        })
        .returning()
        .get();
      linkDocument(test.db, {
        externalId: 1,
        ownerType: "service_log",
        ownerId: entry.id,
      });
      deleteAsset(ctx(), a.id);
      expect(test.db.select().from(documentLinks).all()).toEqual([]);
    });
  });

  describe("unique links", () => {
    it("one document can sit on one owner once per role", () => {
      const a = makeAsset(ctx());
      linkDocument(test.db, { externalId: 1, ownerId: a.id, role: "manual" });
      linkDocument(test.db, { externalId: 1, ownerId: a.id, role: "receipt" });
      expect(() =>
        linkDocument(test.db, { externalId: 1, ownerId: a.id, role: "manual" }),
      ).toThrow(/UNIQUE/);
    });
  });

  describe("what each person sees", () => {
    async function twoPeople() {
      const [a, b] = [await createTestUser(), await createTestUser()];
      const connectionA = makeConnection(test.db, a.id);
      const connectionB = makeConnection(test.db, b.id);
      return { a, b, connectionA, connectionB };
    }

    it("a document both accounts can read is available to both, with its title", async () => {
      const { a, b, connectionA, connectionB } = await twoPeople();
      const asset = makeAsset(ctx());
      cacheDocument(test.db, connectionA.id, 5, { title: "Shared lease" });
      cacheDocument(test.db, connectionB.id, 5, { title: "Shared lease" });
      const link = linkDocument(test.db, {
        externalId: 5,
        ownerId: asset.id,
        connectionId: connectionA.id,
        createdBy: a.id,
      });
      for (const user of [a, b]) {
        const [view] = linkViews(ctx(), user.id, [link]);
        expect(view).toMatchObject({
          available: true,
          document: { title: "Shared lease" },
          owner: { title: "Dishwasher" },
        });
      }
    });

    it("another person's private document is 'not shared': no title, no content", async () => {
      const { a, b, connectionA, connectionB } = await twoPeople();
      const asset = makeAsset(ctx());
      cacheDocument(test.db, connectionA.id, 5, {
        title: "A's private letter",
      });
      cacheDocument(test.db, connectionB.id, 5, {
        title: "",
        ownerVisible: false,
      });
      const link = linkDocument(test.db, {
        externalId: 5,
        ownerId: asset.id,
        connectionId: connectionA.id,
        createdBy: a.id,
      });
      expect(linkViews(ctx(), a.id, [link])[0].available).toBe(true);
      const mine = linkViews(ctx(), b.id, [link])[0];
      expect(mine).toMatchObject({ available: false, document: null });
      expect(JSON.stringify(mine)).not.toContain("private letter");
    });

    it("is not available without a connection of one's own, or with it switched off", async () => {
      const { a, connectionA } = await twoPeople();
      const nobody = await createTestUser();
      const asset = makeAsset(ctx());
      cacheDocument(test.db, connectionA.id, 5);
      const link = linkDocument(test.db, {
        externalId: 5,
        ownerId: asset.id,
        connectionId: connectionA.id,
      });
      expect(linkViews(ctx(), nobody.id, [link])[0].available).toBe(false);
      test.db
        .update(connections)
        .set({ enabled: false })
        .where(eq(connections.id, connectionA.id))
        .run();
      expect(linkViews(ctx(), a.id, [link])[0].available).toBe(false);
    });

    it("a link made at another address does not borrow the cache of a document with the same id here", async () => {
      const [a, b] = [await createTestUser(), await createTestUser()];
      const connectionA = makeConnection(test.db, a.id, {
        baseUrl: "https://one.example.org",
      });
      const connectionB = makeConnection(test.db, b.id, {
        baseUrl: "https://two.example.org",
      });
      const asset = makeAsset(ctx());
      cacheDocument(test.db, connectionB.id, 5, {
        title: "A different document 5",
      });
      const link = linkDocument(test.db, {
        externalId: 5,
        ownerId: asset.id,
        connectionId: connectionA.id,
      });
      expect(linkViews(ctx(), b.id, [link])[0]).toMatchObject({
        available: false,
        document: null,
      });
    });

    it("a link whose maker has left the document system is read as being at the same address", async () => {
      const { b, connectionB } = await twoPeople();
      const asset = makeAsset(ctx());
      cacheDocument(test.db, connectionB.id, 5, { title: "Lease" });
      const link = linkDocument(test.db, {
        externalId: 5,
        ownerId: asset.id,
        connectionId: null,
      });
      expect(linkViews(ctx(), b.id, [link])[0].available).toBe(true);
    });

    it("lists by owner or by document, newest first, and pages", async () => {
      const { a, connectionA } = await twoPeople();
      const asset = makeAsset(ctx());
      const other = makeAsset(ctx(), { name: "Other" });
      cacheDocument(test.db, connectionA.id, 1);
      const rows = [
        linkDocument(test.db, {
          externalId: 1,
          ownerId: asset.id,
          role: "manual",
          createdAt: new Date(1000),
        }),
        linkDocument(test.db, {
          externalId: 2,
          ownerId: asset.id,
          role: "receipt",
          createdAt: new Date(2000),
        }),
        linkDocument(test.db, {
          externalId: 1,
          ownerId: other.id,
          role: "manual",
          createdAt: new Date(3000),
        }),
      ];
      const byOwner = listLinks(
        ctx(),
        a.id,
        { ownerType: "asset", ownerId: asset.id },
        { limit: 10 },
      );
      expect(byOwner.items.map((v) => v.link.id)).toEqual([
        rows[1].id,
        rows[0].id,
      ]);
      const byDoc = listLinks(
        ctx(),
        a.id,
        { provider: "paperless", externalId: 1 },
        { limit: 10 },
      );
      expect(byDoc.items.map((v) => v.link.id)).toEqual([
        rows[2].id,
        rows[0].id,
      ]);
      const first = listLinks(ctx(), a.id, {}, { limit: 2 });
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();
      const second = listLinks(
        ctx(),
        a.id,
        {},
        { limit: 2, cursor: first.nextCursor! },
      );
      expect(second.items).toHaveLength(1);
      expect(second.nextCursor).toBeNull();
    });

    it("summaries say where a document is used", async () => {
      const asset = makeAsset(ctx(), { name: "Boiler" });
      linkDocument(test.db, {
        externalId: 1,
        ownerId: asset.id,
        role: "manual",
        createdAt: new Date(1000),
      });
      linkDocument(test.db, { externalId: 1, ownerId: "gone", role: "other" });
      const summary = linkSummaries(ctx(), "paperless", [1, 2]).get(1)!;
      expect(summary.map((s) => [s.ownerTitle, s.role])).toEqual([
        ["Boiler", "manual"],
        [null, "other"],
      ]);
      expect(linkSummaries(ctx(), "paperless", [2]).size).toBe(0);
    });
  });
});
