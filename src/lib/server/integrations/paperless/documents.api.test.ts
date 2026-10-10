import { setLenientHostPolicy } from "$lib/server/net/host-policy";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  assets,
  docPages,
  documentLinks,
  externalDocuments,
} from "$lib/server/db";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { createPolicy, deletePolicy } from "$lib/server/insurance/policies";
import { allowIntegrationHosts } from "$lib/testing/integrations";
import { makeAsset } from "$lib/testing/documents";
import { syncAll } from "./sync";
import { TEST_CONFIG, seedTaxonomy, useFakePaperless } from "./testing";

const PDF = new TextEncoder().encode("%PDF-1.4 synthetic");

describe("document API", () => {
  const test = useTestDB();
  const { fake, connect } = useFakePaperless();
  const ctx = () => ({ db: test.db, now: Date.now() });

  /** Two household members, each with their own Paperless account (A is the fake's default one). */
  async function world(config: Record<string, unknown> = TEST_CONFIG) {
    const [a, b] = [await createTestUser(), await createTestUser()];
    fake.addAccount("token-b", { id: 2, username: "second", groups: [50] });
    seedTaxonomy(fake);
    connect(a.id, { config });
    connect(b.id, { token: "token-b", config });
    const as = (u: typeof a) =>
      createCaller({ session: loginTestUser(u).token });
    return { a, b, asA: as(a), asB: as(b) };
  }

  const items = (r: { body: unknown }) =>
    (r.body as { items: Array<Record<string, unknown>> }).items;

  describe("listing", () => {
    it("is a 404 for somebody without a connection, a 400 for a bad query", async () => {
      const { asA } = await world();
      const loner = await createTestUser();
      const asLoner = createCaller({ session: loginTestUser(loner).token });
      expect(errorCode(await asLoner("GET", "/api/v1/documents"))).toBe(
        "not_found",
      );
      expect((await asA("GET", "/api/v1/documents?q=")).res.status).toBe(400);
      expect((await asA("GET", "/api/v1/documents?tag=abc")).res.status).toBe(
        400,
      );
      expect(
        (await asA("GET", "/api/v1/documents?linked=maybe")).res.status,
      ).toBe(400);
    });

    it("lists the synced documents newest first, with where each is used", async () => {
      const { asA } = await world();
      const asset = makeAsset(ctx(), { name: "Boiler" });
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
        custom_fields: [{ field: 7, value: "2028-03-01" }],
      });
      fake.addDoc({ id: 12, title: "Private", tags: [4] });
      await syncAll(ctx());
      await asA("POST", "/api/v1/document-links", {
        json: {
          externalId: 11,
          ownerType: "asset",
          ownerId: asset.id,
          role: "manual",
        },
      });
      const r = await asA("GET", "/api/v1/documents");
      expect(r.res.status).toBe(200);
      expect(items(r).map((d) => d.title)).toEqual([
        "Boiler manual",
        "Old lease",
      ]);
      expect(items(r)[0]).toMatchObject({
        provider: "paperless",
        externalId: 11,
        createdDate: "2026-03-01",
        correspondentName: "Acme Heating",
        tagNames: ["Manual"],
        mimeType: "application/pdf",
        warrantyUntil: "2028-03-01",
        linkedTo: [
          {
            ownerType: "asset",
            ownerId: asset.id,
            ownerTitle: "Boiler",
            ownerUrl: `/assets/${asset.id}`,
            role: "manual",
          },
        ],
        thumbUrl: "/api/v1/documents/paperless/11/thumb",
        previewUrl: "/api/v1/documents/paperless/11/preview",
        downloadUrl: "/api/v1/documents/paperless/11/download",
      });
      expect(items(r)[1].linkedTo).toEqual([]);
    });

    it("filters by tag, correspondent and whether a document is linked", async () => {
      const { asA } = await world();
      const asset = makeAsset(ctx());
      fake.addDoc({ id: 10, title: "A", tags: [1, 3], correspondent: 20 });
      fake.addDoc({ id: 11, title: "B", tags: [3], correspondent: 21 });
      fake.addDoc({ id: 12, title: "C", tags: [1] });
      await syncAll(ctx());
      await asA("POST", "/api/v1/document-links", {
        json: { externalId: 12, ownerType: "asset", ownerId: asset.id },
      });
      const titles = async (query: string) =>
        items(await asA("GET", `/api/v1/documents${query}`))
          .map((d) => d.title)
          .sort();
      expect(await titles("?tag=3")).toEqual(["A", "B"]);
      expect(await titles("?tag=1&correspondent=20")).toEqual(["A"]);
      expect(await titles("?correspondent=21")).toEqual(["B"]);
      expect(await titles("?linked=true")).toEqual(["C"]);
      expect(await titles("?linked=false")).toEqual(["A", "B"]);
      expect(await titles("?tag=99")).toEqual([]);
    });

    it("pages", async () => {
      const { asA } = await world();
      for (let i = 1; i <= 5; i++) {
        fake.addDoc({
          id: i,
          title: `Doc ${i}`,
          tags: [1],
          created: `2026-01-0${i}`,
        });
      }
      await syncAll(ctx());
      const first = await asA("GET", "/api/v1/documents?limit=2");
      expect(items(first).map((d) => d.title)).toEqual(["Doc 5", "Doc 4"]);
      const next = (first.body as { nextCursor: string }).nextCursor;
      const second = await asA(
        "GET",
        `/api/v1/documents?limit=2&cursor=${next}`,
      );
      expect(items(second).map((d) => d.title)).toEqual(["Doc 3", "Doc 2"]);
    });

    it("searches live in the caller's own account, whatever is synced", async () => {
      const { asA, asB } = await world();
      fake.strictPermissions = true;
      fake.addDoc({ id: 10, title: "Oven warranty card", owner: 1 });
      fake.addDoc({ id: 11, title: "Oven manual", owner: null, tags: [3] });
      fake.addDoc({ id: 12, title: "Dishwasher receipt", owner: 1 });
      const a = await asA("GET", "/api/v1/documents?q=oven");
      expect(
        items(a)
          .map((d) => d.title)
          .sort(),
      ).toEqual(["Oven manual", "Oven warranty card"]);
      const b = await asB("GET", "/api/v1/documents?q=oven");
      expect(items(b).map((d) => d.title)).toEqual(["Oven manual"]);
      const search = fake.requestsTo("/api/documents/", "GET").at(-1)!;
      expect(search.query.get("text")).toBe("oven");
      expect(search.headers.get("authorization")).toBe("Token token-b");
    });

    it("a search can narrow by tag and correspondent and by linked", async () => {
      const { asA } = await world();
      const asset = makeAsset(ctx());
      fake.addDoc({ id: 10, title: "Filter A", tags: [3], correspondent: 20 });
      fake.addDoc({ id: 11, title: "Filter B", tags: [2], correspondent: 21 });
      await asA("POST", "/api/v1/document-links", {
        json: { externalId: 11, ownerType: "asset", ownerId: asset.id },
      });
      const titles = async (query: string) =>
        items(await asA("GET", `/api/v1/documents?q=filter${query}`)).map(
          (d) => d.title,
        );
      expect(await titles("&tag=3")).toEqual(["Filter A"]);
      expect(await titles("&correspondent=21")).toEqual(["Filter B"]);
      expect(await titles("&linked=true")).toEqual(["Filter B"]);
      expect(await titles("&linked=false")).toEqual(["Filter A"]);
    });

    it("answers 502 with the code when the document system is down or refuses the token", async () => {
      const { asA } = await world();
      fake.failNext("/api/documents/", 500);
      const down = await asA("GET", "/api/v1/documents?q=x");
      expect([down.res.status, errorCode(down)]).toEqual([
        502,
        "upstream_error",
      ]);
      expect(down.body).toMatchObject({
        error: { details: { code: "server" } },
      });
      fake.token = "rotated";
      const refused = await asA("GET", "/api/v1/documents?q=x");
      expect(refused.res.status).toBe(502);
      expect(refused.body).toMatchObject({
        error: { details: { code: "unauthorized" } },
      });
    });
  });

  describe("one document", () => {
    it("tells its metadata, the page it can be opened at and where it is used", async () => {
      const { a, asA } = await world();
      const asset = makeAsset(ctx(), { name: "Boiler" });
      fake.addDoc({
        id: 10,
        title: "Boiler manual",
        tags: [3],
        correspondent: 21,
        page_count: 12,
        notes: [{ id: 1, note: "n", created: "x", user: 1 }],
      });
      await asA("POST", "/api/v1/document-links", {
        json: {
          externalId: 10,
          ownerType: "asset",
          ownerId: asset.id,
          role: "manual",
          label: "Chapter 3",
        },
      });
      const r = await asA("GET", "/api/v1/documents/paperless/10");
      expect(r.res.status).toBe(200);
      expect(r.body).toMatchObject({
        title: "Boiler manual",
        pageCount: 12,
        noteCount: 1,
        tagNames: ["Manual"],
        correspondentName: "Acme Heating",
        webUrl: `${fake.baseUrl}/documents/10/details`,
        linkedTo: [{ role: "manual", ownerTitle: "Boiler" }],
        links: [
          {
            ownerType: "asset",
            ownerId: asset.id,
            ownerUrl: `/assets/${asset.id}`,
            label: "Chapter 3",
            available: true,
            createdBy: a.id,
            document: { title: "Boiler manual" },
          },
        ],
      });
    });

    it("is a 404 for a document the caller's own account cannot see, even when somebody else's can", async () => {
      const { asA, asB } = await world();
      fake.strictPermissions = true;
      fake.addDoc({ id: 10, title: "A's private letter", owner: 1 });
      expect(
        (await asA("GET", "/api/v1/documents/paperless/10")).res.status,
      ).toBe(200);
      const b = await asB("GET", "/api/v1/documents/paperless/10");
      expect([b.res.status, errorCode(b)]).toEqual([404, "not_found"]);
      expect(JSON.stringify(b.body)).not.toContain("private letter");
      const forB = fake
        .requestsTo("/api/documents/")
        .filter((r) => r.headers.get("authorization") === "Token token-b");
      expect(forB.length).toBeGreaterThan(0);
      expect(
        fake
          .requestsTo("/api/documents/")
          .some(
            (r) =>
              r.headers.get("authorization") === `Token ${fake.token}` &&
              r.query.get("id__in") === "10" &&
              fake.requests.indexOf(r) > fake.requests.indexOf(forB[0]),
          ),
      ).toBe(false);
    });

    it("is a 404 for an unknown document, without a connection, and a 400 for an id that is not a number or a provider that does not exist", async () => {
      const { asA } = await world();
      expect(
        (await asA("GET", "/api/v1/documents/paperless/999")).res.status,
      ).toBe(404);
      expect(
        (await asA("GET", "/api/v1/documents/paperless/abc")).res.status,
      ).toBe(400);
      expect(
        (await asA("GET", "/api/v1/documents/paperless/-4")).res.status,
      ).toBe(400);
      expect((await asA("GET", "/api/v1/documents/nowhere/1")).res.status).toBe(
        400,
      );
      const loner = await createTestUser();
      const asLoner = createCaller({ session: loginTestUser(loner).token });
      fake.addDoc({ id: 10 });
      const before = fake.requests.length;
      const r = await asLoner("GET", "/api/v1/documents/paperless/10");
      expect([r.res.status, errorCode(r)]).toEqual([404, "not_found"]);
      expect(fake.requests).toHaveLength(before);
    });

    it("a connection that is switched off is no connection", async () => {
      const user = await createTestUser();
      connect(user.id, { config: TEST_CONFIG, enabled: false });
      fake.addDoc({ id: 10 });
      const as = createCaller({ session: loginTestUser(user).token });
      expect(
        (await as("GET", "/api/v1/documents/paperless/10")).res.status,
      ).toBe(404);
      expect(fake.requests).toEqual([]);
    });
  });

  describe("files", () => {
    const addFile = (id = 10, over = {}) =>
      fake.addDoc({
        id,
        title: "Manual",
        original: PDF,
        archive: PDF,
        original_file_name: "Manual (final).pdf",
        ...over,
      });

    it("streams the preview inline with safe headers, through the caller's own account", async () => {
      const { asB } = await world();
      addFile();
      const r = await asB("GET", "/api/v1/documents/paperless/10/preview");
      expect(r.res.status).toBe(200);
      expect(r.body).toEqual(PDF);
      const h = r.res.headers;
      expect(h.get("content-type")).toBe("application/pdf");
      expect(h.get("content-disposition")).toMatch(
        /^inline; filename="Manual \(final\)\.pdf"/,
      );
      expect(h.get("x-content-type-options")).toBe("nosniff");
      expect(h.get("cache-control")).toMatch(/^private/);
      expect(h.get("content-security-policy")).toContain(
        "frame-ancestors 'self'",
      );
      expect(h.get("cross-origin-resource-policy")).toBe("same-origin");
      expect(h.get("content-length")).toBe(String(PDF.byteLength));
      expect(
        fake.requestsTo("/preview/").map((q) => q.headers.get("authorization")),
      ).toEqual(["Token token-b"]);
    });

    it("sends the download as an attachment, the original on request", async () => {
      const { asA } = await world();
      const original = new TextEncoder().encode("%PDF original");
      addFile(10, { original });
      const archived = await asA(
        "GET",
        "/api/v1/documents/paperless/10/download",
      );
      expect(archived.body).toEqual(PDF);
      expect(archived.res.headers.get("content-disposition")).toMatch(
        /^attachment;/,
      );
      const orig = await asA(
        "GET",
        "/api/v1/documents/paperless/10/download?original=1",
      );
      expect(orig.body).toEqual(original);
      expect(fake.requestsTo("/download/").at(-1)!.query.get("original")).toBe(
        "true",
      );
      expect(
        (await asA("GET", "/api/v1/documents/paperless/10/download?original=x"))
          .res.status,
      ).toBe(400);
    });

    it("sends the thumbnail as WebP", async () => {
      const { asA } = await world();
      addFile();
      const r = await asA("GET", "/api/v1/documents/paperless/10/thumb");
      expect(r.res.headers.get("content-type")).toBe("image/webp");
      expect(r.res.headers.get("cache-control")).toMatch(/^private/);
    });

    it.each([
      ["text/html", "<script>alert(1)</script>"],
      ["image/svg+xml", "<svg onload=alert(1)/>"],
      ["application/javascript", "alert(1)"],
    ])("never lets a %s document show inline", async (contentType, body) => {
      const { asA } = await world();
      addFile(10, {
        archive: new TextEncoder().encode(body),
        contentType,
      });
      const r = await asA("GET", "/api/v1/documents/paperless/10/preview");
      expect(r.res.headers.get("content-type")).toBe(
        "application/octet-stream",
      );
      expect(r.res.headers.get("content-disposition")).toMatch(/^attachment;/);
      expect(r.res.headers.get("content-security-policy")).toContain("sandbox");
    });

    it("keeps images inline", async () => {
      const { asA } = await world();
      addFile(10, {
        archive: new Uint8Array([1, 2, 3]),
        contentType: "image/png",
      });
      const r = await asA("GET", "/api/v1/documents/paperless/10/preview");
      expect(r.res.headers.get("content-type")).toBe("image/png");
      expect(r.res.headers.get("content-disposition")).toMatch(/^inline;/);
    });

    it("does not pass on a file name with path tricks or control characters", async () => {
      const { asA } = await world();
      addFile(10, {
        disposition:
          "attachment; filename*=UTF-8''..%2F..%2Fetc%2Fpasswd%00.pdf",
      });
      const r = await asA("GET", "/api/v1/documents/paperless/10/download");
      const header = r.res.headers.get("content-disposition")!;
      expect(header).not.toContain("/");
      expect(header).not.toMatch(/%2f|%00/i);
      expect(header).not.toContain("\u0000");
    });

    it("refuses a file above the size limit, before sending any of it", async () => {
      const { asA } = await world();
      addFile(10, { archive: new Uint8Array(26 * 1024 * 1024) });
      const r = await asA("GET", "/api/v1/documents/paperless/10/preview");
      expect([r.res.status, errorCode(r)]).toEqual([502, "upstream_error"]);
      expect(r.body).toMatchObject({
        error: { details: { code: "too_large" } },
      });
    });

    it("cuts off a body that outgrows the limit while it streams", async () => {
      const { asA } = await world();
      fake.downloadMode = "chunked";
      addFile(10, { archive: new Uint8Array(26 * 1024 * 1024) });
      const result = asA("GET", "/api/v1/documents/paperless/10/download");
      await expect(result).rejects.toThrow();
    });

    it("is a 404 for a document the account cannot see, and without a connection; the other account's token is never used", async () => {
      const { asA, asB } = await world();
      fake.strictPermissions = true;
      addFile(10, { owner: 1 });
      for (const kind of ["preview", "thumb", "download"]) {
        const b = await asB("GET", `/api/v1/documents/paperless/10/${kind}`);
        expect([b.res.status, errorCode(b)]).toEqual([404, "not_found"]);
        expect(
          (await asA("GET", `/api/v1/documents/paperless/10/${kind}`)).res
            .status,
        ).toBe(200);
      }
      const fileRequests = fake.requests.filter((r) =>
        /\/(preview|thumb|download)\//.test(r.path),
      );
      expect(fileRequests.map((r) => r.headers.get("authorization"))).toEqual([
        "Token token-b",
        `Token ${fake.token}`,
        "Token token-b",
        `Token ${fake.token}`,
        "Token token-b",
        `Token ${fake.token}`,
      ]);
      const loner = await createTestUser();
      const asLoner = createCaller({ session: loginTestUser(loner).token });
      const before = fake.requests.length;
      expect(
        (await asLoner("GET", "/api/v1/documents/paperless/10/preview")).res
          .status,
      ).toBe(404);
      expect(fake.requests).toHaveLength(before);
    });

    it("answers 502 when the account's token was revoked", async () => {
      const { asA } = await world();
      addFile();
      fake.token = "rotated";
      const r = await asA("GET", "/api/v1/documents/paperless/10/preview");
      expect(r.res.status).toBe(502);
      expect(r.body).toMatchObject({
        error: { details: { code: "unauthorized" } },
      });
    });

    it("works with a read token, and a token without scope is refused", async () => {
      const { a } = await world();
      addFile();
      const read = createTestToken(a, { scopes: ["read"], kind: "mcp" }).token;
      expect(
        (
          await createCaller({ bearer: read })(
            "GET",
            "/api/v1/documents/paperless/10/preview",
          )
        ).res.status,
      ).toBe(200);
      const none = createTestToken(a, { scopes: [], kind: "mcp" }).token;
      expect(
        (
          await createCaller({ bearer: none })(
            "GET",
            "/api/v1/documents/paperless/10/preview",
          )
        ).res.status,
      ).toBe(403);
    });
  });

  describe("links", () => {
    const link = (asset: { id: string }, over = {}) => ({
      externalId: 10,
      ownerType: "asset",
      ownerId: asset.id,
      role: "manual",
      ...over,
    });

    it("creates a link, caches what the account saw and answers with the document", async () => {
      const { a, asA } = await world();
      const asset = makeAsset(ctx(), { name: "Boiler" });
      fake.addDoc({
        id: 10,
        title: "Boiler manual",
        tags: [3],
        correspondent: 21,
        page_count: 4,
      });
      const r = await asA("POST", "/api/v1/document-links", {
        json: link(asset, { label: " Page 3 " }),
      });
      expect(r.res.status).toBe(201);
      expect(r.body).toMatchObject({
        provider: "paperless",
        externalId: 10,
        ownerType: "asset",
        ownerId: asset.id,
        ownerTitle: "Boiler",
        ownerUrl: `/assets/${asset.id}`,
        role: "manual",
        label: "Page 3",
        available: true,
        createdBy: a.id,
        document: {
          title: "Boiler manual",
          correspondentName: "Acme Heating",
          pageCount: 4,
          tagNames: ["Manual"],
        },
        thumbUrl: "/api/v1/documents/paperless/10/thumb",
      });
      const row = test.db.select().from(documentLinks).get()!;
      expect(row.connectionId).not.toBeNull();
      expect(test.db.select().from(externalDocuments).all()).toHaveLength(1);
    });

    it("links a document to an insurance policy as its policy or as the vehicle registration, and removes the links with the policy", async () => {
      const { asA } = await world();
      const policy = await createPolicy(ctx(), {
        title: "Kasko Kombi",
        type: "motor_full_casco",
        premiumMinor: 12_500,
        premiumPeriod: "quarterly",
        startDate: "2026-01-01",
        renewal: "auto",
        showOnEmergency: false,
        assetIds: [],
      });
      fake.addDoc({ id: 10, title: "Policy document" });
      fake.addDoc({ id: 11, title: "Registration document" });
      for (const [externalId, role] of [
        [10, "policy"],
        [11, "registration"],
      ] as const) {
        const r = await asA("POST", "/api/v1/document-links", {
          json: {
            externalId,
            ownerType: "insurance_policy",
            ownerId: policy.id,
            role,
          },
        });
        expect(r.res.status, role).toBe(201);
        expect(r.body).toMatchObject({
          ownerType: "insurance_policy",
          ownerTitle: "Kasko Kombi",
          ownerUrl: `/insurance/${policy.id}`,
          role,
        });
      }
      expect(
        items(
          await asA(
            "GET",
            `/api/v1/document-links?ownerType=insurance_policy&ownerId=${policy.id}`,
          ),
        )
          .map((l) => l.role)
          .sort(),
      ).toEqual(["policy", "registration"]);
      deletePolicy(ctx(), policy.id);
      expect(test.db.select().from(documentLinks).all()).toEqual([]);
    });

    it("defaults the role to other and the provider to the only one", async () => {
      const { asA } = await world();
      const asset = makeAsset(ctx());
      fake.addDoc({ id: 10 });
      const r = await asA("POST", "/api/v1/document-links", {
        json: { externalId: 10, ownerType: "asset", ownerId: asset.id },
      });
      expect(r.body).toMatchObject({
        role: "other",
        provider: "paperless",
        label: null,
      });
    });

    it("links the same document to several things and with several roles, but not twice with the same role", async () => {
      const { asA } = await world();
      const [a1, a2] = [
        makeAsset(ctx(), { name: "One" }),
        makeAsset(ctx(), { name: "Two" }),
      ];
      fake.addDoc({ id: 10 });
      expect(
        (await asA("POST", "/api/v1/document-links", { json: link(a1) })).res
          .status,
      ).toBe(201);
      expect(
        (
          await asA("POST", "/api/v1/document-links", {
            json: link(a1, { role: "receipt" }),
          })
        ).res.status,
      ).toBe(201);
      expect(
        (await asA("POST", "/api/v1/document-links", { json: link(a2) })).res
          .status,
      ).toBe(201);
      const again = await asA("POST", "/api/v1/document-links", {
        json: link(a1),
      });
      expect([again.res.status, errorCode(again)]).toEqual([409, "conflict"]);
      expect(test.db.select().from(documentLinks).all()).toHaveLength(3);
    });

    it("refuses an owner that does not exist and a document the account cannot see, storing nothing", async () => {
      const { asB } = await world();
      fake.strictPermissions = true;
      const asset = makeAsset(ctx());
      fake.addDoc({ id: 10, owner: 1 });
      const noOwner = await asB("POST", "/api/v1/document-links", {
        json: link({ id: "missing" }),
      });
      expect(noOwner.res.status).toBe(400);
      const hidden = await asB("POST", "/api/v1/document-links", {
        json: link(asset),
      });
      expect([hidden.res.status, errorCode(hidden)]).toEqual([
        404,
        "not_found",
      ]);
      const unknown = await asB("POST", "/api/v1/document-links", {
        json: link(asset, { externalId: 555 }),
      });
      expect(unknown.res.status).toBe(404);
      expect(test.db.select().from(documentLinks).all()).toEqual([]);
      // What the account was told is remembered as "not visible", without content.
      expect(
        test.db
          .select()
          .from(externalDocuments)
          .all()
          .map((r) => [r.externalId, r.ownerVisible, r.title]),
      ).toEqual([
        [10, false, ""],
        [555, false, ""],
      ]);
    });

    it("needs a connection of one's own", async () => {
      await world();
      const loner = await createTestUser();
      const asLoner = createCaller({ session: loginTestUser(loner).token });
      const asset = makeAsset(ctx());
      const r = await asLoner("POST", "/api/v1/document-links", {
        json: link(asset),
      });
      expect([r.res.status, errorCode(r)]).toEqual([404, "not_found"]);
    });

    it.each([
      ["an unknown owner type", { ownerType: "guest" }],
      ["an unknown role", { role: "photo" }],
      ["an unknown provider", { provider: "elsewhere" }],
      ["a document id that is not positive", { externalId: 0 }],
      ["a label that is too long", { label: "x".repeat(201) }],
      ["an unknown field", { extra: 1 }],
    ])("rejects %s", async (_name, over) => {
      const { asA } = await world();
      const asset = makeAsset(ctx());
      fake.addDoc({ id: 10 });
      const r = await asA("POST", "/api/v1/document-links", {
        json: link(asset, over),
      });
      expect(r.res.status).toBe(400);
    });

    it("lists by owner or by document, with availability for the caller", async () => {
      const { asA } = await world();
      const [a1, a2] = [
        makeAsset(ctx(), { name: "One" }),
        makeAsset(ctx(), { name: "Two" }),
      ];
      fake.addDoc({ id: 10, title: "Doc ten" });
      fake.addDoc({ id: 11, title: "Doc eleven" });
      await asA("POST", "/api/v1/document-links", { json: link(a1) });
      await asA("POST", "/api/v1/document-links", {
        json: link(a1, { externalId: 11 }),
      });
      await asA("POST", "/api/v1/document-links", { json: link(a2) });
      const byOwner = await asA(
        "GET",
        `/api/v1/document-links?ownerType=asset&ownerId=${a1.id}`,
      );
      expect(
        items(byOwner)
          .map((l) => (l.document as { title: string }).title)
          .sort(),
      ).toEqual(["Doc eleven", "Doc ten"]);
      const byDoc = await asA(
        "GET",
        "/api/v1/document-links?provider=paperless&externalId=10",
      );
      expect(
        items(byDoc)
          .map((l) => l.ownerTitle)
          .sort(),
      ).toEqual(["One", "Two"]);
      expect(
        items(
          await asA("GET", "/api/v1/document-links?ownerType=room&ownerId=x"),
        ),
      ).toEqual([]);
      expect(
        (await asA("GET", "/api/v1/document-links?ownerType=cat")).res.status,
      ).toBe(400);
    });

    it("a document that is not shared with the caller shows as not shared, a shared one with its title", async () => {
      const { a, asA, asB } = await world();
      fake.strictPermissions = true;
      const asset = makeAsset(ctx(), { name: "Boiler" });
      fake.addDoc({ id: 10, title: "A's private letter", owner: 1 });
      fake.addDoc({ id: 11, title: "Shared lease", owner: 1 });
      fake.docs.get(11)!.permissions.view.groups = [50];
      await asA("POST", "/api/v1/document-links", {
        json: link(asset, { label: "Letter" }),
      });
      await asA("POST", "/api/v1/document-links", {
        json: link(asset, { externalId: 11 }),
      });
      await syncAll(ctx());
      const mine = await asA(
        "GET",
        `/api/v1/document-links?ownerType=asset&ownerId=${asset.id}`,
      );
      expect(items(mine).every((l) => l.available === true)).toBe(true);
      const theirs = await asB(
        "GET",
        `/api/v1/document-links?ownerType=asset&ownerId=${asset.id}`,
      );
      const byId = Object.fromEntries(
        items(theirs).map((l) => [l.externalId, l]),
      );
      expect(byId[10]).toMatchObject({
        available: false,
        document: null,
        thumbUrl: null,
        previewUrl: null,
        downloadUrl: null,
        label: "Letter",
        createdBy: a.id,
        ownerTitle: "Boiler",
      });
      expect(byId[11]).toMatchObject({
        available: true,
        document: { title: "Shared lease" },
      });
      expect(JSON.stringify(theirs.body)).not.toContain("private letter");
      // The same goes for the lists of documents and for one document.
      const detail = await asB("GET", "/api/v1/documents/paperless/11");
      expect(detail.res.status).toBe(200);
    });

    it("nobody can read through a link what their own account cannot", async () => {
      const { asA, asB } = await world();
      fake.strictPermissions = true;
      const asset = makeAsset(ctx());
      fake.addDoc({
        id: 10,
        title: "Private",
        owner: 1,
        original: PDF,
        archive: PDF,
      });
      await asA("POST", "/api/v1/document-links", { json: link(asset) });
      await syncAll(ctx());
      const links = await asB(
        "GET",
        `/api/v1/document-links?ownerType=asset&ownerId=${asset.id}`,
      );
      expect(items(links)[0].available).toBe(false);
      expect(
        (await asB("GET", "/api/v1/documents/paperless/10/preview")).res.status,
      ).toBe(404);
      expect(
        (await asB("GET", "/api/v1/documents/paperless/10")).res.status,
      ).toBe(404);
      expect(items(await asB("GET", "/api/v1/documents"))).toEqual([]);
    });

    it("another person's document becomes available to a person once their account can read it, after their next sync", async () => {
      const { asA, asB } = await world();
      fake.strictPermissions = true;
      const asset = makeAsset(ctx());
      fake.addDoc({ id: 10, title: "Will be shared", owner: 1 });
      await asA("POST", "/api/v1/document-links", { json: link(asset) });
      await syncAll(ctx());
      const list = () =>
        asB(
          "GET",
          `/api/v1/document-links?ownerType=asset&ownerId=${asset.id}`,
        );
      expect(items(await list())[0].available).toBe(false);
      fake.docs.get(10)!.permissions.view.groups = [50];
      await syncAll(ctx(), { ignoreBackoff: true });
      expect(items(await list())[0]).toMatchObject({
        available: true,
        document: { title: "Will be shared" },
      });
    });

    it("deletes only the link; any member may", async () => {
      const { asA, asB } = await world();
      const asset = makeAsset(ctx());
      fake.addDoc({ id: 10 });
      const made = await asA("POST", "/api/v1/document-links", {
        json: link(asset),
      });
      const id = (made.body as { id: string }).id;
      expect(
        (await asB("DELETE", `/api/v1/document-links/${id}`)).res.status,
      ).toBe(204);
      expect(test.db.select().from(documentLinks).all()).toEqual([]);
      expect(fake.docs.has(10)).toBe(true);
      expect(
        (await asA("DELETE", `/api/v1/document-links/${id}`)).res.status,
      ).toBe(404);
    });

    it("a link to a page needs the documentation scope, others the write scope", async () => {
      const { a } = await world();
      const page = test.db
        .insert(docPages)
        .values({ slug: "rules", title: "Rules", bodyMd: "x" })
        .returning()
        .get();
      const asset = makeAsset(ctx());
      fake.addDoc({ id: 10 });
      const writer = createCaller({
        bearer: createTestToken(a, { scopes: ["read", "write"], kind: "mcp" })
          .token,
      });
      const docsWriter = createCaller({
        bearer: createTestToken(a, {
          scopes: ["read", "write", "docs:write"],
          kind: "mcp",
        }).token,
      });
      const reader = createCaller({
        bearer: createTestToken(a, { scopes: ["read"], kind: "mcp" }).token,
      });
      const onPage = {
        externalId: 10,
        ownerType: "page",
        ownerId: page.id,
        role: "manual",
      };
      expect(
        (await writer("POST", "/api/v1/document-links", { json: onPage })).res
          .status,
      ).toBe(403);
      expect(
        (await reader("POST", "/api/v1/document-links", { json: link(asset) }))
          .res.status,
      ).toBe(403);
      const made = await docsWriter("POST", "/api/v1/document-links", {
        json: onPage,
      });
      expect(made.res.status).toBe(201);
      const id = (made.body as { id: string }).id;
      expect(
        (await writer("DELETE", `/api/v1/document-links/${id}`)).res.status,
      ).toBe(403);
      expect(
        (await docsWriter("DELETE", `/api/v1/document-links/${id}`)).res.status,
      ).toBe(204);
      expect((await reader("GET", "/api/v1/document-links")).res.status).toBe(
        200,
      );
    });
  });

  describe("warranty dates", () => {
    it("a receipt linked to an asset sets its warranty, and the asset says where the dates came from", async () => {
      const { asA } = await world();
      const asset = makeAsset(ctx(), { name: "Dishwasher" });
      fake.addDoc({
        id: 10,
        title: "Dishwasher receipt",
        tags: [2],
        custom_fields: [
          { field: 7, value: "2028-03-04" },
          { field: 8, value: "2029-03-04" },
        ],
      });
      await asA("POST", "/api/v1/document-links", {
        json: {
          externalId: 10,
          ownerType: "asset",
          ownerId: asset.id,
          role: "receipt",
        },
      });
      const r = await asA("GET", `/api/v1/assets/${asset.id}`);
      expect(r.body).toMatchObject({
        warrantyUntil: "2028-03-04",
        warrantyExtendedUntil: "2029-03-04",
        warrantySource: "document",
      });
      const warranties = await asA("GET", "/api/v1/warranties");
      expect(items(warranties).map((w) => w.assetId)).toEqual([asset.id]);
    });

    it("follows the document at the next sync until a person edits the dates", async () => {
      const { asA } = await world();
      const asset = makeAsset(ctx());
      fake.addDoc({
        id: 10,
        tags: [2],
        custom_fields: [{ field: 7, value: "2028-03-04" }],
      });
      await asA("POST", "/api/v1/document-links", {
        json: {
          externalId: 10,
          ownerType: "asset",
          ownerId: asset.id,
          role: "warranty",
        },
      });
      const doc = fake.docs.get(10)!;
      doc.custom_fields = [{ field: 7, value: "2031-01-01" }];
      doc.modified = "2026-09-30T10:00:00+00:00";
      await syncAll(ctx(), { ignoreBackoff: true });
      expect(
        test.db.select().from(assets).where(eq(assets.id, asset.id)).get(),
      ).toMatchObject({
        warrantyUntil: "2031-01-01",
        warrantySource: "document",
      });

      const edit = await asA("PATCH", `/api/v1/assets/${asset.id}`, {
        json: { warrantyUntil: "2027-01-01" },
      });
      expect(edit.body).toMatchObject({
        warrantyUntil: "2027-01-01",
        warrantySource: "manual",
      });
      doc.custom_fields = [{ field: 7, value: "2035-01-01" }];
      doc.modified = "2026-10-01T10:00:00+00:00";
      await syncAll(ctx(), { ignoreBackoff: true });
      expect(
        test.db.select().from(assets).where(eq(assets.id, asset.id)).get()!
          .warrantyUntil,
      ).toBe("2027-01-01");
    });

    it("never overwrites dates that were typed before the document was linked", async () => {
      const { asA } = await world();
      const asset = makeAsset(ctx(), { warrantyUntil: "2027-05-05" });
      fake.addDoc({
        id: 10,
        tags: [2],
        custom_fields: [{ field: 7, value: "2030-01-01" }],
      });
      await asA("POST", "/api/v1/document-links", {
        json: {
          externalId: 10,
          ownerType: "asset",
          ownerId: asset.id,
          role: "receipt",
        },
      });
      expect(
        (await asA("GET", `/api/v1/assets/${asset.id}`)).body,
      ).toMatchObject({
        warrantyUntil: "2027-05-05",
        warrantySource: "manual",
      });
    });

    it("a manual link or one without the configured field leaves the asset alone", async () => {
      const { asA } = await world();
      const asset = makeAsset(ctx());
      fake.addDoc({
        id: 10,
        tags: [2],
        custom_fields: [{ field: 99, value: "2030-01-01" }],
      });
      fake.addDoc({
        id: 11,
        tags: [2],
        custom_fields: [{ field: 7, value: "2030-01-01" }],
      });
      await asA("POST", "/api/v1/document-links", {
        json: {
          externalId: 10,
          ownerType: "asset",
          ownerId: asset.id,
          role: "receipt",
        },
      });
      await asA("POST", "/api/v1/document-links", {
        json: {
          externalId: 11,
          ownerType: "asset",
          ownerId: asset.id,
          role: "manual",
        },
      });
      expect(
        (await asA("GET", `/api/v1/assets/${asset.id}`)).body,
      ).toMatchObject({
        warrantyUntil: null,
        warrantySource: "manual",
      });
    });

    it("a date field that is not a date is ignored", async () => {
      const { asA } = await world();
      const asset = makeAsset(ctx());
      fake.addDoc({
        id: 10,
        tags: [2],
        custom_fields: [{ field: 7, value: "soon" }],
      });
      await asA("POST", "/api/v1/document-links", {
        json: {
          externalId: 10,
          ownerType: "asset",
          ownerId: asset.id,
          role: "receipt",
        },
      });
      expect(
        (await asA("GET", `/api/v1/assets/${asset.id}`)).body,
      ).toMatchObject({ warrantyUntil: null });
    });
  });

  describe("suggestions", () => {
    it("offers receipts for the inventory and shrinks as they are linked", async () => {
      const { asA, asB } = await world();
      fake.addDoc({
        id: 10,
        title: "Oven receipt",
        tags: [2],
        correspondent: 20,
        created: "2026-04-01",
        custom_fields: [{ field: 7, value: "2028-04-01" }],
      });
      fake.addDoc({ id: 11, title: "Receipt without warranty", tags: [2] });
      fake.addDoc({ id: 12, title: "Lease", tags: [1] });
      await syncAll(ctx());
      const first = await asA(
        "GET",
        "/api/v1/documents/suggestions?kind=asset",
      );
      expect(items(first)).toEqual([
        {
          kind: "asset",
          provider: "paperless",
          externalId: 10,
          title: "Oven receipt",
          createdDate: "2026-04-01",
          correspondentName: "Example Shop",
          warrantyUntil: "2028-04-01",
          warrantyExtendedUntil: null,
        },
      ]);
      // The other person is offered it from their own cache too.
      const other = () =>
        asB("GET", "/api/v1/documents/suggestions?kind=asset");
      expect(items(await other()).map((i) => i.externalId)).toEqual([10]);
      // Accepting = creating the asset and linking the receipt.
      const created = await asA("POST", "/api/v1/assets", {
        json: { name: "Oven" },
      });
      const assetId = (created.body as { id: string }).id;
      await asA("POST", "/api/v1/document-links", {
        json: {
          externalId: 10,
          ownerType: "asset",
          ownerId: assetId,
          role: "receipt",
        },
      });
      expect(
        items(await asA("GET", "/api/v1/documents/suggestions?kind=asset")),
      ).toEqual([]);
      expect(
        (await asA("GET", `/api/v1/assets/${assetId}`)).body,
      ).toMatchObject({
        warrantyUntil: "2028-04-01",
        warrantySource: "document",
      });
      // Linked, so nobody is offered it any more.
      await syncAll(ctx());
      expect(
        items(await asB("GET", "/api/v1/documents/suggestions?kind=asset")),
      ).toEqual([]);
    });

    it("offers correspondents that no contact stands for, with the reference to give the contact", async () => {
      const { asA } = await world();
      fake.addDoc({ id: 10, tags: [1], correspondent: 20 });
      fake.addDoc({ id: 11, tags: [1], correspondent: 20 });
      fake.addDoc({ id: 12, tags: [3], correspondent: 21 });
      await syncAll(ctx());
      const first = await asA(
        "GET",
        "/api/v1/documents/suggestions?kind=contact",
      );
      expect(items(first)).toEqual([
        {
          kind: "contact",
          provider: "paperless",
          correspondentId: 21,
          name: "Acme Heating",
          documentCount: 1,
          externalSource: "document_correspondent",
          externalRef: "paperless:21",
        },
        {
          kind: "contact",
          provider: "paperless",
          correspondentId: 20,
          name: "Example Shop",
          documentCount: 2,
          externalSource: "document_correspondent",
          externalRef: "paperless:20",
        },
      ]);
      const made = await asA("POST", "/api/v1/contacts", {
        json: {
          name: "Acme Heating",
          externalSource: "document_correspondent",
          externalRef: "paperless:21",
        },
      });
      expect(made.res.status).toBe(201);
      expect(
        items(
          await asA("GET", "/api/v1/documents/suggestions?kind=contact"),
        ).map((s) => s.name),
      ).toEqual(["Example Shop"]);
    });

    it("rejects an unknown kind and needs a connection", async () => {
      const { asA } = await world();
      expect(
        (await asA("GET", "/api/v1/documents/suggestions?kind=room")).res
          .status,
      ).toBe(400);
      expect(
        (await asA("GET", "/api/v1/documents/suggestions")).res.status,
      ).toBe(400);
      const loner = await createTestUser();
      const asLoner = createCaller({ session: loginTestUser(loner).token });
      expect(
        (await asLoner("GET", "/api/v1/documents/suggestions?kind=asset")).res
          .status,
      ).toBe(404);
    });
  });

  describe("search", () => {
    it("finds linked documents by title, only for people whose account can read them", async () => {
      const { asA, asB } = await world();
      fake.strictPermissions = true;
      const asset = makeAsset(ctx(), { name: "Boiler" });
      fake.addDoc({ id: 10, title: "Boiler service contract", owner: 1 });
      fake.addDoc({ id: 11, title: "Boiler guarantee", owner: null });
      for (const externalId of [10, 11]) {
        await asA("POST", "/api/v1/document-links", {
          json: { externalId, ownerType: "asset", ownerId: asset.id },
        });
      }
      await syncAll(ctx());
      const a = await asA("GET", "/api/v1/search?q=boiler");
      expect(
        items(a)
          .filter((h) => h.type === "document")
          .map((h) => [h.id, h.title, h.snippet, h.url]),
      ).toEqual([
        ["paperless:11", "Boiler guarantee", "Boiler", `/assets/${asset.id}`],
        [
          "paperless:10",
          "Boiler service contract",
          "Boiler",
          `/assets/${asset.id}`,
        ],
      ]);
      expect(items(a).some((h) => h.type === "asset")).toBe(true);
      const b = await asB("GET", "/api/v1/search?q=boiler");
      expect(
        items(b)
          .filter((h) => h.type === "document")
          .map((h) => h.id),
      ).toEqual(["paperless:11"]);
      expect(JSON.stringify(b.body)).not.toContain("service contract");
      const onlyDocs = await asA(
        "GET",
        "/api/v1/search?q=boiler&type=document",
      );
      expect(items(onlyDocs).every((h) => h.type === "document")).toBe(true);
      const noDocs = await asA("GET", "/api/v1/search?q=boiler&type=asset");
      expect(items(noDocs).some((h) => h.type === "document")).toBe(false);
    });

    it("does not search the text of documents", async () => {
      const { asA } = await world();
      const asset = makeAsset(ctx());
      fake.addDoc({ id: 10, title: "Contract", content: "secretword inside" });
      await asA("POST", "/api/v1/document-links", {
        json: { externalId: 10, ownerType: "asset", ownerId: asset.id },
      });
      expect(items(await asA("GET", "/api/v1/search?q=secretword"))).toEqual(
        [],
      );
    });

    it("works for somebody without a connection", async () => {
      await world();
      const loner = await createTestUser();
      const asLoner = createCaller({ session: loginTestUser(loner).token });
      makeAsset(ctx(), { name: "Boiler" });
      const r = await asLoner("GET", "/api/v1/search?q=boiler");
      expect(r.res.status).toBe(200);
      expect(items(r).map((h) => h.type)).toEqual(["asset"]);
    });
  });

  describe("connection settings and pickers", () => {
    it("every person connects their own account; nobody sees another's", async () => {
      const [a, b] = [await createTestUser(), await createTestUser()];
      seedTaxonomy(fake);
      allowIntegrationHosts(test.db, "127.0.0.1");
      const asA = createCaller({ session: loginTestUser(a).token });
      const asB = createCaller({ session: loginTestUser(b).token });
      const saved = await asA("PUT", "/api/v1/integrations/paperless", {
        json: {
          baseUrl: `${fake.baseUrl}/`,
          token: fake.token,
          allowInsecureTls: false,
          config: {
            sharedTagIds: [1],
            receiptTagIds: [2],
            junk: true,
            writeBackNotes: true,
          },
        },
      });
      expect(saved.res.status).toBe(200);
      expect(saved.body).toMatchObject({
        kind: "paperless",
        level: "user",
        available: true,
        configured: true,
        baseUrl: fake.baseUrl,
        config: { sharedTagIds: [1], receiptTagIds: [2], writeBackNotes: true },
      });
      expect(saved.body).not.toHaveProperty("config.junk");
      expect(JSON.stringify(saved.body)).not.toContain(fake.token);
      const theirs = items(await asB("GET", "/api/v1/integrations")).find(
        (i) => i.kind === "paperless",
      )!;
      expect(theirs).toMatchObject({
        configured: false,
        baseUrl: null,
        config: {},
      });
      expect(
        (await asB("DELETE", "/api/v1/integrations/paperless")).res.status,
      ).toBe(404);
      expect(
        (await asB("POST", "/api/v1/integrations/paperless/test")).res.status,
      ).toBe(404);
      const mine = await asA("POST", "/api/v1/integrations/paperless/test");
      expect(mine.body).toMatchObject({
        ok: true,
        info: { version: "2.20.3" },
      });
    });

    it("never calls a loopback address for a member, but does for an administrator", async () => {
      setLenientHostPolicy(false);
      const admin = await createTestUser({ role: "admin" });
      const member = await createTestUser();
      connect(admin.id);
      connect(member.id);
      const asAdmin = createCaller({ session: loginTestUser(admin).token });
      const asMember = createCaller({ session: loginTestUser(member).token });
      const url = "/api/v1/integrations/paperless/test";
      const blocked = await asMember("POST", url);
      expect(blocked.body).toMatchObject({
        ok: false,
        error: { code: "blocked_host" },
      });
      expect(fake.requests).toEqual([]);
      expect(
        (await asMember("GET", "/api/v1/integrations/paperless/tags")).res
          .status,
      ).toBe(502);
      expect(fake.requests).toEqual([]);
      expect((await asAdmin("POST", url)).body).toMatchObject({ ok: true });
      expect(fake.requests.length).toBeGreaterThan(0);
    });

    it("refuses invalid settings with a message about the settings", async () => {
      const a = await createTestUser();
      const asA = createCaller({ session: loginTestUser(a).token });
      allowIntegrationHosts(test.db, "127.0.0.1");
      const r = await asA("PUT", "/api/v1/integrations/paperless", {
        json: {
          baseUrl: fake.baseUrl,
          token: "t",
          allowInsecureTls: false,
          config: { sharedTagIds: ["x"] },
        },
      });
      expect(r.res.status).toBe(400);
    });

    it.each([
      [
        "tags",
        "/api/v1/integrations/paperless/tags",
        ["Apartment", "From hauswart", "Manual", "Private", "Receipt"],
      ],
      [
        "correspondents",
        "/api/v1/integrations/paperless/correspondents",
        ["Acme Heating", "Example Shop"],
      ],
      [
        "custom fields",
        "/api/v1/integrations/paperless/custom-fields",
        ["Warranty extended", "Warranty until"],
      ],
      ["groups", "/api/v1/integrations/paperless/groups", ["Household"]],
      [
        "storage paths",
        "/api/v1/integrations/paperless/storage-paths",
        ["Apartment"],
      ],
    ])(
      "offers the %s of the caller's own account",
      async (_name, path, names) => {
        const { asA } = await world();
        const r = await asA("GET", path);
        expect(r.res.status).toBe(200);
        expect(items(r).map((i) => i.name)).toEqual(names);
        const q = await asA(
          "GET",
          `${path}?q=${encodeURIComponent(names[0].slice(0, 4).toUpperCase())}`,
        );
        expect(items(q).map((i) => i.name)).toContain(names[0]);
      },
    );

    it("pickers are a 404 without a connection, and name the code when the account is refused", async () => {
      const { asA } = await world();
      const loner = await createTestUser();
      const asLoner = createCaller({ session: loginTestUser(loner).token });
      expect(
        (await asLoner("GET", "/api/v1/integrations/paperless/tags")).res
          .status,
      ).toBe(404);
      fake.failNext("/api/groups/", 403);
      const r = await asA("GET", "/api/v1/integrations/paperless/groups");
      expect([r.res.status, errorCode(r)]).toEqual([502, "upstream_error"]);
      expect(r.body).toMatchObject({
        error: { details: { code: "forbidden" } },
      });
    });

    it("pickers read with the token of the caller", async () => {
      const { asB } = await world();
      await asB("GET", "/api/v1/integrations/paperless/tags");
      expect(
        fake
          .requestsTo("/api/tags/")
          .map((r) => r.headers.get("authorization")),
      ).toEqual(["Token token-b"]);
    });
  });

  it("logs nothing about documents when a request fails", async () => {
    const { asA } = await world();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    fake.addDoc({ id: 10, title: "Very private title" });
    fake.failNext("/api/documents/", 500);
    await asA("GET", "/api/v1/documents/paperless/10");
    expect(JSON.stringify(log.mock.calls)).not.toContain("Very private title");
    log.mockRestore();
  });
});
