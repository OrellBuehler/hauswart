import { afterEach, describe, expect, it } from "vitest";
import { createApiClient } from "$lib/api/client";
import { endpoints } from "$lib/api/registry";
import { PREVIEWS_PER_MINUTE } from "$lib/server/auth/rate-limit";
import { shutdownMarkdownWorkers } from "$lib/server/docs/markdown-runner";
import { MAX_REVISIONS } from "$lib/server/docs/pages";
import {
  createCaller,
  createInProcessFetch,
  errorCode,
} from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { samplePdf, useTestFilesDir } from "$lib/testing/files";
import { plainPng } from "$lib/server/files/test-images";

const SECRET = "hidden-hidden-hidden";
const BODY = `# Wlan

Netz Zuhause.

:::secret
Passwort ${SECRET}
:::

## Weiter

Ende`;

interface PageBody {
  id: string;
  slug: string;
  title: string;
  rev: number;
  bodyMd: string;
  renderedHtml: string;
  headings: { level: number; text: string; id: string }[];
  backlinks: { slug: string; title: string }[];
  excerpt: string;
  section: string;
  pinned: boolean;
  guestVisible: boolean;
  archivedAt: string | null;
  updatedByName: string | null;
  commentCount: number;
}

afterEach(() => shutdownMarkdownWorkers());

describe("pages API", () => {
  useTestDB();
  useTestFilesDir();

  async function member(options: { displayName?: string } = {}) {
    const user = await createTestUser(options);
    return {
      user,
      call: createCaller({ session: loginTestUser(user).token }),
    };
  }
  const create = async (
    call: ReturnType<typeof createCaller>,
    json: Record<string, unknown>,
  ) => {
    const r = await call("POST", "/api/v1/pages", { json });
    expect(r.res.status, JSON.stringify(r.body)).toBe(201);
    return r.body as PageBody;
  };

  it("creates, reads, edits and deletes a page", async () => {
    const { call } = await member({ displayName: "Erika" });
    const created = await call("POST", "/api/v1/pages", {
      json: {
        title: "Heizung",
        section: "device",
        bodyMd: "# Anleitung\n\nText",
      },
    });
    expect(created.res.status).toBe(201);
    expect(created.body).toMatchObject({
      slug: "heizung",
      title: "Heizung",
      section: "device",
      rev: 1,
      pinned: false,
      guestVisible: false,
      archivedAt: null,
      updatedByName: "Erika",
      excerpt: "Anleitung Text",
      bodyMd: "# Anleitung\n\nText",
      backlinks: [],
      headings: [{ level: 1, text: "Anleitung", id: "h-anleitung" }],
    });
    expect((created.body as PageBody).renderedHtml).toContain("<h1");
    expect(created.body).not.toHaveProperty("renderedHtmlGuest");
    expect(created.body).not.toHaveProperty("renderedHtmlMember");
    expect(created.body).not.toHaveProperty("plainText");

    const got = await call("GET", "/api/v1/pages/heizung");
    expect(got.body).toEqual(created.body);

    const patched = await call("PATCH", "/api/v1/pages/heizung", {
      json: { rev: 1, bodyMd: "neu", pinned: true },
    });
    expect(patched.res.status).toBe(200);
    expect(patched.body).toMatchObject({ rev: 2, bodyMd: "neu", pinned: true });

    expect((await call("DELETE", "/api/v1/pages/heizung")).res.status).toBe(
      204,
    );
    expect(errorCode(await call("GET", "/api/v1/pages/heizung"))).toBe(
      "not_found",
    );
    expect(errorCode(await call("DELETE", "/api/v1/pages/heizung"))).toBe(
      "not_found",
    );
  });

  it("works through the typed client", async () => {
    const { user } = await member();
    const { token } = createTestToken(user);
    const api = createApiClient(createInProcessFetch({ bearer: token }));
    const page = await api.call(endpoints.pagesCreate, {
      body: { title: "Typisiert", bodyMd: "x" },
    });
    const saved = await api.call(endpoints.pagesUpdate, {
      params: { slug: page.slug },
      body: { rev: page.rev, title: "Neu" },
    });
    expect(saved.rev).toBe(2);
    const list = await api.call(endpoints.pagesList, {
      query: { q: "typisiert" },
    });
    expect(list.items).toEqual([]);
    const all = await api.call(endpoints.pagesList);
    expect(all.items.map((p) => p.slug)).toEqual(["typisiert"]);
  });

  describe("validation", () => {
    it("rejects bad input", async () => {
      const { call } = await member();
      await create(call, { title: "Vorhanden" });
      const cases: [string, Record<string, unknown>][] = [
        ["no title", {}],
        ["empty title", { title: "  " }],
        ["long title", { title: "x".repeat(201) }],
        ["bad section", { title: "x", section: "nope" }],
        ["unknown field", { title: "x", rev: 1 }],
        ["bad slug", { title: "x", slug: "Not A Slug" }],
        ["reserved slug", { title: "x", slug: "preview" }],
        ["body not a string", { title: "x", bodyMd: 5 }],
        ["negative sort order", { title: "x", sortOrder: -1 }],
      ];
      for (const [name, json] of cases) {
        const r = await call("POST", "/api/v1/pages", { json });
        expect([name, r.res.status, errorCode(r)]).toEqual([
          name,
          400,
          "invalid_request",
        ]);
      }
      expect(
        errorCode(
          await call("POST", "/api/v1/pages", {
            json: { title: "x", slug: "vorhanden" },
          }),
        ),
      ).toBe("conflict");
      expect(
        errorCode(
          await call("POST", "/api/v1/pages", {
            json: { title: "x", roomId: "nope" },
          }),
        ),
      ).toBe("invalid_request");
    });

    it("PATCH needs rev and at least one more field", async () => {
      const { call } = await member();
      await create(call, { title: "Seite" });
      for (const json of [
        {},
        { title: "x" },
        { rev: 0, title: "x" },
        { rev: 1 },
        { rev: "1", title: "x" },
        { rev: 1, unknown: 1 },
      ]) {
        const r = await call("PATCH", "/api/v1/pages/seite", { json });
        expect([JSON.stringify(json), r.res.status]).toEqual([
          JSON.stringify(json),
          400,
        ]);
      }
    });

    it("answers 400 too_large for markdown above 200 KB and 413 for a body beyond the request limit", async () => {
      const { call } = await member();
      const big = await call("POST", "/api/v1/pages", {
        json: { title: "Gross", bodyMd: "a".repeat(200 * 1024 + 1) },
      });
      expect(big.res.status).toBe(400);
      expect(big.body).toMatchObject({
        error: { code: "invalid_request", details: { code: "too_large" } },
      });
      const huge = await call("POST", "/api/v1/pages", {
        json: { title: "Riesig", bodyMd: "a".repeat(600 * 1024) },
      });
      expect(huge.res.status).toBe(413);
      expect((await call("GET", "/api/v1/pages")).body).toMatchObject({
        items: [],
      });
    });

    it("answers 400 too_complex when rendering does not finish in time", async () => {
      const { call } = await member();
      const r = await call("POST", "/api/v1/pages", {
        json: { title: "Komplex", bodyMd: "*a ".repeat(60_000) },
      });
      expect(r.res.status).toBe(400);
      expect(r.body).toMatchObject({
        error: { code: "invalid_request", details: { code: "too_complex" } },
      });
      const preview = await call("POST", "/api/v1/pages/preview", {
        json: { bodyMd: "*a ".repeat(60_000) },
      });
      expect(preview.body).toMatchObject({
        error: { details: { code: "too_complex" } },
      });
      // The pool recovered.
      expect(
        (
          await call("POST", "/api/v1/pages/preview", {
            json: { bodyMd: "ok" },
          })
        ).res.status,
      ).toBe(200);
    });
  });

  describe("concurrency", () => {
    it("a stale rev is a 409 conflict carrying the current rev", async () => {
      const { call } = await member();
      await create(call, { title: "Seite", bodyMd: "eins" });
      expect(
        (
          await call("PATCH", "/api/v1/pages/seite", {
            json: { rev: 1, bodyMd: "zwei" },
          })
        ).res.status,
      ).toBe(200);
      const stale = await call("PATCH", "/api/v1/pages/seite", {
        json: { rev: 1, bodyMd: "drei" },
      });
      expect(stale.res.status).toBe(409);
      expect(stale.body).toMatchObject({
        error: { code: "conflict", details: { currentRev: 2 } },
      });
      expect((await call("GET", "/api/v1/pages/seite")).body).toMatchObject({
        bodyMd: "zwei",
        rev: 2,
      });
    });

    it("two members saving from the same rev: one wins, one gets 409", async () => {
      const a = await member();
      const b = await member();
      await create(a.call, { title: "Seite" });
      const [one, two] = await Promise.all([
        a.call("PATCH", "/api/v1/pages/seite", {
          json: { rev: 1, bodyMd: "A" },
        }),
        b.call("PATCH", "/api/v1/pages/seite", {
          json: { rev: 1, bodyMd: "B" },
        }),
      ]);
      expect([one.res.status, two.res.status].sort()).toEqual([200, 409]);
    });
  });

  describe("revisions", () => {
    it("lists newest first, reads one with its markdown and restores", async () => {
      const { call } = await member({ displayName: "Erika" });
      await create(call, { title: "Alt", bodyMd: "erste" });
      await call("PATCH", "/api/v1/pages/alt", {
        json: { rev: 1, title: "Neu", bodyMd: "zweite" },
      });
      const list = await call("GET", "/api/v1/pages/alt/revisions");
      expect(list.body).toMatchObject({
        items: [
          { rev: 2, title: "Neu", size: 6, userName: "Erika" },
          { rev: 1, title: "Alt", size: 5, userName: "Erika" },
        ],
      });
      expect((list.body as { items: object[] }).items[0]).not.toHaveProperty(
        "bodyMd",
      );

      const one = await call("GET", "/api/v1/pages/alt/revisions/1");
      expect(one.body).toMatchObject({ rev: 1, title: "Alt", bodyMd: "erste" });

      const restored = await call(
        "POST",
        "/api/v1/pages/alt/revisions/1/restore",
      );
      expect(restored.res.status).toBe(200);
      expect(restored.body).toMatchObject({
        rev: 3,
        title: "Alt",
        bodyMd: "erste",
      });
      expect((restored.body as PageBody).renderedHtml).toContain("erste");

      expect(
        errorCode(await call("GET", "/api/v1/pages/alt/revisions/9")),
      ).toBe("not_found");
      expect(
        errorCode(await call("POST", "/api/v1/pages/alt/revisions/9/restore")),
      ).toBe("not_found");
      expect(
        errorCode(await call("GET", "/api/v1/pages/missing/revisions")),
      ).toBe("not_found");
      for (const rev of ["0", "-1", "abc", "1.5"]) {
        expect(
          (await call("GET", `/api/v1/pages/alt/revisions/${rev}`)).res.status,
          rev,
        ).toBe(400);
      }
    });

    it("keeps the last 50", async () => {
      const { call } = await member();
      await create(call, { title: "Seite" });
      for (let rev = 1; rev <= MAX_REVISIONS + 1; rev++) {
        const r = await call("PATCH", "/api/v1/pages/seite", {
          json: { rev, bodyMd: `v${rev}` },
        });
        expect(r.res.status).toBe(200);
      }
      const list = (await call("GET", "/api/v1/pages/seite/revisions"))
        .body as { items: { rev: number }[] };
      expect(list.items).toHaveLength(MAX_REVISIONS);
      expect(list.items[0]!.rev).toBe(MAX_REVISIONS + 2);
      expect(list.items.at(-1)!.rev).toBe(3);
    });
  });

  describe("secrets", () => {
    it("members see the secret in source and HTML; the excerpt, headings of hidden blocks and search do not leak it", async () => {
      const { call } = await member();
      const page = await create(call, { title: "WLAN", bodyMd: BODY });
      expect(page.bodyMd).toContain(SECRET);
      expect(page.renderedHtml).toContain(SECRET);
      expect(page.excerpt).not.toContain(SECRET);

      const list = await call("GET", "/api/v1/pages");
      expect(JSON.stringify(list.body)).not.toContain(SECRET);
      const hits = await call("GET", `/api/v1/search?q=${SECRET}`);
      expect(hits.body).toEqual({ items: [] });
      const found = await call("GET", "/api/v1/pages?q=zuhause");
      expect((found.body as { items: unknown[] }).items).toHaveLength(1);
      expect(
        JSON.stringify(await call("GET", "/api/v1/search?q=wlan")),
      ).not.toContain(SECRET);
      expect(
        (await call("GET", `/api/v1/pages?q=${SECRET}`)).body,
      ).toMatchObject({ items: [] });
    });
  });

  describe("list", () => {
    it("filters by section, asset, room, pinned and search, and pages with a cursor", async () => {
      const { call } = await member();
      const room = (
        await call("POST", "/api/v1/rooms", { json: { name: "Bad" } })
      ).body as { id: string };
      const asset = (
        await call("POST", "/api/v1/assets", { json: { name: "Boiler" } })
      ).body as { id: string };
      await create(call, { title: "A", section: "rules", pinned: true });
      await create(call, {
        title: "B",
        section: "device",
        assetId: asset.id,
        bodyMd: "Entkalken",
      });
      await create(call, { title: "C", section: "room", roomId: room.id });
      await create(call, { title: "D", section: "rules" });
      const titles = async (query: string) =>
        (
          (await call("GET", `/api/v1/pages${query}`)).body as {
            items: { title: string }[];
          }
        ).items.map((p) => p.title);
      expect(await titles("")).toEqual(["A", "B", "C", "D"]);
      expect(await titles("?section=rules")).toEqual(["A", "D"]);
      expect(await titles(`?assetId=${asset.id}`)).toEqual(["B"]);
      expect(await titles(`?roomId=${room.id}`)).toEqual(["C"]);
      expect(await titles("?pinned=true")).toEqual(["A"]);
      expect(await titles("?pinned=false")).toEqual(["B", "C", "D"]);
      expect(await titles("?q=entkalk")).toEqual(["B"]);
      const first = (await call("GET", "/api/v1/pages?limit=3")).body as {
        items: unknown[];
        nextCursor: string;
      };
      expect(first.items).toHaveLength(3);
      const second = (
        await call("GET", `/api/v1/pages?limit=3&cursor=${first.nextCursor}`)
      ).body as { items: { title: string }[]; nextCursor: string | null };
      expect(second.items.map((p) => p.title)).toEqual(["D"]);
      expect(second.nextCursor).toBeNull();
      for (const query of [
        "?section=nope",
        "?limit=0",
        "?limit=201",
        "?pinned=maybe",
        "?q=",
      ]) {
        expect(
          (await call("GET", `/api/v1/pages${query}`)).res.status,
          query,
        ).toBe(400);
      }
    });

    it("hides archived pages unless asked", async () => {
      const { call } = await member();
      await create(call, { title: "Alt" });
      await call("PATCH", "/api/v1/pages/alt", {
        json: { rev: 1, archived: true },
      });
      expect(
        ((await call("GET", "/api/v1/pages")).body as { items: unknown[] })
          .items,
      ).toEqual([]);
      const all = (await call("GET", "/api/v1/pages?includeArchived=true"))
        .body as { items: PageBody[] };
      expect(all.items).toHaveLength(1);
      expect(all.items[0]!.archivedAt).not.toBeNull();
      expect((await call("GET", "/api/v1/pages/alt")).res.status).toBe(200);
    });
  });

  describe("links", () => {
    it("lists backlinks of the page and resolves [[slug]] links", async () => {
      const { call } = await member();
      await create(call, { title: "Boiler" });
      const a = await create(call, {
        title: "Anleitung",
        bodyMd: "Siehe [[Boiler]] und [[nirgends]]",
      });
      expect(a.renderedHtml).toContain('href="/docs/boiler"');
      expect(a.renderedHtml).toContain('href="/docs/nirgends"');
      const boiler = (await call("GET", "/api/v1/pages/boiler"))
        .body as PageBody;
      expect(boiler.backlinks).toEqual([
        expect.objectContaining({ slug: "anleitung", title: "Anleitung" }),
      ]);
    });

    it("renders attachment links to the content url", async () => {
      const { call } = await member();
      const page = await create(call, { title: "Mit Bild" });
      const upload = async (bytes: Uint8Array, name: string, type: string) =>
        (
          await call("POST", "/api/v1/attachments", {
            form: {
              file: new File([bytes as BlobPart], name, { type }),
              ownerType: "page",
              ownerId: page.id,
            },
          })
        ).body as { id: string };
      const image = await upload(plainPng(), "bild.png", "image/png");
      const pdf = await upload(samplePdf(), "a.pdf", "application/pdf");
      const saved = await call("PATCH", "/api/v1/pages/mit-bild", {
        json: {
          rev: 1,
          bodyMd: `![Foto](attachment:${image.id})\n\n[Handbuch](attachment:${pdf.id})`,
        },
      });
      const html = (saved.body as PageBody).renderedHtml;
      expect(html).toContain(`src="/api/v1/attachments/${image.id}/content"`);
      expect(html).toContain(`href="/api/v1/attachments/${pdf.id}/content"`);
    });

    it("deleting the page deletes its attachments", async () => {
      const { call } = await member();
      const page = await create(call, { title: "Seite" });
      const att = (
        await call("POST", "/api/v1/attachments", {
          form: {
            file: new File([plainPng() as BlobPart], "a.png", {
              type: "image/png",
            }),
            ownerType: "page",
            ownerId: page.id,
          },
        })
      ).body as { id: string };
      await call("DELETE", "/api/v1/pages/seite");
      expect(
        errorCode(await call("GET", `/api/v1/attachments/${att.id}`)),
      ).toBe("not_found");
    });
  });

  describe("comments", () => {
    it("pages carry a comment count; deleting the page deletes its comments", async () => {
      const { call } = await member();
      const page = await create(call, { title: "Seite" });
      expect(page).toMatchObject({ commentCount: 0 });
      const posted = await call("POST", "/api/v1/comments", {
        json: { entityType: "doc_page", entityId: page.id, bodyMd: "Danke" },
      });
      expect(posted.res.status, JSON.stringify(posted.body)).toBe(201);
      const read = await call("GET", "/api/v1/pages/seite");
      expect(read.body).toMatchObject({ commentCount: 1 });
      const list = await call("GET", "/api/v1/pages");
      expect(
        (list.body as { items: { commentCount: number }[] }).items[0]
          .commentCount,
      ).toBe(1);
      await call("DELETE", "/api/v1/pages/seite");
      expect(
        errorCode(
          await call(
            "GET",
            `/api/v1/comments?entityType=doc_page&entityId=${page.id}`,
          ),
        ),
      ).toBe("not_found");
    });
  });

  describe("preview", () => {
    it("renders as a member would see it and stores nothing", async () => {
      const { call } = await member();
      const r = await call("POST", "/api/v1/pages/preview", {
        json: { bodyMd: BODY },
      });
      expect(r.res.status).toBe(200);
      const body = r.body as { html: string; headings: { text: string }[] };
      expect(body.html).toContain(SECRET);
      expect(body.html).toContain('<div class="secret">');
      expect(body.headings.map((h) => h.text)).toEqual(["Wlan", "Weiter"]);
      expect(
        ((await call("GET", "/api/v1/pages")).body as { items: unknown[] })
          .items,
      ).toEqual([]);
    });

    it("applies the same limits and sanitizes", async () => {
      const { call } = await member();
      const big = await call("POST", "/api/v1/pages/preview", {
        json: { bodyMd: "a".repeat(200 * 1024 + 1) },
      });
      expect(big.body).toMatchObject({
        error: { code: "invalid_request", details: { code: "too_large" } },
      });
      const xss = await call("POST", "/api/v1/pages/preview", {
        json: {
          bodyMd: [
            "<script>alert(1)</script>",
            "[x](javascript:alert(1))",
            "<img src=x onerror=alert(1)>",
          ].join("\n\n"),
        },
      });
      const html = (xss.body as { html: string }).html;
      expect(html).not.toMatch(/<script|javascript:|onerror/i);
      expect(
        (await call("POST", "/api/v1/pages/preview", { json: {} })).res.status,
      ).toBe(400);
      expect(
        (
          await call("POST", "/api/v1/pages/preview", {
            json: { bodyMd: "x", extra: 1 },
          })
        ).res.status,
      ).toBe(400);
    });

    it("is rate limited per user", async () => {
      const a = await member();
      const b = await member();
      for (let i = 0; i < PREVIEWS_PER_MINUTE; i++) {
        const r = await a.call("POST", "/api/v1/pages/preview", {
          json: { bodyMd: "x" },
        });
        expect(r.res.status).toBe(200);
      }
      const limited = await a.call("POST", "/api/v1/pages/preview", {
        json: { bodyMd: "x" },
      });
      expect([limited.res.status, errorCode(limited)]).toEqual([
        429,
        "rate_limited",
      ]);
      expect(Number(limited.res.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(
        (
          await b.call("POST", "/api/v1/pages/preview", {
            json: { bodyMd: "x" },
          })
        ).res.status,
      ).toBe(200);
    });
  });

  describe("scopes", () => {
    it("reading needs read, writing needs docs:write", async () => {
      const { user, call } = await member();
      await create(call, { title: "Seite", bodyMd: "x" });
      const reader = createCaller({
        bearer: createTestToken(user, { scopes: ["read"] }).token,
      });
      const writer = createCaller({
        bearer: createTestToken(user, { scopes: ["read", "docs:write"] }).token,
      });
      const general = createCaller({
        bearer: createTestToken(user, { scopes: ["read", "write"] }).token,
      });
      expect((await reader("GET", "/api/v1/pages/seite")).res.status).toBe(200);
      expect(
        (await reader("GET", "/api/v1/pages/seite/revisions")).res.status,
      ).toBe(200);
      expect((await reader("GET", "/api/v1/search?q=x")).res.status).toBe(200);
      for (const attempt of [
        () => reader("POST", "/api/v1/pages", { json: { title: "x" } }),
        () => general("POST", "/api/v1/pages", { json: { title: "x" } }),
        () =>
          general("PATCH", "/api/v1/pages/seite", {
            json: { rev: 1, title: "x" },
          }),
        () => general("DELETE", "/api/v1/pages/seite"),
        () => general("POST", "/api/v1/pages/seite/revisions/1/restore"),
        () =>
          general("POST", "/api/v1/pages/preview", { json: { bodyMd: "x" } }),
      ]) {
        const r = await attempt();
        expect([r.res.status, errorCode(r)]).toEqual([403, "forbidden"]);
      }
      expect(
        (
          await writer("PATCH", "/api/v1/pages/seite", {
            json: { rev: 1, title: "Neu" },
          })
        ).res.status,
      ).toBe(200);
      expect(
        (await writer("POST", "/api/v1/pages", { json: { title: "Zweite" } }))
          .res.status,
      ).toBe(201);
    });
  });
});
