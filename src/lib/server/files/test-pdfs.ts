import { randomBytes } from "node:crypto";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";

/** The width of page `n` (1-based) of the PDFs below, so that a page can be told from the others by its size. */
export const pageWidth = (n: number) => 200 + n;
export const PAGE_HEIGHT = 300;

export interface TestPdfOptions {
  /** Unreferenced filler (random bytes, so it does not compress) that makes the file larger without adding pages. */
  padBytes?: number;
  /** Put the page size on the page tree instead of on each page, as many generators do. */
  inheritSize?: boolean;
}

/** A valid PDF with `pageCount` pages of the sizes `pageWidth(n)` x `PAGE_HEIGHT`. */
export async function makePdf(
  pageCount: number,
  options: TestPdfOptions = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (let n = 1; n <= pageCount; n++) {
    doc.addPage([pageWidth(n), PAGE_HEIGHT]);
  }
  if (options.padBytes) {
    doc.context.register(doc.context.stream(randomBytes(options.padBytes)));
  }
  if (options.inheritSize) {
    // Every page of this file has the size of the first and gets it from the page tree.
    const tree = doc.context.lookup(
      doc.catalog.get(PDFName.of("Pages")),
      PDFDict,
    );
    tree.set(
      PDFName.of("MediaBox"),
      doc.context.obj([0, 0, pageWidth(1), PAGE_HEIGHT]),
    );
    for (const page of doc.getPages()) page.node.delete(PDFName.of("MediaBox"));
  }
  return doc.save();
}

/** A PDF that declares itself encrypted: pdf-lib refuses to open it. */
export async function encryptedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage([200, 300]);
  doc.context.trailerInfo.Encrypt = doc.context.register(
    doc.context.obj({ Filter: "Standard", V: 1, R: 2 }),
  );
  return doc.save();
}

/** Starts like a PDF and is not one. */
export const damagedPdf = (): Uint8Array =>
  new TextEncoder().encode(
    "%PDF-1.4\n1 0 obj<< /Type /Catalog >>endobj\nthis is not a pdf\n%%EOF\n",
  );
