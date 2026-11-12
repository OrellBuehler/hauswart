import { PDFDocument } from "pdf-lib";

/**
 * Reading a PDF's page count and copying some of its pages into a PDF of their own (pdf-lib, no rendering). A PDF it cannot
 * open (encrypted, damaged, nothing that looks like pages) is a `PdfUnreadableError`.
 */

export class PdfUnreadableError extends Error {
  override name = "PdfUnreadableError";
  constructor(cause?: unknown) {
    super("The PDF cannot be opened.", { cause });
  }
}

export interface OpenPdf {
  pageCount: number;
  /** A PDF of the pages `first` to `last` (1-based, both included) of this one. */
  extract(first: number, last: number): Promise<Uint8Array>;
}

export async function openPdf(bytes: Uint8Array): Promise<OpenPdf> {
  let source: PDFDocument;
  let pageCount: number;
  try {
    // Encrypted files are refused (pdf-lib would read their still encrypted content as garbage).
    source = await PDFDocument.load(bytes, { updateMetadata: false });
    pageCount = source.getPageCount();
  } catch (cause) {
    throw new PdfUnreadableError(cause);
  }
  // pdf-lib reads a file that is no PDF at all as one without pages.
  if (pageCount < 1) throw new PdfUnreadableError();
  return {
    pageCount,
    async extract(first, last) {
      const indices = Array.from(
        { length: last - first + 1 },
        (_, i) => first - 1 + i,
      );
      try {
        const target = await PDFDocument.create({ updateMetadata: false });
        for (const page of await target.copyPages(source, indices)) {
          target.addPage(page);
        }
        return await target.save();
      } catch (cause) {
        throw new PdfUnreadableError(cause);
      }
    },
  };
}
