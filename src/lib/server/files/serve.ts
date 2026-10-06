import { contentDisposition } from "./filename";
import { isAllowedMime, type AllowedMime } from "./sniff";

/**
 * Policy for serving stored files.
 *
 * - Only allowlisted mime types are sent with their own type; anything else is served as
 *   `application/octet-stream` and forced to `attachment`.
 * - Images are inline. PDFs are inline too (reading manuals in the browser, notably on phones,
 *   is the main use). PDF viewers run isolated from the page origin and the response carries
 *   `nosniff`, so the residual risk is low; the CSP `sandbox` directive is deliberately NOT
 *   used for PDFs because browsers' built-in viewers refuse to render sandboxed documents. A
 *   caller that wants the strictest behaviour passes `disposition: 'attachment'` for PDFs.
 * - Files are content-addressed, so the body of a URL never changes: `immutable` caching, but
 *   `private` because access is authorized per request and shared caches must not keep it.
 */

export interface FileResponseOptions {
  mime: string;
  filename: string;
  disposition: "inline" | "attachment";
  /** Strong etag; enables conditional requests when `request` is given. */
  etag?: string;
  request?: Request;
  /** Default `immutable`. */
  cache?: "immutable" | "no-store";
}

const BASE_CSP =
  "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'";

function matchesEtag(header: string | null, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;
  return header
    .split(",")
    .map((part) => part.trim().replace(/^W\//, ""))
    .includes(etag);
}

export function defaultDisposition(mime: string): "inline" | "attachment" {
  return isAllowedMime(mime) ? "inline" : "attachment";
}

export function fileResponse(
  file: Blob,
  options: FileResponseOptions,
): Response {
  const known = isAllowedMime(options.mime);
  const mime: AllowedMime | "application/octet-stream" = known
    ? (options.mime as AllowedMime)
    : "application/octet-stream";
  const disposition = known ? options.disposition : "attachment";
  const inline = disposition === "inline";

  const headers = new Headers({
    "Content-Type": mime,
    "Content-Disposition": contentDisposition(disposition, options.filename),
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": inline
      ? `${BASE_CSP}; frame-ancestors 'self'${mime === "application/pdf" ? "" : "; sandbox"}`
      : `${BASE_CSP}; sandbox`,
    "Cache-Control":
      options.cache === "no-store"
        ? "no-store"
        : "private, max-age=31536000, immutable",
  });
  if (options.etag) headers.set("ETag", options.etag);

  if (
    options.etag &&
    options.request &&
    matchesEtag(options.request.headers.get("If-None-Match"), options.etag)
  ) {
    headers.delete("Content-Type");
    headers.delete("Content-Disposition");
    return new Response(null, { status: 304, headers });
  }

  headers.set("Content-Length", String(file.size));
  return new Response(file, { status: 200, headers });
}
