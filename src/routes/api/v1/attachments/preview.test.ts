import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { createApiClient, endpointUrl } from "#lib/api/client.ts";
import { endpoints } from "#lib/api/registry.ts";
import {
  ATTACHMENT_PDF_READ_MAX_BYTES,
  PAGE_COUNT_HEADER,
} from "#lib/api/schemas/attachments.ts";
import {
  createCaller,
  createInProcessFetch,
  errorCode,
} from "#lib/testing/api.ts";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "#lib/testing/auth.ts";
import { useTestDB } from "#lib/testing/db.ts";
import { useTestFilesDir } from "#lib/testing/files.ts";
import { plainJpeg, plainPng } from "#lib/server/files/test-images.ts";
import {
  encryptedPdf,
  makePdf,
  pageWidth,
} from "#lib/server/files/test-pdfs.ts";

interface ErrorBody {
  error: {
    code: string;
    details?: {
      code?: string;
      pageCount?: number;
      query?: { fieldErrors: Record<string, string[]> };
    };
  };
}
type Call = ReturnType<typeof createCaller>;

describe("GET /attachments/{id}/preview", () => {
  useTestDB();
  useTestFilesDir();

  async function setup() {
    const user = await createTestUser();
    const call = createCaller({ session: loginTestUser(user).token });
    const asset = (
      await call("POST", "/api/v1/assets", { json: { name: "Kessel" } })
    ).body as { id: string };
    return { user, call, asset };
  }
  async function upload(
    call: Call,
    owner: { ownerType: string; ownerId: string },
    bytes: Uint8Array,
    name: string,
    type: string,
  ) {
    const r = await call("POST", "/api/v1/attachments", {
      form: { file: new File([bytes as BlobPart], name, { type }), ...owner },
    });
    expect(r.res.status, JSON.stringify(r.body)).toBe(201);
    return r.body as { id: string; size: number };
  }
  const widths = async (body: unknown) =>
    (await PDFDocument.load(body as Uint8Array))
      .getPages()
      .map((p) => p.getSize().width);

  it("sends a small image as stored, with the headers of the receipt preview", async () => {
    const { call, asset } = await setup();
    const row = await upload(
      call,
      { ownerType: "asset", ownerId: asset.id },
      plainPng(64, 48),
      "bild.png",
      "image/png",
    );
    const r = await call("GET", `/api/v1/attachments/${row.id}/preview`);
    expect(r.res.status).toBe(200);
    expect(r.res.headers.get("content-type")).toBe("image/png");
    expect(r.res.headers.get("cache-control")).toBe("private, no-cache");
    expect(r.res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.res.headers.get("etag")).toMatch(/^"[0-9a-f]{64}"$/);
    expect(r.res.headers.get(PAGE_COUNT_HEADER)).toBeNull();
    expect((r.body as Uint8Array).byteLength).toBe(row.size);
  });

  it("scales a large image down to JPEG and answers 304 to a matching If-None-Match", async () => {
    const { call, asset } = await setup();
    const row = await upload(
      call,
      { ownerType: "asset", ownerId: asset.id },
      plainJpeg(3200, 2400),
      "foto.jpg",
      "image/jpeg",
    );
    const r = await call("GET", `/api/v1/attachments/${row.id}/preview`);
    expect(r.res.headers.get("content-type")).toBe("image/jpeg");
    const etag = r.res.headers.get("etag")!;
    expect(etag).toMatch(/-preview"$/);
    expect((r.body as Uint8Array).byteLength).toBeLessThan(row.size);
    const again = await call("GET", `/api/v1/attachments/${row.id}/preview`, {
      headers: { "if-none-match": etag },
    });
    expect(again.res.status).toBe(304);
  });

  it("sends a small PDF whole and says how many pages it has", async () => {
    const { call, asset } = await setup();
    const row = await upload(
      call,
      { ownerType: "asset", ownerId: asset.id },
      await makePdf(7),
      "handbuch.pdf",
      "application/pdf",
    );
    const r = await call("GET", `/api/v1/attachments/${row.id}/preview`);
    expect(r.res.status).toBe(200);
    expect(r.res.headers.get("content-type")).toBe("application/pdf");
    expect(r.res.headers.get(PAGE_COUNT_HEADER)).toBe("7");
    expect(await widths(r.body)).toHaveLength(7);
  });

  it("sends just the pages asked for, with the page count of the whole file", async () => {
    const { call, asset } = await setup();
    const row = await upload(
      call,
      { ownerType: "asset", ownerId: asset.id },
      await makePdf(12),
      "handbuch.pdf",
      "application/pdf",
    );
    const r = await call(
      "GET",
      `/api/v1/attachments/${row.id}/preview?pages=3-5`,
    );
    expect(r.res.status).toBe(200);
    expect(r.res.headers.get(PAGE_COUNT_HEADER)).toBe("12");
    expect(r.res.headers.get("content-type")).toBe("application/pdf");
    expect(r.res.headers.get("cache-control")).toBe("private, no-cache");
    expect(await widths(r.body)).toEqual([3, 4, 5].map(pageWidth));
    const etag = r.res.headers.get("etag")!;
    expect(etag).toMatch(/-pages-3-5"$/);
    expect(
      (
        await call("GET", `/api/v1/attachments/${row.id}/preview?pages=3-5`, {
          headers: { "if-none-match": etag },
        })
      ).res.status,
    ).toBe(304);
    const other = await call(
      "GET",
      `/api/v1/attachments/${row.id}/preview?pages=6`,
    );
    expect(other.res.headers.get("etag")).not.toBe(etag);
    expect(await widths(other.body)).toEqual([pageWidth(6)]);
  });

  it("a PDF over 4 MiB needs a range: 400 too_large with the page count, then pages work", async () => {
    const { call, asset } = await setup();
    const row = await upload(
      call,
      { ownerType: "asset", ownerId: asset.id },
      await makePdf(35, { padBytes: ATTACHMENT_PDF_READ_MAX_BYTES + 50_000 }),
      "riesig.pdf",
      "application/pdf",
    );
    const refused = await call("GET", `/api/v1/attachments/${row.id}/preview`);
    expect([refused.res.status, errorCode(refused)]).toEqual([
      400,
      "invalid_request",
    ]);
    expect((refused.body as ErrorBody).error.details).toMatchObject({
      code: "too_large",
      pageCount: 35,
    });
    const part = await call(
      "GET",
      `/api/v1/attachments/${row.id}/preview?pages=1-20`,
    );
    expect(part.res.status).toBe(200);
    expect(await widths(part.body)).toHaveLength(20);
  });

  describe("what is refused", () => {
    it.each([
      "0",
      "-3",
      "3-",
      "a",
      "1,2",
      "5-3",
      "1-21",
      "1-99999",
      "1.5",
      "",
      "٣",
    ])("pages=%j is a 400 on pages", async (pages) => {
      const { call, asset } = await setup();
      const row = await upload(
        call,
        { ownerType: "asset", ownerId: asset.id },
        await makePdf(30),
        "a.pdf",
        "application/pdf",
      );
      const r = await call(
        "GET",
        `/api/v1/attachments/${row.id}/preview?pages=${encodeURIComponent(pages)}`,
      );
      expect([r.res.status, errorCode(r)]).toEqual([400, "invalid_request"]);
      expect(
        (r.body as { error: { details: { query: { fieldErrors: object } } } })
          .error.details.query.fieldErrors,
      ).toHaveProperty("pages");
    });

    it("a page beyond the end is a 400 on pages that carries the page count", async () => {
      const { call, asset } = await setup();
      const row = await upload(
        call,
        { ownerType: "asset", ownerId: asset.id },
        await makePdf(4),
        "a.pdf",
        "application/pdf",
      );
      const r = await call(
        "GET",
        `/api/v1/attachments/${row.id}/preview?pages=3-5`,
      );
      expect(r.res.status).toBe(400);
      const body = r.body as ErrorBody;
      expect(body.error.details).toMatchObject({
        code: "out_of_range",
        pageCount: 4,
      });
      expect(body.error.details?.query?.fieldErrors).toHaveProperty("pages");
    });

    it("pages for an image is a 400 on pages", async () => {
      const { call, asset } = await setup();
      const row = await upload(
        call,
        { ownerType: "asset", ownerId: asset.id },
        plainPng(),
        "bild.png",
        "image/png",
      );
      const r = await call(
        "GET",
        `/api/v1/attachments/${row.id}/preview?pages=1`,
      );
      expect(r.res.status).toBe(400);
      expect((r.body as ErrorBody).error.details?.code).toBe("not_a_pdf");
    });

    it("an encrypted PDF is unreadable when pages are asked for, and sent whole without", async () => {
      const { call, asset } = await setup();
      const row = await upload(
        call,
        { ownerType: "asset", ownerId: asset.id },
        await encryptedPdf(),
        "zu.pdf",
        "application/pdf",
      );
      const refused = await call(
        "GET",
        `/api/v1/attachments/${row.id}/preview?pages=1`,
      );
      expect(refused.res.status).toBe(400);
      expect((refused.body as ErrorBody).error.details?.code).toBe(
        "unreadable",
      );
      const whole = await call("GET", `/api/v1/attachments/${row.id}/preview`);
      expect(whole.res.status).toBe(200);
      expect(whole.res.headers.get(PAGE_COUNT_HEADER)).toBeNull();
    });

    it("an attachment that does not exist is a 404", async () => {
      const { call } = await setup();
      const r = await call("GET", "/api/v1/attachments/missing/preview");
      expect([r.res.status, errorCode(r)]).toEqual([404, "not_found"]);
    });
  });

  describe("who may read it", () => {
    it("the read scope is enough, for files of any owner (a page, a receipt, a step)", async () => {
      const { user, call } = await setup();
      const read = createCaller({
        bearer: createTestToken(user, { scopes: ["read"] }).token,
      });
      const page = (
        await call("POST", "/api/v1/pages", {
          json: { title: "Notfall", bodyMd: "x" },
        })
      ).body as { id: string };
      const onPage = await upload(
        call,
        { ownerType: "page", ownerId: page.id },
        await makePdf(3),
        "seite.pdf",
        "application/pdf",
      );
      expect(
        (await read("GET", `/api/v1/attachments/${onPage.id}/preview?pages=2`))
          .res.status,
      ).toBe(200);

      const receipt = await call("POST", "/api/v1/ai-tasks", {
        form: {
          file: new File([plainPng(30, 20) as BlobPart], "beleg.png", {
            type: "image/png",
          }),
        },
      });
      const attachmentId = (receipt.body as { attachment: { id: string } })
        .attachment.id;
      expect(
        (await read("GET", `/api/v1/attachments/${attachmentId}/preview`)).res
          .status,
      ).toBe(200);
    });

    it("works through the typed client and as an address for a plain download", async () => {
      const { user, call, asset } = await setup();
      const { token } = createTestToken(user, { scopes: ["read"] });
      const row = await upload(
        call,
        { ownerType: "asset", ownerId: asset.id },
        await makePdf(9),
        "handbuch.pdf",
        "application/pdf",
      );
      const api = createApiClient(
        createInProcessFetch({ bearer: token }),
        "http://localhost",
      );
      const res = await api.call(endpoints.attachmentsPreview, {
        params: { id: row.id },
        query: { pages: "2-3" },
      });
      expect(res.headers.get(PAGE_COUNT_HEADER)).toBe("9");
      expect(await widths(new Uint8Array(await res.arrayBuffer()))).toEqual(
        [2, 3].map(pageWidth),
      );
      expect(
        endpointUrl(endpoints.attachmentsPreview, {
          params: { id: row.id },
          query: { pages: "2-3" },
        }),
      ).toBe(`/api/v1/attachments/${row.id}/preview?pages=2-3`);
    });
  });
});
