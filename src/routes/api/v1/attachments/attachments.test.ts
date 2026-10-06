import { createHash } from "node:crypto";
import { access, readdir, utimes } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApiClient, endpointUrl } from "$lib/api/client";
import { endpoints } from "$lib/api/registry";
import { MAX_UPLOAD_REQUEST_BYTES } from "$lib/api/schemas/attachments";
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
import {
  sampleHeic,
  sampleHtml,
  samplePdf,
  sampleSvg,
  useTestFilesDir,
} from "$lib/testing/files";
import {
  plainJpeg,
  plainPng,
  SECRET_MAKE,
  withExif,
} from "$lib/server/files/test-images";
import { settleBackgroundWork } from "$lib/server/attachments/attachments";

interface AttachmentBody {
  id: string;
  ownerType: string;
  ownerId: string;
  filename: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  caption: string | null;
  guestVisible: boolean;
  url: string;
  thumbUrl: string | null;
  uploadedBy: string | null;
}

const present = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

describe("attachments API", () => {
  useTestDB();
  const files = useTestFilesDir();

  async function setup() {
    const user = await createTestUser();
    const call = createCaller({ session: loginTestUser(user).token });
    const asset = (
      await call("POST", "/api/v1/assets", { json: { name: "Kessel" } })
    ).body as { id: string };
    return { user, call, asset };
  }

  const file = (bytes: Uint8Array, name: string, type = "") =>
    new File([bytes as BlobPart], name, { type });
  const form = (
    bytes: Uint8Array,
    name: string,
    owner: Record<string, string>,
    type = "",
  ) => ({ file: file(bytes, name, type), ...owner });

  async function upload(
    call: ReturnType<typeof createCaller>,
    owner: Record<string, string>,
    bytes: Uint8Array = plainPng(),
    name = "bild.png",
    type = "image/png",
  ) {
    return call("POST", "/api/v1/attachments", {
      form: form(bytes, name, owner, type),
    });
  }

  describe("upload", () => {
    it("stores an image and answers with its metadata and urls", async () => {
      const { user, call, asset } = await setup();
      const r = await call("POST", "/api/v1/attachments", {
        form: {
          ...form(plainPng(64, 32), "Foto.png", {
            ownerType: "asset",
            ownerId: asset.id,
            caption: "Vorderseite",
            guestVisible: "true",
          }),
        },
      });
      expect(r.res.status).toBe(201);
      const body = r.body as AttachmentBody;
      expect(body).toMatchObject({
        ownerType: "asset",
        ownerId: asset.id,
        filename: "Foto.png",
        mime: "image/png",
        width: 64,
        height: 32,
        caption: "Vorderseite",
        guestVisible: true,
        uploadedBy: user.id,
        url: `/api/v1/attachments/${body.id}/content`,
        thumbUrl: `/api/v1/attachments/${body.id}/thumb`,
      });
      expect(body).not.toHaveProperty("sha256");
      expect(body).not.toHaveProperty("path");
      expect(r.res.headers.get("cache-control")).toBe("no-store");
    });

    it("re-encodes images: no metadata survives, the stored bytes are what is served", async () => {
      const { call, asset } = await setup();
      const source = withExif(plainJpeg(64, 32), 1);
      const created = (
        await upload(
          call,
          { ownerType: "asset", ownerId: asset.id },
          source,
          "IMG.JPG",
          "image/jpeg",
        )
      ).body as AttachmentBody;
      const served = await call("GET", created.url);
      const bytes = served.body as Uint8Array;
      expect(Buffer.from(bytes).includes(Buffer.from(SECRET_MAKE))).toBe(false);
      expect(bytes.byteLength).toBe(created.size);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        (
          await readdir(
            join(
              files.dir,
              createHash("sha256").update(bytes).digest("hex").slice(0, 2),
            ),
          )
        ).find((n) => !n.includes("thumb")),
      );
    });

    it("stores a pdf as uploaded, without a thumbnail", async () => {
      const { call, asset } = await setup();
      const r = await upload(
        call,
        { ownerType: "asset", ownerId: asset.id },
        samplePdf(),
        "Anleitung.pdf",
        "application/pdf",
      );
      expect(r.res.status).toBe(201);
      expect(r.body).toMatchObject({
        mime: "application/pdf",
        thumbUrl: null,
        width: null,
        filename: "Anleitung.pdf",
      });
      const served = await call("GET", (r.body as AttachmentBody).url);
      expect(Buffer.from(served.body as Uint8Array).equals(samplePdf())).toBe(
        true,
      );
    });

    it("trusts the content, not the declared type or the extension", async () => {
      const { call, asset } = await setup();
      const r = await upload(
        call,
        { ownerType: "asset", ownerId: asset.id },
        plainPng(),
        "evil.html",
        "text/html",
      );
      expect(r.res.status).toBe(201);
      expect(r.body).toMatchObject({ mime: "image/png", filename: "evil.png" });
    });

    it.each([
      ["svg", sampleSvg, "x.svg", "image/svg+xml", 415, "unsupported_type"],
      ["html", sampleHtml, "x.html", "text/html", 415, "unsupported_type"],
      [
        "html named pdf",
        sampleHtml,
        "x.pdf",
        "application/pdf",
        415,
        "unsupported_type",
      ],
      ["heic", sampleHeic, "x.heic", "image/heic", 415, "unsupported_heic"],
      ["empty", () => Buffer.alloc(0), "x.png", "image/png", 400, "empty"],
      [
        "truncated png",
        () => plainPng().subarray(0, 30),
        "x.png",
        "image/png",
        400,
        "corrupt_image",
      ],
    ])(
      "rejects %s with %i and details.code %s",
      async (_name, make, filename, type, status, code) => {
        const { call, asset } = await setup();
        const r = await upload(
          call,
          { ownerType: "asset", ownerId: asset.id },
          make(),
          filename,
          type,
        );
        expect(r.res.status).toBe(status);
        expect(errorCode(r)).toBe("invalid_request");
        expect(
          (r.body as { error: { details: { code: string } } }).error.details,
        ).toEqual({ code });
        const list = await call(
          "GET",
          `/api/v1/attachments?ownerType=asset&ownerId=${asset.id}`,
        );
        expect((list.body as { items: unknown[] }).items).toEqual([]);
        expect(await readdir(files.dir)).toEqual([]);
      },
    );

    it("rejects files above 25 MiB with 413 too_large", async () => {
      const { call, asset } = await setup();
      const big = Buffer.concat([
        Buffer.from("%PDF-1.4\n"),
        Buffer.alloc(25 * 1024 * 1024),
      ]);
      const r = await upload(
        call,
        { ownerType: "asset", ownerId: asset.id },
        big,
        "gross.pdf",
        "application/pdf",
      );
      expect(r.res.status).toBe(413);
      expect(r.body).toMatchObject({
        error: { code: "invalid_request", details: { code: "too_large" } },
      });
      expect(await readdir(files.dir)).toEqual([]);
    });

    it("rejects a request body beyond the endpoint limit with 413", async () => {
      const { call, asset } = await setup();
      const huge = Buffer.alloc(MAX_UPLOAD_REQUEST_BYTES + 10);
      const r = await upload(
        call,
        { ownerType: "asset", ownerId: asset.id },
        huge,
        "x.pdf",
        "application/pdf",
      );
      expect(r.res.status).toBe(413);
      expect(errorCode(r)).toBe("invalid_request");
    });

    it("validates the form fields", async () => {
      const { call, asset } = await setup();
      const png = file(plainPng(), "a.png", "image/png");
      const cases: Record<string, Record<string, string | File>> = {
        "no file": { ownerType: "asset", ownerId: asset.id },
        "no owner": { file: png },
        "bad owner type": {
          file: png,
          ownerType: "spaceship",
          ownerId: asset.id,
        },
        "file as text": {
          file: "not a file",
          ownerType: "asset",
          ownerId: asset.id,
        },
        "unknown field": {
          file: png,
          ownerType: "asset",
          ownerId: asset.id,
          extra: "1",
        },
        "bad flag": {
          file: png,
          ownerType: "asset",
          ownerId: asset.id,
          guestVisible: "yes",
        },
        "long caption": {
          file: png,
          ownerType: "asset",
          ownerId: asset.id,
          caption: "x".repeat(501),
        },
      };
      for (const [name, formData] of Object.entries(cases)) {
        const r = await call("POST", "/api/v1/attachments", { form: formData });
        expect([name, r.res.status, errorCode(r)]).toEqual([
          name,
          400,
          "invalid_request",
        ]);
      }
    });

    it("rejects a JSON body on the multipart endpoint", async () => {
      const { call } = await setup();
      const r = await call("POST", "/api/v1/attachments", {
        json: { ownerType: "asset", ownerId: "x" },
      });
      expect(r.res.status).toBe(403);
      expect(errorCode(r)).toBe("csrf_failed");
    });

    it("needs an owner that exists and a supported owner type", async () => {
      const { call } = await setup();
      for (const ownerType of [
        "asset",
        "room",
        "page",
        "task",
        "defect",
        "service_log",
        "part",
        "asset_hint",
        "contact",
      ]) {
        const r = await upload(call, { ownerType, ownerId: "missing" });
        expect(r.res.status, ownerType).toBe(400);
        expect(r.body).toMatchObject({
          error: {
            details: {
              body: { fieldErrors: { ownerId: [expect.any(String)] } },
            },
          },
        });
      }
      const r = await upload(call, { ownerType: "bogus", ownerId: "d1" });
      expect(r.res.status).toBe(400);
    });

    it("attaches to rooms, tasks and pages too", async () => {
      const { call } = await setup();
      const room = (
        await call("POST", "/api/v1/rooms", { json: { name: "Bad" } })
      ).body as { id: string };
      const task = (
        await call("POST", "/api/v1/tasks", {
          json: {
            title: "Filter",
            trigger: {
              v: 1,
              type: "interval",
              every: 3,
              unit: "month",
              anchor: "completion",
              startDate: "2026-06-20",
            },
          },
        })
      ).body as { id: string };
      const page = (
        await call("POST", "/api/v1/pages", { json: { title: "Doku" } })
      ).body as { id: string };
      for (const owner of [
        { ownerType: "room", ownerId: room.id },
        { ownerType: "task", ownerId: task.id },
        { ownerType: "page", ownerId: page.id },
      ]) {
        expect((await upload(call, owner)).res.status, owner.ownerType).toBe(
          201,
        );
      }
    });
  });

  it("works through the typed client with an object body", async () => {
    const { user, asset } = await setup();
    const { token } = createTestToken(user);
    const api = createApiClient(createInProcessFetch({ bearer: token }));
    const created = await api.call(endpoints.attachmentsUpload, {
      body: {
        file: file(samplePdf(), "Handbuch.pdf", "application/pdf"),
        ownerType: "asset",
        ownerId: asset.id,
        caption: "Seite 1",
      },
    });
    expect(created).toMatchObject({
      mime: "application/pdf",
      caption: "Seite 1",
      filename: "Handbuch.pdf",
    });
    const list = await api.call(endpoints.attachmentsList, {
      query: { ownerType: "asset", ownerId: asset.id },
    });
    expect(list.items.map((a) => a.id)).toEqual([created.id]);
    expect(
      endpointUrl(endpoints.attachmentsContent, { params: { id: created.id } }),
    ).toBe(created.url);
  });

  describe("authorization and CSRF", () => {
    it("a cross-origin cookie upload is refused, a bearer upload needs no Origin", async () => {
      const { user, call, asset } = await setup();
      const owner = { ownerType: "asset", ownerId: asset.id };
      const cross = await call("POST", "/api/v1/attachments", {
        form: form(plainPng(), "a.png", owner),
        origin: "https://evil.example",
      });
      expect([cross.res.status, errorCode(cross)]).toEqual([
        403,
        "csrf_failed",
      ]);
      const { token } = createTestToken(user, { scopes: ["read", "write"] });
      const viaToken = createCaller({ bearer: token });
      const r = await viaToken("POST", "/api/v1/attachments", {
        form: form(plainPng(), "a.png", owner),
        origin: null,
      });
      expect(r.res.status).toBe(201);
    });

    it("attachments of pages need the docs:write scope, others only write", async () => {
      const { user, call, asset } = await setup();
      const page = (
        await call("POST", "/api/v1/pages", { json: { title: "Doku" } })
      ).body as { id: string };
      const { token } = createTestToken(user, { scopes: ["read", "write"] });
      const limited = createCaller({ bearer: token });

      const onAsset = await upload(limited, {
        ownerType: "asset",
        ownerId: asset.id,
      });
      expect(onAsset.res.status).toBe(201);
      const onPage = await upload(limited, {
        ownerType: "page",
        ownerId: page.id,
      });
      expect([onPage.res.status, errorCode(onPage)]).toEqual([
        403,
        "forbidden",
      ]);

      const pageAtt = (
        await upload(call, { ownerType: "page", ownerId: page.id })
      ).body as AttachmentBody;
      expect(
        (
          await limited("PATCH", `/api/v1/attachments/${pageAtt.id}`, {
            json: { caption: "x" },
          })
        ).res.status,
      ).toBe(403);
      expect(
        (await limited("DELETE", `/api/v1/attachments/${pageAtt.id}`)).res
          .status,
      ).toBe(403);
      const assetAtt = onAsset.body as AttachmentBody;
      expect(
        (
          await limited("PATCH", `/api/v1/attachments/${assetAtt.id}`, {
            json: { caption: "x" },
          })
        ).res.status,
      ).toBe(200);
      expect(
        (await limited("DELETE", `/api/v1/attachments/${assetAtt.id}`)).res
          .status,
      ).toBe(204);
    });

    it("a token with only write cannot read files, one with read can", async () => {
      const { user, call, asset } = await setup();
      const created = (
        await upload(call, { ownerType: "asset", ownerId: asset.id })
      ).body as AttachmentBody;
      const writeOnly = createCaller({
        bearer: createTestToken(user, { scopes: ["write"] }).token,
      });
      expect((await writeOnly("GET", created.url)).res.status).toBe(403);
      expect(
        (await writeOnly("GET", `/api/v1/attachments/${created.id}`)).res
          .status,
      ).toBe(403);
      const reader = createCaller({
        bearer: createTestToken(user, { scopes: ["read"] }).token,
      });
      expect((await reader("GET", created.url)).res.status).toBe(200);
    });

    it("anonymous requests for a file get 401, not the bytes", async () => {
      const { call, asset } = await setup();
      const created = (
        await upload(call, { ownerType: "asset", ownerId: asset.id })
      ).body as AttachmentBody;
      const anonymous = createCaller({ session: "garbage" });
      const r = await anonymous("GET", created.url);
      expect(r.res.status).toBe(401);
      expect(r.res.headers.get("content-type")).toContain("application/json");
    });
  });

  describe("read, list, update, delete", () => {
    it("lists by owner, returns metadata and patches caption and visibility", async () => {
      const { call, asset } = await setup();
      const owner = { ownerType: "asset", ownerId: asset.id };
      const one = (await upload(call, owner)).body as AttachmentBody;
      const two = (
        await upload(call, owner, samplePdf(), "a.pdf", "application/pdf")
      ).body as AttachmentBody;
      const list = await call(
        "GET",
        `/api/v1/attachments?ownerType=asset&ownerId=${asset.id}`,
      );
      expect(
        (list.body as { items: AttachmentBody[] }).items.map((a) => a.id),
      ).toEqual([one.id, two.id]);

      const got = await call("GET", `/api/v1/attachments/${one.id}`);
      expect(got.body).toEqual(one);

      const patched = await call("PATCH", `/api/v1/attachments/${one.id}`, {
        json: { caption: "  Neu  ", guestVisible: true },
      });
      expect(patched.body).toMatchObject({
        caption: "Neu",
        guestVisible: true,
      });
      const cleared = await call("PATCH", `/api/v1/attachments/${one.id}`, {
        json: { caption: "" },
      });
      expect(cleared.body).toMatchObject({ caption: null, guestVisible: true });

      for (const json of [
        {},
        { filename: "x" },
        { caption: "x".repeat(501) },
        { guestVisible: "yes" },
      ]) {
        expect(
          (await call("PATCH", `/api/v1/attachments/${one.id}`, { json })).res
            .status,
        ).toBe(400);
      }
      expect(
        (await call("GET", "/api/v1/attachments?ownerType=asset")).res.status,
      ).toBe(400);
      expect(errorCode(await call("GET", "/api/v1/attachments/missing"))).toBe(
        "not_found",
      );
      expect(
        errorCode(
          await call("PATCH", "/api/v1/attachments/missing", {
            json: { caption: "x" },
          }),
        ),
      ).toBe("not_found");
      expect(
        errorCode(await call("DELETE", "/api/v1/attachments/missing")),
      ).toBe("not_found");
    });

    it("deleting removes the row and, once old enough, the file; the asset photo is cleared", async () => {
      const { call, asset } = await setup();
      const created = (
        await upload(call, { ownerType: "asset", ownerId: asset.id })
      ).body as AttachmentBody;
      const set = await call("PATCH", `/api/v1/assets/${asset.id}`, {
        json: { photoAttachmentId: created.id },
      });
      expect(set.res.status).toBe(200);
      expect(set.body).toMatchObject({
        photoAttachmentId: created.id,
        photoUrl: `/api/v1/attachments/${created.id}/thumb`,
      });
      const thumb = await call(
        "GET",
        (set.body as { photoUrl: string }).photoUrl,
      );
      expect(thumb.res.status).toBe(200);
      expect(thumb.res.headers.get("content-type")).toBe("image/webp");

      const [shard] = await readdir(files.dir);
      const stored = (await readdir(join(files.dir, shard!))).map((n) =>
        join(files.dir, shard!, n),
      );
      const old = new Date(Date.now() - 3600_000);
      for (const path of stored) await utimes(path, old, old);

      expect(
        (await call("DELETE", `/api/v1/attachments/${created.id}`)).res.status,
      ).toBe(204);
      expect(errorCode(await call("GET", created.url))).toBe("not_found");
      for (const path of stored) expect(await present(path)).toBe(false);
      const after = await call("GET", `/api/v1/assets/${asset.id}`);
      expect(after.body).toMatchObject({
        photoAttachmentId: null,
        photoUrl: null,
      });
    });

    it("an asset photo must be an image of that asset", async () => {
      const { call, asset } = await setup();
      const other = (
        await call("POST", "/api/v1/assets", { json: { name: "Andere" } })
      ).body as { id: string };
      const mine = (
        await upload(call, { ownerType: "asset", ownerId: asset.id })
      ).body as AttachmentBody;
      const pdf = (
        await upload(
          call,
          { ownerType: "asset", ownerId: asset.id },
          samplePdf(),
          "a.pdf",
          "application/pdf",
        )
      ).body as AttachmentBody;
      const theirs = (
        await upload(call, { ownerType: "asset", ownerId: other.id })
      ).body as AttachmentBody;
      for (const bad of [pdf.id, theirs.id, "missing"]) {
        const r = await call("PATCH", `/api/v1/assets/${asset.id}`, {
          json: { photoAttachmentId: bad },
        });
        expect([r.res.status, errorCode(r)], bad).toEqual([
          400,
          "invalid_request",
        ]);
      }
      expect(
        (
          await call("PATCH", `/api/v1/assets/${asset.id}`, {
            json: { photoAttachmentId: mine.id },
          })
        ).res.status,
      ).toBe(200);
      const created = await call("POST", "/api/v1/assets", {
        json: { name: "Neu", photoAttachmentId: mine.id },
      });
      expect(created.res.status).toBe(400);
    });

    it("deleting the owner takes its attachments along", async () => {
      const { call, asset } = await setup();
      const created = (
        await upload(call, { ownerType: "asset", ownerId: asset.id })
      ).body as AttachmentBody;
      expect(
        (await call("DELETE", `/api/v1/assets/${asset.id}`)).res.status,
      ).toBe(204);
      await settleBackgroundWork();
      expect(
        errorCode(await call("GET", `/api/v1/attachments/${created.id}`)),
      ).toBe("not_found");
      const list = await call(
        "GET",
        `/api/v1/attachments?ownerType=asset&ownerId=${asset.id}`,
      );
      expect((list.body as { items: unknown[] }).items).toEqual([]);
    });
  });

  describe("content", () => {
    it("serves an image inline for <img src> with the session cookie only", async () => {
      const { call, asset } = await setup();
      const created = (
        await upload(
          call,
          { ownerType: "asset", ownerId: asset.id },
          plainPng(),
          "Küche & Bad.png",
        )
      ).body as AttachmentBody;
      const r = await call("GET", created.url);
      expect(r.res.status).toBe(200);
      const h = r.res.headers;
      expect(h.get("content-type")).toBe("image/png");
      expect(h.get("x-content-type-options")).toBe("nosniff");
      expect(h.get("content-security-policy")).toContain("default-src 'none'");
      expect(h.get("content-security-policy")).toContain("sandbox");
      expect(h.get("cache-control")).toBe(
        "private, max-age=31536000, immutable",
      );
      expect(h.get("cross-origin-resource-policy")).toBe("same-origin");
      expect(h.get("etag")).toMatch(/^"[0-9a-f]{64}"$/);
      expect(h.get("content-disposition")).toMatch(
        /^inline; filename="Kueche & Bad\.png"; filename\*=UTF-8''/,
      );
      expect(h.get("content-length")).toBe(String(created.size));
      expect(
        Buffer.from(r.body as Uint8Array)
          .subarray(0, 4)
          .toString("hex"),
      ).toBe("89504e47");
    });

    it("serves pdfs inline without the sandbox directive, and downloads on request", async () => {
      const { call, asset } = await setup();
      const created = (
        await upload(
          call,
          { ownerType: "asset", ownerId: asset.id },
          samplePdf(),
          "Handbuch.pdf",
          "application/pdf",
        )
      ).body as AttachmentBody;
      const inline = await call("GET", created.url);
      expect(inline.res.headers.get("content-type")).toBe("application/pdf");
      expect(inline.res.headers.get("content-disposition")).toMatch(/^inline;/);
      expect(inline.res.headers.get("content-security-policy")).not.toContain(
        "sandbox",
      );
      expect(inline.res.headers.get("x-content-type-options")).toBe("nosniff");
      for (const flag of ["1", "true"]) {
        const download = await call("GET", `${created.url}?download=${flag}`);
        expect(download.res.headers.get("content-disposition")).toMatch(
          /^attachment; filename="Handbuch\.pdf"/,
        );
        expect(download.res.headers.get("content-security-policy")).toContain(
          "sandbox",
        );
      }
      const notDownload = await call("GET", `${created.url}?download=0`);
      expect(notDownload.res.headers.get("content-disposition")).toMatch(
        /^inline;/,
      );
      expect(
        (await call("GET", `${created.url}?download=maybe`)).res.status,
      ).toBe(400);
    });

    it("answers a matching If-None-Match with 304 and no body", async () => {
      const { call, asset } = await setup();
      const created = (
        await upload(call, { ownerType: "asset", ownerId: asset.id })
      ).body as AttachmentBody;
      const first = await call("GET", created.url);
      const etag = first.res.headers.get("etag")!;
      const again = await call("GET", created.url, {
        headers: { "if-none-match": etag },
      });
      expect(again.res.status).toBe(304);
      expect(again.body).toBeNull();
      expect(again.res.headers.get("etag")).toBe(etag);
      const other = await call("GET", created.url, {
        headers: { "if-none-match": '"other"' },
      });
      expect(other.res.status).toBe(200);
    });

    it("serves the thumbnail as webp, and 404 for a pdf", async () => {
      const { call, asset } = await setup();
      const image = (
        await upload(
          call,
          { ownerType: "asset", ownerId: asset.id },
          plainPng(800, 600),
        )
      ).body as AttachmentBody;
      const thumb = await call("GET", image.thumbUrl!);
      expect(thumb.res.status).toBe(200);
      expect(thumb.res.headers.get("content-type")).toBe("image/webp");
      expect(thumb.res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(thumb.res.headers.get("etag")).not.toBe(
        (await call("GET", image.url)).res.headers.get("etag"),
      );
      const bytes = Buffer.from(thumb.body as Uint8Array);
      expect(bytes.subarray(0, 4).toString()).toBe("RIFF");
      expect(bytes.subarray(8, 12).toString()).toBe("WEBP");
      expect(bytes.length).toBeLessThan(image.size + 1);

      const pdf = (
        await upload(
          call,
          { ownerType: "asset", ownerId: asset.id },
          samplePdf(),
          "a.pdf",
          "application/pdf",
        )
      ).body as AttachmentBody;
      expect(
        errorCode(await call("GET", `/api/v1/attachments/${pdf.id}/thumb`)),
      ).toBe("not_found");
    });

    it("answers 404 and logs when the stored file has gone missing", async () => {
      const { call, asset } = await setup();
      const created = (
        await upload(call, { ownerType: "asset", ownerId: asset.id })
      ).body as AttachmentBody;
      const { rm } = await import("node:fs/promises");
      await rm(files.dir, { recursive: true, force: true });
      const logged: string[] = [];
      const original = console.error;
      console.error = (...args: unknown[]) => void logged.push(String(args[0]));
      try {
        expect(errorCode(await call("GET", created.url))).toBe("not_found");
      } finally {
        console.error = original;
      }
      expect(logged.join("\n")).toContain("attachments.file_missing");
      expect(logged.join("\n")).not.toContain("bild.png");
    });

    it("ids cannot be used to reach other files: traversal attempts are plain 404s", async () => {
      const { call } = await setup();
      for (const id of [
        "..%2F..%2Fetc%2Fpasswd",
        "%2E%2E%2F%2E%2E%2Fetc%2Fpasswd",
        "ab%2F" + "a".repeat(64),
        "a".repeat(64),
        "%00",
        "x".repeat(65),
      ]) {
        for (const suffix of ["", "/content", "/thumb"]) {
          const r = await call("GET", `/api/v1/attachments/${id}${suffix}`);
          expect([id + suffix, r.res.status]).toEqual([
            id + suffix,
            id.length > 64 ? 400 : 404,
          ]);
          expect(r.res.headers.get("content-type")).toContain(
            "application/json",
          );
        }
      }
    });

    it("a row whose stored path was tampered with is never served from outside the store", async () => {
      const { call, asset } = await setup();
      const created = (
        await upload(call, { ownerType: "asset", ownerId: asset.id })
      ).body as AttachmentBody;
      const { getDB, attachments } = await import("$lib/server/db");
      const { eq } = await import("drizzle-orm");
      getDB()
        .update(attachments)
        .set({ path: "../../../etc/passwd" })
        .where(eq(attachments.id, created.id))
        .run();
      const r = await call("GET", created.url);
      expect(r.res.status).toBe(404);
      expect(JSON.stringify(r.body)).not.toContain("root:");
    });
  });
});
