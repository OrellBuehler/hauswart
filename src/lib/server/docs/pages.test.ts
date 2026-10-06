import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "$lib/api/errors";
import { createPageRequestSchema } from "$lib/api/schemas/docs";
import { createAsset } from "$lib/server/assets/assets";
import {
  createAttachment,
  deleteAttachment,
  getAttachment,
  settleBackgroundWork,
  updateAttachment,
} from "$lib/server/attachments/attachments";
import { attachments, docPageRevisions, docPages } from "$lib/server/db";
import { createRoom } from "$lib/server/rooms/rooms";
import { plainPng } from "$lib/server/files/test-images";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt } from "$lib/testing/domain";
import { useTestFilesDir } from "$lib/testing/files";
import { MarkdownError, MAX_MARKDOWN_BYTES } from "./markdown";
import { shutdownMarkdownWorkers } from "./markdown-runner";
import {
  MAX_REVISIONS,
  backlinksOf,
  createPage,
  deletePage,
  getPage,
  getPageDetail,
  getRevision,
  listPages,
  listRevisions,
  rerenderPagesUsing,
  restoreRevision,
  startAttachmentRerender,
  updatePage,
} from "./pages";
import { fillGuestToken, GUEST_TOKEN_PLACEHOLDER } from "./render";

const SECRET = "hidden-hidden-hidden";
const WITH_SECRET = `# Wlan

Das Netz heisst Zuhause.

:::secret
## Zugang

Passwort ${SECRET}
:::

## Nachher

Ende.`;

afterEach(() => shutdownMarkdownWorkers());

describe("doc pages", () => {
  const test = useTestDB();
  useTestFilesDir();
  const ctx = () => ctxAt(test.db);
  let userId: string;

  async function user() {
    userId = (await createTestUser()).id;
    return userId;
  }
  const page = async (input: Record<string, unknown>) =>
    createPage(
      ctx(),
      createPageRequestSchema.parse({ title: "Seite", ...input }),
      userId ?? (await user()),
    );
  const codeOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (err) {
      return err instanceof ApiError ? `${err.code}` : (err as Error).name;
    }
    return null;
  };

  describe("create", () => {
    it("renders both audiences, derives the slug and writes revision 1", async () => {
      await user();
      const created = await page({
        title: "Heizung & Boiler",
        bodyMd: "# Hallo\n\nText **fett**",
      });
      expect(created).toMatchObject({
        slug: "heizung-boiler",
        title: "Heizung & Boiler",
        section: "general",
        rev: 1,
        guestVisible: false,
        pinned: false,
        updatedBy: userId,
        archivedAt: null,
        backlinks: [],
      });
      expect(created.renderedHtmlMember).toContain("<strong>fett</strong>");
      expect(created.renderedHtmlGuest).toContain("<strong>fett</strong>");
      expect(created.plainText).toBe("Hallo Text fett");
      expect(created.headingsJson.member).toEqual([
        { level: 1, text: "Hallo", id: "h-hallo" },
      ]);
      const revisions = listRevisions(ctx(), created.slug);
      expect(revisions.map((r) => r.rev)).toEqual([1]);
      expect(getRevision(ctx(), created.slug, 1).bodyMd).toBe(
        "# Hallo\n\nText **fett**",
      );
    });

    it("numbers colliding slugs, refuses explicit duplicates and the reserved slug", async () => {
      await user();
      expect((await page({ title: "Küche" })).slug).toBe("kueche");
      expect((await page({ title: "Küche" })).slug).toBe("kueche-2");
      expect(await codeOf(page({ slug: "kueche" }))).toBe("conflict");
      expect((await page({ title: "Preview" })).slug).toBe("preview-2");
      expect(
        createPageRequestSchema.safeParse({ title: "x", slug: "preview" })
          .success,
      ).toBe(false);
    });

    it("links an asset and a room that exist", async () => {
      await user();
      const room = createRoom(ctx(), { name: "Bad" });
      const asset = createAsset(ctx(), {
        kind: "device",
        name: "Boiler",
        showOnEmergency: false,
      });
      const created = await page({
        assetId: asset.id,
        roomId: room.id,
        section: "device",
      });
      expect(created).toMatchObject({
        assetId: asset.id,
        roomId: room.id,
        section: "device",
      });
      expect(await codeOf(page({ assetId: "nope" }))).toBe("invalid_request");
      expect(await codeOf(page({ roomId: "nope" }))).toBe("invalid_request");
    });

    it("fails with too_large above the cap and too_complex when rendering does not finish", async () => {
      await user();
      await expect(
        page({ bodyMd: "a".repeat(MAX_MARKDOWN_BYTES + 1) }),
      ).rejects.toMatchObject({
        code: "too_large",
      });
      await expect(
        page({ bodyMd: "*a ".repeat(60_000) }),
      ).rejects.toBeInstanceOf(MarkdownError);
      expect(test.db.select().from(docPages).all()).toHaveLength(0);
    });
  });

  describe("secrets", () => {
    it("the member HTML shows them, the guest HTML, plain text and guest headings do not", async () => {
      await user();
      const created = await page({ bodyMd: WITH_SECRET });
      expect(created.renderedHtmlMember).toContain(SECRET);
      expect(created.headingsJson.member.map((h) => h.text)).toEqual([
        "Wlan",
        "Zugang",
        "Nachher",
      ]);
      expect(created.renderedHtmlGuest).not.toContain(SECRET);
      expect(created.renderedHtmlGuest).not.toContain("Zugang");
      expect(created.renderedHtmlGuest).toContain("Nachher");
      expect(created.plainText).not.toContain(SECRET);
      expect(created.plainText).not.toContain("Zugang");
      expect(created.plainText).toContain("Zuhause");
      expect(created.headingsJson.guest.map((h) => h.text)).toEqual([
        "Wlan",
        "Nachher",
      ]);
      expect(listRevisions(ctx(), created.slug)).toHaveLength(1);
    });

    it("fails closed: an unclosed or oddly written secret marker hides the rest", async () => {
      await user();
      const created = await page({
        bodyMd: `Oeffentlich\n\n> :::secretive\n> ${SECRET}\n\nauch hier ${SECRET}`,
      });
      expect(created.renderedHtmlGuest).not.toContain(SECRET);
      expect(created.plainText).not.toContain(SECRET);
    });

    it("the excerpt in listings is secret free", async () => {
      await user();
      await page({ bodyMd: `:::secret\n${SECRET}\n:::\nsichtbar` });
      const [item] = listPages(ctx(), {}, { limit: 10 }).items;
      expect(item!.plainText).not.toContain(SECRET);
    });
  });

  describe("links", () => {
    it("[[slug]] resolves to /docs/<slug> for members and to the guest pattern for guests", async () => {
      await user();
      const created = await page({
        bodyMd: "Siehe [[Küche]] und [[heizung|die Heizung]]",
      });
      expect(created.renderedHtmlMember).toContain('href="/docs/kueche"');
      expect(created.renderedHtmlMember).toContain('href="/docs/heizung"');
      expect(created.renderedHtmlGuest).toContain(
        `href="/g/${GUEST_TOKEN_PLACEHOLDER}/docs/kueche"`,
      );
      expect(fillGuestToken(created.renderedHtmlGuest, "tok en")).toContain(
        'href="/g/tok%20en/docs/kueche"',
      );
    });

    it("computes backlinks from other pages, ignoring archived pages and itself", async () => {
      await user();
      const target = await page({ title: "Boiler" });
      const a = await page({ title: "Anleitung", bodyMd: "Zum [[boiler]]" });
      await page({ title: "Mit Label", bodyMd: "[[Boiler|der Boiler]]" });
      await page({ title: "Anderswo", bodyMd: "[[heizung]]" });
      const self = await page({ title: "Selbst", bodyMd: "[[selbst]]" });
      const archived = await page({ title: "Alt", bodyMd: "[[boiler]]" });
      await updatePage(
        ctx(),
        archived.slug,
        { rev: 1, archived: true },
        userId,
      );
      expect(backlinksOf(ctx(), target).map((b) => b.title)).toEqual([
        "Anleitung",
        "Mit Label",
      ]);
      expect(backlinksOf(ctx(), self)).toEqual([]);
      expect(
        getPageDetail(ctx(), "boiler").backlinks.map((b) => b.slug),
      ).toEqual([a.slug, "mit-label"]);
    });
  });

  describe("attachments in pages", () => {
    async function withImage(guestVisible: boolean) {
      await user();
      const created = await page({ title: "Mit Bild" });
      const att = await createAttachment(ctx(), {
        bytes: plainPng(),
        filename: "bild.png",
        ownerType: "page",
        ownerId: created.id,
        guestVisible,
        uploadedBy: userId,
      });
      return { created, att };
    }

    it("resolves existing attachments for members and guest visible ones for guests", async () => {
      const { created, att } = await withImage(false);
      const saved = await updatePage(
        ctx(),
        created.slug,
        {
          rev: 1,
          bodyMd: `![Foto](attachment:${att.id})\n\n[PDF](attachment:${att.id})`,
        },
        userId,
      );
      expect(saved.renderedHtmlMember).toContain(
        `src="/api/v1/attachments/${att.id}/content"`,
      );
      expect(saved.renderedHtmlMember).toContain(
        `href="/api/v1/attachments/${att.id}/content"`,
      );
      const row = test.db
        .select()
        .from(docPages)
        .where(eq(docPages.id, created.id))
        .get()!;
      expect(row.renderedHtmlGuest).not.toContain("<img");
      expect(row.renderedHtmlGuest).not.toContain(att.id);

      updateAttachment(ctx(), att.id, { guestVisible: true });
      await settleBackgroundWork();
      // The re-render only happens when the hook is registered; do it directly here.
      await rerenderPagesUsing(ctx(), [att.id]);
      const after = test.db
        .select()
        .from(docPages)
        .where(eq(docPages.id, created.id))
        .get()!;
      expect(after.renderedHtmlGuest).toContain(
        `src="/g/${GUEST_TOKEN_PLACEHOLDER}/files/${att.id}"`,
      );
      expect(after.rev).toBe(2);
    });

    it("the startup listener refreshes embedding pages after a visibility change or a deletion", async () => {
      const stop = startAttachmentRerender();
      try {
        const { created, att } = await withImage(false);
        await updatePage(
          ctx(),
          created.slug,
          { rev: 1, bodyMd: `![Foto](attachment:${att.id})` },
          userId,
        );
        expect(getPage(ctx(), created.slug).renderedHtmlGuest).not.toContain(
          "<img",
        );

        updateAttachment(ctx(), att.id, { guestVisible: true });
        await settleBackgroundWork();
        expect(getPage(ctx(), created.slug).renderedHtmlGuest).toContain(
          `/g/${GUEST_TOKEN_PLACEHOLDER}/files/${att.id}`,
        );

        await deleteAttachment(ctx(), att.id);
        await settleBackgroundWork();
        const after = getPage(ctx(), created.slug);
        expect(after.renderedHtmlGuest).not.toContain("<img");
        expect(after.renderedHtmlMember).not.toContain("<img");
        expect(after.rev).toBe(2);
      } finally {
        stop();
      }
    });

    it("drops unknown attachment ids", async () => {
      await user();
      const saved = await page({
        bodyMd:
          "![x](attachment:does-not-exist)\n\n[y](attachment:also-missing)",
      });
      expect(saved.renderedHtmlMember).not.toContain("<img");
      expect(saved.renderedHtmlMember).not.toContain("<a ");
    });

    it("a deleted attachment disappears from the cached HTML", async () => {
      const { created, att } = await withImage(true);
      await updatePage(
        ctx(),
        created.slug,
        { rev: 1, bodyMd: `![Foto](attachment:${att.id})` },
        userId,
      );
      expect(getPage(ctx(), created.slug).renderedHtmlMember).toContain("<img");
      await deleteAttachment(ctx(), att.id);
      await rerenderPagesUsing(ctx(), [att.id]);
      const after = getPage(ctx(), created.slug);
      expect(after.renderedHtmlMember).not.toContain("<img");
      expect(after.renderedHtmlGuest).not.toContain("<img");
    });

    it("a re-render does not overwrite a save that happened in the meantime", async () => {
      const { created, att } = await withImage(true);
      await updatePage(
        ctx(),
        created.slug,
        { rev: 1, bodyMd: `![Foto](attachment:${att.id})` },
        userId,
      );
      const pending = rerenderPagesUsing(ctx(), [att.id]);
      await updatePage(
        ctx(),
        created.slug,
        { rev: 2, bodyMd: "neuer Text" },
        userId,
      );
      await pending;
      expect(getPage(ctx(), created.slug).renderedHtmlMember).toContain(
        "neuer Text",
      );
    });
  });

  describe("update and concurrency", () => {
    it("requires the current rev, answers 409 with it otherwise and bumps rev on every save", async () => {
      await user();
      const created = await page({ bodyMd: "eins" });
      const saved = await updatePage(
        ctx(),
        created.slug,
        { rev: 1, bodyMd: "zwei" },
        userId,
      );
      expect(saved).toMatchObject({ rev: 2, bodyMd: "zwei" });
      expect(saved.renderedHtmlMember).toContain("zwei");

      const stale = updatePage(
        ctx(),
        created.slug,
        { rev: 1, bodyMd: "drei" },
        userId,
      );
      await expect(stale).rejects.toMatchObject({
        code: "conflict",
        details: { currentRev: 2 },
      });
      expect(getPage(ctx(), created.slug).bodyMd).toBe("zwei");
      await expect(
        updatePage(ctx(), created.slug, { rev: 3, title: "x" }, userId),
      ).rejects.toMatchObject({
        code: "conflict",
      });
    });

    it("two concurrent saves from the same rev: exactly one wins", async () => {
      await user();
      const created = await page({ bodyMd: "start" });
      const results = await Promise.allSettled([
        updatePage(ctx(), created.slug, { rev: 1, bodyMd: "A" }, userId),
        updatePage(ctx(), created.slug, { rev: 1, bodyMd: "B" }, userId),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([
        "fulfilled",
        "rejected",
      ]);
      const rejected = results.find(
        (r) => r.status === "rejected",
      ) as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({
        code: "conflict",
        details: { currentRev: 2 },
      });
      expect(getPage(ctx(), created.slug).rev).toBe(2);
      expect(listRevisions(ctx(), created.slug).map((r) => r.rev)).toEqual([
        2, 1,
      ]);
    });

    it("changes metadata, archives and restores from the archive", async () => {
      await user();
      const room = createRoom(ctx(), { name: "Keller" });
      const created = await page({ bodyMd: "x" });
      const moved = await updatePage(
        ctx(),
        created.slug,
        {
          rev: 1,
          title: "Neu",
          slug: "neu",
          section: "rules",
          roomId: room.id,
          pinned: true,
          guestVisible: true,
          sortOrder: 3,
          archived: true,
        },
        userId,
      );
      expect(moved).toMatchObject({
        title: "Neu",
        slug: "neu",
        section: "rules",
        roomId: room.id,
        pinned: true,
        guestVisible: true,
        sortOrder: 3,
      });
      expect(moved.archivedAt).toBeInstanceOf(Date);
      expect(listPages(ctx(), {}, { limit: 10 }).items).toHaveLength(0);
      expect(
        listPages(ctx(), { includeArchived: true }, { limit: 10 }).items,
      ).toHaveLength(1);
      const back = await updatePage(
        ctx(),
        "neu",
        { rev: 2, archived: false },
        userId,
      );
      expect(back.archivedAt).toBeNull();
      expect(getPage(ctx(), "neu").renderedHtmlMember).toContain("x");
    });

    it("refuses a slug that is taken and clearing links to things that do not exist", async () => {
      await user();
      await page({ title: "Eins" });
      const two = await page({ title: "Zwei" });
      expect(
        await codeOf(
          updatePage(ctx(), two.slug, { rev: 1, slug: "eins" }, userId),
        ),
      ).toBe("conflict");
      expect(
        await codeOf(
          updatePage(ctx(), two.slug, { rev: 1, roomId: "nope" }, userId),
        ),
      ).toBe("invalid_request");
      const cleared = await updatePage(
        ctx(),
        two.slug,
        { rev: 1, roomId: null, assetId: null },
        userId,
      );
      expect(cleared).toMatchObject({ roomId: null, assetId: null });
    });

    it("does not render again when the body is unchanged", async () => {
      await user();
      const created = await page({ bodyMd: "x" });
      test.db
        .update(docPages)
        .set({ renderedHtmlMember: "MARK" })
        .where(eq(docPages.id, created.id))
        .run();
      await updatePage(
        ctx(),
        created.slug,
        { rev: 1, title: "Anders" },
        userId,
      );
      expect(getPage(ctx(), created.slug).renderedHtmlMember).toBe("MARK");
    });

    it("an unknown page is a 404", async () => {
      await user();
      expect(
        await codeOf(updatePage(ctx(), "nope", { rev: 1, title: "x" }, userId)),
      ).toBe("not_found");
      expect(() => getPage(ctx(), "nope")).toThrow(ApiError);
    });
  });

  describe("revisions", () => {
    it("keeps the last 50 and prunes older ones on save", async () => {
      await user();
      const created = await page({ bodyMd: "v1" });
      for (let rev = 1; rev < MAX_REVISIONS + 5; rev++) {
        await updatePage(
          ctx(),
          created.slug,
          { rev, title: `T${rev + 1}` },
          userId,
        );
      }
      const revisions = listRevisions(ctx(), created.slug);
      expect(revisions).toHaveLength(MAX_REVISIONS);
      expect(revisions[0]!.rev).toBe(MAX_REVISIONS + 5);
      expect(revisions.at(-1)!.rev).toBe(6);
      expect(() => getRevision(ctx(), created.slug, 5)).toThrow(ApiError);
      expect(getPage(ctx(), created.slug).rev).toBe(MAX_REVISIONS + 5);
    });

    it("restores an earlier revision as a new one, keeping the history", async () => {
      await user();
      const created = await page({ title: "Alt", bodyMd: "erste Fassung" });
      await updatePage(
        ctx(),
        created.slug,
        { rev: 1, title: "Neu", bodyMd: "zweite Fassung" },
        userId,
      );
      const restored = await restoreRevision(ctx(), created.slug, 1, userId);
      expect(restored).toMatchObject({
        rev: 3,
        title: "Alt",
        bodyMd: "erste Fassung",
      });
      expect(restored.renderedHtmlMember).toContain("erste Fassung");
      expect(listRevisions(ctx(), created.slug).map((r) => r.rev)).toEqual([
        3, 2, 1,
      ]);
      expect(getRevision(ctx(), created.slug, 2).bodyMd).toBe("zweite Fassung");
      await expect(
        restoreRevision(ctx(), created.slug, 9, userId),
      ).rejects.toMatchObject({ code: "not_found" });
    });

    it("lists size in bytes and who saved", async () => {
      const other = await createTestUser({ displayName: "Erika" });
      userId = other.id;
      const created = await page({ bodyMd: "äö" });
      const [rev] = listRevisions(ctx(), created.slug);
      expect(rev).toMatchObject({
        rev: 1,
        size: 4,
        userId: other.id,
        userName: "Erika",
      });
    });
  });

  describe("list", () => {
    it("filters, orders pinned first and searches by relevance", async () => {
      await user();
      const room = createRoom(ctx(), { name: "Bad" });
      await page({
        title: "Zebra",
        section: "howto",
        bodyMd: "Wie man Zebras füttert",
      });
      await page({
        title: "Alpha",
        section: "rules",
        roomId: room.id,
        pinned: true,
      });
      await page({
        title: "Beta",
        section: "howto",
        sortOrder: 5,
        bodyMd: "Zebra Zebra Zebra",
      });
      const all = listPages(ctx(), {}, { limit: 10 }).items;
      expect(all.map((p) => p.title)).toEqual(["Alpha", "Zebra", "Beta"]);
      expect(
        listPages(ctx(), { section: "howto" }, { limit: 10 }).items.map(
          (p) => p.title,
        ),
      ).toEqual(["Zebra", "Beta"]);
      expect(
        listPages(ctx(), { roomId: room.id }, { limit: 10 }).items.map(
          (p) => p.title,
        ),
      ).toEqual(["Alpha"]);
      expect(
        listPages(ctx(), { pinned: false }, { limit: 10 }).items,
      ).toHaveLength(2);
      const found = listPages(ctx(), { q: "zebra" }, { limit: 10 }).items.map(
        (p) => p.title,
      );
      expect(found.sort()).toEqual(["Beta", "Zebra"]);
      expect(
        listPages(ctx(), { q: "nichts-davon" }, { limit: 10 }).items,
      ).toEqual([]);
      const first = listPages(ctx(), {}, { limit: 2 });
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();
    });
  });

  describe("delete", () => {
    it("removes the page, its revisions and its attachments", async () => {
      await user();
      const created = await page({ bodyMd: "x" });
      await updatePage(ctx(), created.slug, { rev: 1, bodyMd: "y" }, userId);
      const att = await createAttachment(ctx(), {
        bytes: plainPng(),
        filename: "a.png",
        ownerType: "page",
        ownerId: created.id,
        uploadedBy: userId,
      });
      deletePage(ctx(), created.slug);
      expect(test.db.select().from(docPages).all()).toHaveLength(0);
      expect(test.db.select().from(docPageRevisions).all()).toHaveLength(0);
      expect(
        test.db
          .select()
          .from(attachments)
          .where(eq(attachments.id, att.id))
          .all(),
      ).toHaveLength(0);
      expect(() => getAttachment(ctx(), att.id)).toThrow(ApiError);
      expect(() => deletePage(ctx(), created.slug)).toThrow(ApiError);
    });

    it("pages of a deleted asset or room stay and lose the link", async () => {
      await user();
      const room = createRoom(ctx(), { name: "Bad" });
      const created = await page({ roomId: room.id });
      test.db.delete((await import("$lib/server/db")).rooms).run();
      expect(getPage(ctx(), created.slug).roomId).toBeNull();
    });
  });
});
