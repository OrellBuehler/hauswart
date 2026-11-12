import {
  ATTACHMENT_PDF_READ_MAX_BYTES,
  ATTACHMENT_PREVIEW_MAX_BYTES,
  ATTACHMENT_PREVIEW_MAX_SIDE,
  parsePageRange,
} from "$lib/api/schemas/attachments";
import { ApiError } from "$lib/api/errors";
import { withExtension } from "$lib/server/files/filename";
import { openPdf, PdfUnreadableError } from "$lib/server/files/pdf-pages";
import { previewImage } from "$lib/server/files/preview";
import { defaultFilesRoot } from "$lib/server/files/store";
import {
  invalidFieldWith,
  notFound,
  type ServiceContext,
} from "$lib/server/service";
import {
  getAttachment,
  openAttachmentFile,
  type AttachmentRecord,
} from "./attachments";

export interface AttachmentPreview {
  bytes: Uint8Array;
  mime: string;
  filename: string;
  etag: string;
  /** Whether an image was scaled down (the bytes are not the stored ones). */
  scaled: boolean;
  /** The pages of the whole stored PDF; null for an image and for a PDF that cannot be opened (but is small enough to send). */
  pageCount: number | null;
}

/**
 * An image as an assistant reads it: as stored when it fits (`ATTACHMENT_PREVIEW_MAX_SIDE`, `ATTACHMENT_PREVIEW_MAX_BYTES`),
 * else scaled down and sent as JPEG. A file without dimensions is sent as stored.
 */
export async function previewOfImage(
  file: AttachmentRecord,
  bytes: Uint8Array,
): Promise<AttachmentPreview> {
  if (file.width === null || file.height === null) {
    return {
      bytes,
      mime: file.mime,
      filename: file.filename,
      etag: `"${file.sha256}"`,
      scaled: false,
      pageCount: null,
    };
  }
  const image = await previewImage(
    { bytes, mime: file.mime, width: file.width, height: file.height },
    {
      maxSide: ATTACHMENT_PREVIEW_MAX_SIDE,
      maxBytes: ATTACHMENT_PREVIEW_MAX_BYTES,
    },
  );
  return {
    bytes: image.bytes,
    mime: image.mime,
    filename: image.scaled
      ? withExtension(file.filename, "jpg", ["jpeg"])
      : file.filename,
    etag: `"${file.sha256}${image.scaled ? "-preview" : ""}"`,
    scaled: image.scaled,
    pageCount: null,
  };
}

const refusal = (code: string, message: string, extra: object = {}) =>
  new ApiError("invalid_request", message, { details: { code, ...extra } });

/**
 * A PDF for an assistant: with `pages` a PDF of just those pages; without, the file as stored when it is at most
 * `ATTACHMENT_PDF_READ_MAX_BYTES`, else a 400 `too_large` that says how many pages it has so that a range can be asked for. A PDF
 * that cannot be opened is a 400 `unreadable` for a page request (and for a large one, which cannot be read in parts either);
 * a small one is still sent whole, without a page count.
 */
export async function previewOfPdf(
  file: AttachmentRecord,
  bytes: Uint8Array,
  pages: string | undefined,
): Promise<AttachmentPreview> {
  if (
    pages === undefined &&
    bytes.byteLength <= ATTACHMENT_PDF_READ_MAX_BYTES
  ) {
    let pageCount: number | null = null;
    try {
      pageCount = (await openPdf(bytes)).pageCount;
    } catch (err) {
      // A small PDF that cannot be opened is still sent whole (its reader may manage), without a page count.
      if (!(err instanceof PdfUnreadableError)) throw err;
    }
    return {
      bytes,
      mime: file.mime,
      filename: file.filename,
      etag: `"${file.sha256}"`,
      scaled: false,
      pageCount,
    };
  }
  let pdf;
  try {
    pdf = await openPdf(bytes);
  } catch (err) {
    if (!(err instanceof PdfUnreadableError)) throw err;
    throw refusal(
      "unreadable",
      "The PDF cannot be opened (it may be encrypted or damaged), so no pages can be taken from it.",
    );
  }
  if (pages === undefined) {
    throw refusal(
      "too_large",
      `The PDF is too large to read at once (${bytes.byteLength} bytes, more than ${ATTACHMENT_PDF_READ_MAX_BYTES}); it has ${pdf.pageCount} pages. Ask for a range of at most 20 pages with pages, for example 1-20.`,
      { pageCount: pdf.pageCount },
    );
  }
  const range = parsePageRange(pages);
  if (!range) {
    throw invalidFieldWith(
      "pages",
      "Give a page or a range of at most 20 pages",
      {},
      "query",
    );
  }
  if (range.last > pdf.pageCount) {
    throw invalidFieldWith(
      "pages",
      `The PDF has ${pdf.pageCount} pages`,
      { code: "out_of_range", pageCount: pdf.pageCount },
      "query",
    );
  }
  let extracted: Uint8Array;
  try {
    extracted = await pdf.extract(range.first, range.last);
  } catch (err) {
    if (!(err instanceof PdfUnreadableError)) throw err;
    throw refusal(
      "unreadable",
      "The pages cannot be copied out of this PDF; it may be damaged.",
    );
  }
  const stem = file.filename.replace(/\.pdf$/i, "");
  const label =
    range.first === range.last
      ? `${range.first}`
      : `${range.first}-${range.last}`;
  return {
    bytes: extracted,
    mime: "application/pdf",
    filename: `${stem}-pages-${label}.pdf`,
    etag: `"${file.sha256}-pages-${label}"`,
    scaled: false,
    pageCount: pdf.pageCount,
  };
}

/**
 * The file of an attachment as an assistant reads it (`GET /attachments/{id}/preview`): an image of a size it can take in
 * (see `previewOfImage`), a PDF whole or a range of its pages (see `previewOfPdf`). `pages` for an image is a 400 on
 * `pages`. 404 when the stored file is gone.
 */
export async function attachmentPreview(
  ctx: Pick<ServiceContext, "db">,
  id: string,
  options: { pages?: string },
  root: string = defaultFilesRoot(),
): Promise<AttachmentPreview> {
  const file = getAttachment(ctx, id);
  const stored = await openAttachmentFile(file, "content", root);
  if (!stored) {
    console.error(
      JSON.stringify({ event: "attachments.file_missing", id: file.id }),
    );
    throw notFound("File");
  }
  const bytes = new Uint8Array(await stored.arrayBuffer());
  if (file.mime === "application/pdf") {
    return previewOfPdf(file, bytes, options.pages);
  }
  if (options.pages !== undefined) {
    throw invalidFieldWith(
      "pages",
      "Only a PDF has pages",
      { code: "not_a_pdf" },
      "query",
    );
  }
  return previewOfImage(file, bytes);
}
