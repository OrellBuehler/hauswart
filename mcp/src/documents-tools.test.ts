import { describe, expect, it } from "vitest";
import { minor } from "../../src/lib/money";
import { docPages, insurancePolicies } from "../../src/lib/server/db";
import {
  TEST_CONFIG,
  seedTaxonomy,
  useFakePaperless,
} from "../../src/lib/server/integrations/paperless/testing";
import { syncAll } from "../../src/lib/server/integrations/paperless/sync";
import { linkDocument } from "../../src/lib/testing/documents";
import { useMcp, type Json } from "./test-harness";

describe("document tools", () => {
  const mcp = useMcp();
  const { fake, connect: connectPaperless } = useFakePaperless();
  const ctx = () => ({ db: mcp.db.db, now: Date.now() });

  /** The token user (Anna) with her own Paperless account and a few documents. */
  async function setup(options: Parameters<typeof mcp.connect>[0] = {}) {
    const session = await mcp.connect(options);
    seedTaxonomy(fake);
    connectPaperless(session.anna.id, { config: TEST_CONFIG });
    return session;
  }

  const titles = (list: Json[]) => list.map((d) => d.title);

  it("explains what is missing when the token user has no document system", async () => {
    const { call } = await mcp.connect();
    const reply = await call("search_documents");
    expect(reply.isError).toBe(true);
    expect(reply.text).toMatch(
      /Error \[not_found\].*not connected a document system/,
    );
    const one = await call("get_document", { documentId: 10 });
    expect(one.text).toMatch(
      /Error \[not_found\].*not connected a document system/,
    );
  });

  describe("search_documents", () => {
    it("lists the synced documents newest first, filters by tag and correspondent name, and says where each is used", async () => {
      const { ok } = await setup();
      fake.addDoc({
        id: 10,
        title: "Old lease",
        tags: [1],
        created: "2025-01-01",
      });
      fake.addDoc({
        id: 11,
        title: "Boiler manual",
        tags: [3],
        created: "2026-03-01",
        correspondent: 21,
        page_count: 12,
        custom_fields: [{ field: 7, value: "2028-03-01" }],
      });
      fake.addDoc({ id: 12, title: "Private", tags: [4] });
      await syncAll(ctx());
      const asset = await ok("create_asset", { name: "Boiler" });
      await ok("link_document", {
        documentId: 11,
        ownerType: "asset",
        owner: "Boiler",
        role: "manual",
      });

      const all = await ok("search_documents");
      expect(titles(all.documents)).toEqual(["Boiler manual", "Old lease"]);
      expect(all.documents[0]).toMatchObject({
        id: 11,
        date: "2026-03-01",
        correspondent: "Acme Heating",
        tags: ["Manual"],
        pages: 12,
        warrantyUntil: "2028-03-01",
        usedIn: [
          {
            type: "asset",
            id: asset.id,
            title: "Boiler",
            url: `/assets/${asset.id}`,
            role: "manual",
          },
        ],
      });
      expect(all.documents[1].usedIn).toBeUndefined();

      expect(
        titles((await ok("search_documents", { tag: "manual" })).documents),
      ).toEqual(["Boiler manual"]);
      expect(
        titles((await ok("search_documents", { tag: "3" })).documents),
      ).toEqual(["Boiler manual"]);
      expect(
        titles(
          (await ok("search_documents", { correspondent: "acme heating" }))
            .documents,
        ),
      ).toEqual(["Boiler manual"]);
      expect(
        titles((await ok("search_documents", { linked: false })).documents),
      ).toEqual(["Old lease"]);
      expect(
        titles((await ok("search_documents", { linked: true })).documents),
      ).toEqual(["Boiler manual"]);
    });

    it("reports a tag or correspondent the system does not know", async () => {
      const { call } = await setup();
      const reply = await call("search_documents", { tag: "No such tag" });
      expect(reply.isError).toBe(true);
      expect(reply.text).toContain('No tag named "No such tag"');
    });

    it("searches live in title and text, also what is not synced", async () => {
      const { ok } = await setup();
      fake.addDoc({ id: 20, title: "Oven warranty card", tags: [4] });
      fake.addDoc({ id: 21, title: "Dishwasher receipt", tags: [4] });
      const live = await ok("search_documents", { q: "oven" });
      expect(titles(live.documents)).toEqual(["Oven warranty card"]);
      expect(
        fake.requestsTo("/api/documents/", "GET").at(-1)!.query.get("text"),
      ).toBe("oven");
    });

    it("pages", async () => {
      const { ok } = await setup();
      for (let i = 1; i <= 3; i++) {
        fake.addDoc({
          id: i,
          title: `Doc ${i}`,
          tags: [1],
          created: `2026-01-0${i}`,
        });
      }
      await syncAll(ctx());
      const first = await ok("search_documents", { limit: 2 });
      expect(titles(first.documents)).toEqual(["Doc 3", "Doc 2"]);
      const second = await ok("search_documents", {
        limit: 2,
        cursor: first.nextCursor,
      });
      expect(titles(second.documents)).toEqual(["Doc 1"]);
    });

    it("reports a document system that does not answer", async () => {
      const { call } = await setup();
      fake.failNext("/api/documents/", 500);
      const reply = await call("search_documents", { q: "x" });
      expect(reply.isError).toBe(true);
      expect(reply.text).toContain("Error [upstream_error]");
    });
  });

  describe("get_document", () => {
    it("tells the document, its address and every link", async () => {
      const { ok } = await setup();
      fake.addDoc({
        id: 30,
        title: "Boiler manual",
        tags: [3],
        correspondent: 21,
        notes: [{ id: 1, note: "n", created: "x", user: 1 }],
      });
      await ok("create_asset", { name: "Boiler" });
      const link = await ok("link_document", {
        documentId: 30,
        ownerType: "asset",
        owner: "Boiler",
        role: "manual",
        label: "Chapter 3",
      });
      const doc = await ok("get_document", { documentId: 30 });
      expect(doc).toMatchObject({
        id: 30,
        title: "Boiler manual",
        correspondent: "Acme Heating",
        notes: 1,
        webUrl: `${fake.baseUrl}/documents/30/details`,
        links: [
          {
            id: link.id,
            role: "manual",
            label: "Chapter 3",
            ownerTitle: "Boiler",
          },
        ],
      });
    });

    it("is not_found for a document the user's account cannot see", async () => {
      const { call } = await setup();
      fake.strictPermissions = true;
      fake.addDoc({ id: 31, title: "Somebody else's", owner: 99 });
      const reply = await call("get_document", { documentId: 31 });
      expect(reply.isError).toBe(true);
      expect(reply.text).toMatch(/Error \[not_found\].*may not see it/);
    });
  });

  describe("link_document, list_document_links and unlink_document", () => {
    it("links by name, lists by owner and by document, and unlinks", async () => {
      const { ok, call } = await setup();
      fake.addDoc({
        id: 40,
        title: "Boiler receipt",
        tags: [2],
        correspondent: 20,
      });
      fake.addDoc({ id: 41, title: "Boiler manual", tags: [3] });
      const asset = await ok("create_asset", { name: "Boiler" });

      const first = await ok("link_document", {
        documentId: 40,
        ownerType: "asset",
        owner: "boiler",
        role: "receipt",
      });
      expect(first).toMatchObject({
        documentId: 40,
        title: "Boiler receipt",
        role: "receipt",
        ownerType: "asset",
        ownerId: asset.id,
        ownerTitle: "Boiler",
        ownerUrl: `/assets/${asset.id}`,
      });
      await ok("link_document", {
        documentId: 41,
        ownerType: "asset",
        owner: asset.id,
        role: "manual",
      });

      const mine = await ok("list_document_links", {
        ownerType: "asset",
        owner: "Boiler",
      });
      expect(
        mine.links.map((l: Json) => [l.documentId, l.role]).sort(),
      ).toEqual([
        [40, "receipt"],
        [41, "manual"],
      ]);
      const ofDocument = await ok("list_document_links", { documentId: 41 });
      expect(ofDocument.links).toHaveLength(1);
      expect(ofDocument.links[0]).toMatchObject({
        title: "Boiler manual",
        ownerId: asset.id,
      });
      expect((await ok("list_document_links")).links).toHaveLength(2);

      const again = await call("link_document", {
        documentId: 40,
        ownerType: "asset",
        owner: "Boiler",
        role: "receipt",
      });
      expect(again.isError).toBe(true);
      expect(again.text).toContain("Error [conflict]");

      await ok("unlink_document", { linkId: first.id });
      const rest = await ok("list_document_links", {
        ownerType: "asset",
        owner: "Boiler",
      });
      expect(rest.links.map((l: Json) => l.documentId)).toEqual([41]);
      const gone = await call("unlink_document", { linkId: first.id });
      expect(gone.isError).toBe(true);
      expect(gone.text).toContain("Error [not_found]");
    });

    it("a receipt on an asset gives it the warranty dates of the document", async () => {
      const { ok } = await setup();
      fake.addDoc({
        id: 50,
        title: "Receipt",
        tags: [2],
        custom_fields: [{ field: 7, value: "2028-05-01" }],
      });
      await ok("create_asset", { name: "Washer" });
      await ok("link_document", {
        documentId: 50,
        ownerType: "asset",
        owner: "Washer",
        role: "receipt",
      });
      expect((await ok("get_asset", { asset: "Washer" })).warrantyUntil).toBe(
        "2028-05-01",
      );
    });

    it("finds the other kinds of owner by name, slug or id", async () => {
      const { ok } = await setup({ scopes: ["read", "write", "docs:write"] });
      fake.addDoc({ id: 60, title: "Lease", tags: [1] });
      mcp.db.db
        .insert(docPages)
        .values({ slug: "house-rules", title: "House rules", bodyMd: "x" })
        .run();
      const onPage = await ok("link_document", {
        documentId: 60,
        ownerType: "page",
        owner: "house-rules",
      });
      expect(onPage).toMatchObject({
        ownerType: "page",
        ownerTitle: "House rules",
        ownerUrl: "/docs/house-rules",
      });
      const task = await ok("create_task", {
        title: "Pay rent",
        trigger: { type: "one_off", date: "2027-01-01" },
      });
      const onTask = await ok("link_document", {
        documentId: 60,
        ownerType: "task",
        owner: task.id,
        role: "correspondence",
      });
      expect(onTask).toMatchObject({
        ownerType: "task",
        ownerTitle: "Pay rent",
      });
      const listed = await ok("list_document_links", {
        ownerType: "page",
        owner: "house-rules",
      });
      expect(listed.links).toHaveLength(1);
    });

    it("links to an insurance policy by its title or policy number, as the policy or the registration", async () => {
      const { ok } = await setup();
      fake.addDoc({ id: 62, title: "Policy PDF", tags: [1] });
      fake.addDoc({ id: 63, title: "Registration", tags: [1] });
      const created = await mcp.db.db
        .insert(insurancePolicies)
        .values({
          title: "Kasko Kombi",
          policyNumber: "POL-2026-0042",
          premiumMinor: minor(12_500),
          currency: "CHF",
          startDate: "2026-01-01",
        })
        .returning()
        .get();
      const byTitle = await ok("link_document", {
        documentId: 62,
        ownerType: "insurance_policy",
        owner: "Kasko Kombi",
        role: "policy",
      });
      expect(byTitle).toMatchObject({
        ownerType: "insurance_policy",
        ownerId: created.id,
        ownerTitle: "Kasko Kombi",
        ownerUrl: `/insurance/${created.id}`,
        role: "policy",
      });
      const byNumber = await ok("link_document", {
        documentId: 63,
        ownerType: "insurance_policy",
        owner: "pol-2026-0042",
        role: "registration",
      });
      expect(byNumber).toMatchObject({
        ownerId: created.id,
        role: "registration",
      });
      const listed = await ok("list_document_links", {
        ownerType: "insurance_policy",
        owner: created.id,
      });
      expect(listed.links.map((l: Json) => l.role).sort()).toEqual([
        "policy",
        "registration",
      ]);
    });

    it("links to a page only with docs:write, and not to something that does not exist", async () => {
      const { call } = await setup();
      fake.addDoc({ id: 61, title: "Rules", tags: [1] });
      mcp.db.db
        .insert(docPages)
        .values({ slug: "rules", title: "Rules", bodyMd: "x" })
        .run();
      const page = await call("link_document", {
        documentId: 61,
        ownerType: "page",
        owner: "rules",
      });
      expect(page.isError).toBe(true);
      expect(page.text).toContain("Error [forbidden]");
      const missing = await call("link_document", {
        documentId: 61,
        ownerType: "task",
        owner: "no-such-task",
      });
      expect(missing.isError).toBe(true);
      expect(missing.text).toContain("Error [invalid_request]");
      const half = await call("list_document_links", { ownerType: "asset" });
      expect(half.isError).toBe(true);
      expect(half.text).toContain("Pass ownerType and owner together");
    });

    it("shows a link made with somebody else's account as not shared", async () => {
      const { ok, ben } = await setup();
      const asset = await ok("create_asset", { name: "Boiler" });
      linkDocument(mcp.db.db, {
        externalId: 70,
        ownerId: asset.id,
        role: "manual",
        createdBy: ben.id,
      });
      const { links } = await ok("list_document_links", {
        ownerType: "asset",
        owner: "Boiler",
      });
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({
        documentId: 70,
        notShared: true,
        role: "manual",
      });
      expect(links[0].title).toBeUndefined();
    });
  });

  it("the search tool finds linked documents by title and says their document id", async () => {
    const { ok } = await setup();
    fake.addDoc({ id: 80, title: "Heat pump service contract", tags: [1] });
    await syncAll(ctx());
    await ok("create_asset", { name: "Heat pump" });
    await ok("link_document", {
      documentId: 80,
      ownerType: "asset",
      owner: "Heat pump",
      role: "other",
    });
    const hits = (await ok("search", { q: "contract", type: "document" })).hits;
    expect(hits).toMatchObject([
      {
        type: "document",
        id: "paperless:80",
        documentId: 80,
        title: "Heat pump service contract",
      },
    ]);
  });
});
