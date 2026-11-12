import { rm } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { ATTACHMENT_PDF_READ_MAX_BYTES } from "$lib/api/schemas/attachments";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import { createAsset } from "$lib/server/assets/assets";
import {
  damagedPdf,
  encryptedPdf,
  makePdf,
  PAGE_HEIGHT,
  pageWidth,
} from "$lib/server/files/test-pdfs";
import { plainJpeg, plainPng } from "$lib/server/files/test-images";
import { useTestDB } from "$lib/testing/db";
import { ctxAt } from "$lib/testing/domain";
import { useTestFilesDir } from "$lib/testing/files";
import { failure, fieldErrors } from "$lib/testing/vehicles";
import { createAttachment } from "./attachments";
import { attachmentPreview } from "./preview";

describe("the preview of an attachment", () => {
  const test = useTestDB();
  const files = useTestFilesDir();
  const ctx = () => ctxAt(test.db);

  async function store(bytes: Uint8Array, filename: string) {
    const asset = createAsset(
      ctx(),
      createAssetRequestSchema.parse({ name: `Gerät ${filename}` }),
    );
    return createAttachment(ctx(), {
      bytes,
      filename,
      ownerType: "asset",
      ownerId: asset.id,
      uploadedBy: null,
    });
  }
  const widths = async (bytes: Uint8Array) =>
    (await PDFDocument.load(bytes)).getPages().map((p) => p.getSize().width);
  const details = (err: { details?: unknown }) =>
    err.details as Record<string, unknown>;

  describe("an image", () => {
    it("is sent as stored when it fits", async () => {
      const row = await store(plainPng(64, 48), "bild.png");
      const out = await attachmentPreview(ctx(), row.id, {});
      expect(out).toMatchObject({
        mime: "image/png",
        filename: "bild.png",
        etag: `"${row.sha256}"`,
        scaled: false,
        pageCount: null,
      });
      const stored = await Bun.file(join(files.dir, row.path)).bytes();
      expect(Buffer.from(out.bytes).equals(Buffer.from(stored))).toBe(true);
    });

    it("is scaled down to a JPEG when it is large, with an etag of its own", async () => {
      const row = await store(plainJpeg(3200, 2400), "foto.jpeg");
      const out = await attachmentPreview(ctx(), row.id, {});
      expect(out).toMatchObject({
        mime: "image/jpeg",
        filename: "foto.jpeg",
        etag: `"${row.sha256}-preview"`,
        scaled: true,
        pageCount: null,
      });
      expect(out.bytes.byteLength).toBeLessThan(row.size);
    });

    it("has no pages: asking for some is a 400 on pages", async () => {
      const row = await store(plainPng(), "bild.png");
      const err = await failure(() =>
        attachmentPreview(ctx(), row.id, { pages: "1" }),
      );
      expect(err.code).toBe("invalid_request");
      expect(fieldErrors(err, "pages")).toHaveLength(0);
      expect(
        (details(err).query as { fieldErrors: Record<string, string[]> })
          .fieldErrors,
      ).toHaveProperty("pages");
      expect(details(err).code).toBe("not_a_pdf");
    });
  });

  describe("a PDF", () => {
    it("without pages: a small one is sent as stored, with its page count", async () => {
      const bytes = await makePdf(8);
      const row = await store(bytes, "handbuch.pdf");
      const out = await attachmentPreview(ctx(), row.id, {});
      expect(out).toMatchObject({
        mime: "application/pdf",
        filename: "handbuch.pdf",
        etag: `"${row.sha256}"`,
        scaled: false,
        pageCount: 8,
      });
      expect(Buffer.from(out.bytes).equals(Buffer.from(bytes))).toBe(true);
    });

    it("a small one with more than 20 pages is still sent whole", async () => {
      const row = await store(await makePdf(60), "dick.pdf");
      const out = await attachmentPreview(ctx(), row.id, {});
      expect(out.pageCount).toBe(60);
      expect(await widths(out.bytes)).toHaveLength(60);
    });

    it.each([
      ["3", [3], "3"],
      ["3-5", [3, 4, 5], "3-5"],
      ["3-3", [3], "3"],
      ["1", [1], "1"],
      ["10", [10], "10"],
      ["1-10", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "1-10"],
      [" 2-4 ", [2, 3, 4], "2-4"],
    ])(
      "with pages %j: a PDF of just those pages",
      async (pages, expected, label) => {
        const row = await store(await makePdf(10), "handbuch.pdf");
        const out = await attachmentPreview(ctx(), row.id, { pages });
        expect(await widths(out.bytes)).toEqual(expected.map(pageWidth));
        expect(out).toMatchObject({
          mime: "application/pdf",
          filename: `handbuch-pages-${label}.pdf`,
          etag: `"${row.sha256}-pages-${label}"`,
          scaled: false,
          pageCount: 10,
        });
        expect(
          (await PDFDocument.load(out.bytes)).getPage(0).getSize().height,
        ).toBe(PAGE_HEIGHT);
      },
    );

    it("takes twenty pages and keeps the page size a page tree gives", async () => {
      const row = await store(
        await makePdf(40, { inheritSize: true }),
        "a.pdf",
      );
      const out = await attachmentPreview(ctx(), row.id, { pages: "21-40" });
      expect(await widths(out.bytes)).toEqual(Array(20).fill(pageWidth(1)));
    });

    it("a range that reaches past the end is a 400 on pages that says how many pages there are", async () => {
      const row = await store(await makePdf(5), "kurz.pdf");
      for (const pages of ["6", "4-6", "5-24"]) {
        const err = await failure(() =>
          attachmentPreview(ctx(), row.id, { pages }),
        );
        expect(err.code, pages).toBe("invalid_request");
        expect(details(err), pages).toMatchObject({
          code: "out_of_range",
          pageCount: 5,
        });
        expect(
          (details(err).query as { fieldErrors: Record<string, string[]> })
            .fieldErrors,
        ).toHaveProperty("pages");
      }
      expect(
        (await attachmentPreview(ctx(), row.id, { pages: "5" })).pageCount,
      ).toBe(5);
    });

    describe("over 4 MiB", () => {
      const big = () =>
        makePdf(50, { padBytes: ATTACHMENT_PDF_READ_MAX_BYTES + 100_000 });

      it("is not sent whole: a 400 too_large with the number of its pages", async () => {
        const row = await store(await big(), "riesig.pdf");
        expect(row.size).toBeGreaterThan(ATTACHMENT_PDF_READ_MAX_BYTES);
        const err = await failure(() => attachmentPreview(ctx(), row.id, {}));
        expect(err.code).toBe("invalid_request");
        expect(err.status).toBe(400);
        expect(details(err)).toMatchObject({
          code: "too_large",
          pageCount: 50,
        });
      });

      it("is read a range of pages at a time, which is small", async () => {
        const row = await store(await big(), "riesig.pdf");
        const out = await attachmentPreview(ctx(), row.id, { pages: "10-12" });
        expect(await widths(out.bytes)).toEqual([10, 11, 12].map(pageWidth));
        expect(out.bytes.byteLength).toBeLessThan(50_000);
        expect(out.pageCount).toBe(50);
      });

      it("that cannot be opened is unreadable, not too large: no range would help", async () => {
        const bytes = new Uint8Array(ATTACHMENT_PDF_READ_MAX_BYTES + 10);
        bytes.set(damagedPdf());
        const row = await store(bytes, "kaputt.pdf");
        const err = await failure(() => attachmentPreview(ctx(), row.id, {}));
        expect(details(err).code).toBe("unreadable");
      });
    });

    describe("that cannot be opened", () => {
      it.each([
        ["an encrypted one", encryptedPdf],
        ["a damaged one", async () => damagedPdf()],
      ])(
        "%s is unreadable when pages are asked for, and sent whole when small",
        async (_name, make) => {
          const bytes = await make();
          const row = await store(bytes, "zu.pdf");
          const err = await failure(() =>
            attachmentPreview(ctx(), row.id, { pages: "1" }),
          );
          expect(err.code).toBe("invalid_request");
          expect(details(err).code).toBe("unreadable");

          const whole = await attachmentPreview(ctx(), row.id, {});
          expect(whole).toMatchObject({
            pageCount: null,
            mime: "application/pdf",
          });
          expect(Buffer.from(whole.bytes).equals(Buffer.from(bytes))).toBe(
            true,
          );
        },
      );
    });
  });

  describe("a file that is not there", () => {
    it("is a 404 for an attachment that does not exist", async () => {
      expect(
        (await failure(() => attachmentPreview(ctx(), "missing", {}))).code,
      ).toBe("not_found");
    });

    it("is a 404 when the stored file is gone, logged by id only", async () => {
      const row = await store(plainPng(), "weg.png");
      await rm(join(files.dir, row.path));
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(
        (await failure(() => attachmentPreview(ctx(), row.id, {}))).code,
      ).toBe("not_found");
      expect(error.mock.calls.map((c) => String(c[0]))).toEqual([
        JSON.stringify({ event: "attachments.file_missing", id: row.id }),
      ]);
      error.mockRestore();
    });
  });
});
