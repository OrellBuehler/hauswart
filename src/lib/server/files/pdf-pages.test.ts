import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { openPdf, PdfUnreadableError } from "./pdf-pages";
import {
  damagedPdf,
  encryptedPdf,
  makePdf,
  PAGE_HEIGHT,
  pageWidth,
} from "./test-pdfs";

const sizes = async (bytes: Uint8Array) =>
  (await PDFDocument.load(bytes)).getPages().map((p) => p.getSize());

describe("openPdf", () => {
  it("counts the pages", async () => {
    expect((await openPdf(await makePdf(1))).pageCount).toBe(1);
    expect((await openPdf(await makePdf(37))).pageCount).toBe(37);
  });

  it.each([
    ["one page", 3, 3, [3]],
    ["a range", 2, 5, [2, 3, 4, 5]],
    ["the first page", 1, 1, [1]],
    ["the last page", 6, 6, [6]],
    ["all pages", 1, 6, [1, 2, 3, 4, 5, 6]],
  ])("takes %s into a PDF of its own", async (_name, first, last, expected) => {
    const pdf = await openPdf(await makePdf(6));
    const out = await pdf.extract(first, last);
    expect(await sizes(out)).toEqual(
      expected.map((n) => ({ width: pageWidth(n), height: PAGE_HEIGHT })),
    );
    expect(new TextDecoder().decode(out.subarray(0, 5))).toBe("%PDF-");
  });

  it("leaves the source alone and can be asked again", async () => {
    const pdf = await openPdf(await makePdf(4));
    await pdf.extract(1, 2);
    expect(await sizes(await pdf.extract(3, 4))).toEqual([
      { width: pageWidth(3), height: PAGE_HEIGHT },
      { width: pageWidth(4), height: PAGE_HEIGHT },
    ]);
    expect(pdf.pageCount).toBe(4);
  });

  it("does not carry the rest of the file along: the pages are much smaller than a padded document", async () => {
    const source = await makePdf(10, { padBytes: 2_000_000 });
    expect(source.byteLength).toBeGreaterThan(2_000_000);
    const out = await (await openPdf(source)).extract(2, 3);
    expect(out.byteLength).toBeLessThan(20_000);
  });

  it("keeps a page size that the page tree gives the pages", async () => {
    const out = await (
      await openPdf(await makePdf(5, { inheritSize: true }))
    ).extract(4, 5);
    expect(await sizes(out)).toEqual([
      { width: pageWidth(1), height: PAGE_HEIGHT },
      { width: pageWidth(1), height: PAGE_HEIGHT },
    ]);
  });

  it.each([
    ["an encrypted file", encryptedPdf],
    ["a damaged file", async () => damagedPdf()],
    ["a text file", async () => new TextEncoder().encode("hello")],
    ["an empty file", async () => new Uint8Array(0)],
    [
      "the PDF header and nothing else",
      async () => new TextEncoder().encode("%PDF-1.4\n"),
    ],
  ])("cannot open %s", async (_name, make) => {
    await expect(openPdf(await make())).rejects.toBeInstanceOf(
      PdfUnreadableError,
    );
  });
});
