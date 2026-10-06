import type { z } from "zod";
import type { DocumentProviderKind } from "$lib/api/enums";
import type { endpoints } from "$lib/api/registry";
import { toIso } from "$lib/api/schemas/common";
import type {
  documentLinkSchema,
  documentUploadSchema,
  externalDocumentSchema,
} from "$lib/api/schemas/documents";
import { requireScopes } from "$lib/server/auth/guards";
import { findAttachment } from "$lib/server/attachments/attachments";
import {
  getDocumentDetail,
  listDocuments,
  openDocumentFile,
  type DocumentView,
} from "$lib/server/documents/documents";
import {
  createLink,
  deleteLink,
  getLink,
  linkViews,
  listLinks,
  type LinkView,
} from "$lib/server/documents/links";
import type {
  DocumentFileKind,
  DocumentFileStream,
} from "$lib/server/documents/provider";
import {
  assetSuggestions,
  contactSuggestions,
} from "$lib/server/documents/suggestions";
import {
  getUpload,
  startPush,
  type UploadRow,
} from "$lib/server/documents/uploads";
import { contentDisposition } from "$lib/server/files/filename";
import { notFound } from "$lib/server/service";
import type { Handler } from "../bind";
import type { AuthedContext } from "../context";

const fileUrl = (
  provider: DocumentProviderKind,
  externalId: number,
  kind: DocumentFileKind,
) => `/api/v1/documents/${provider}/${externalId}/${kind}`;

export function wireDocument(
  view: DocumentView,
): z.input<typeof externalDocumentSchema> {
  const { provider, meta } = view;
  return {
    provider,
    externalId: meta.externalId,
    title: meta.title,
    createdDate: meta.createdDate,
    correspondentId: meta.correspondentId,
    correspondentName: meta.correspondentName,
    tagIds: meta.tagIds,
    tagNames: meta.tagNames,
    mimeType: meta.mimeType,
    pageCount: meta.pageCount,
    noteCount: meta.noteCount,
    warrantyUntil: meta.warrantyUntil,
    warrantyExtendedUntil: meta.warrantyExtendedUntil,
    linkedTo: view.linkedTo,
    thumbUrl: fileUrl(provider, meta.externalId, "thumb"),
    previewUrl: fileUrl(provider, meta.externalId, "preview"),
    downloadUrl: fileUrl(provider, meta.externalId, "download"),
  };
}

export function wireDocumentLink(
  view: LinkView,
): z.input<typeof documentLinkSchema> {
  const { link, document: doc } = view;
  return {
    id: link.id,
    provider: link.provider,
    externalId: link.externalId,
    ownerType: link.ownerType,
    ownerId: link.ownerId,
    ownerTitle: view.owner?.title ?? null,
    ownerUrl: view.owner?.url ?? null,
    role: link.role,
    label: link.label,
    available: view.available,
    document: doc
      ? {
          title: doc.title,
          createdDate: doc.createdDate,
          correspondentName: doc.correspondentName,
          mimeType: doc.mimeType,
          pageCount: doc.pageCount,
          tagNames: doc.tagNames,
        }
      : null,
    thumbUrl: doc ? fileUrl(link.provider, link.externalId, "thumb") : null,
    previewUrl: doc ? fileUrl(link.provider, link.externalId, "preview") : null,
    downloadUrl: doc
      ? fileUrl(link.provider, link.externalId, "download")
      : null,
    createdBy: link.createdBy,
    createdAt: toIso(link.createdAt),
    updatedAt: toIso(link.updatedAt),
  };
}

export function wireUpload(
  row: UploadRow,
): z.input<typeof documentUploadSchema> {
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    attachmentId: row.attachmentId,
    ownerType: row.ownerType,
    ownerId: row.ownerId,
    role: row.role,
    title: row.title,
    externalId: row.externalId,
    linkId: row.linkId,
    duplicate: row.duplicate,
    errorCode: row.errorCode,
    warning: row.warning,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/** Links to a page belong to the documentation: they need the same scope as editing it. */
const requireOwnerScope = (ctx: AuthedContext, ownerType: string) => {
  if (ownerType === "page") requireScopes(ctx.principal, ["docs:write"]);
};

export const list: Handler<typeof endpoints.documentsList> = async ({
  ctx,
  query,
}) => {
  const { cursor, limit, ...filter } = query;
  const page = await listDocuments(ctx, ctx.user.id, filter, { cursor, limit });
  return {
    items: page.items.map(wireDocument),
    nextCursor: page.nextCursor,
  };
};

export const suggestions: Handler<typeof endpoints.documentsSuggestions> = ({
  ctx,
  query,
}) => {
  if (query.kind === "asset") {
    return {
      items: assetSuggestions(ctx, ctx.user.id).map(({ provider, meta }) => ({
        kind: "asset" as const,
        provider,
        externalId: meta.externalId,
        title: meta.title,
        createdDate: meta.createdDate,
        correspondentName: meta.correspondentName,
        warrantyUntil: meta.warrantyUntil,
        warrantyExtendedUntil: meta.warrantyExtendedUntil,
      })),
    };
  }
  return {
    items: contactSuggestions(ctx, ctx.user.id).map((s) => ({
      kind: "contact" as const,
      ...s,
    })),
  };
};

export const get: Handler<typeof endpoints.documentsGet> = async ({
  ctx,
  params,
}) => {
  const detail = await getDocumentDetail(
    ctx,
    ctx.user.id,
    params.provider,
    params.externalId,
  );
  return {
    ...wireDocument(detail.view),
    webUrl: detail.webUrl,
    links: detail.links.map(wireDocumentLink),
  };
};

const BASE_CSP =
  "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'";

/**
 * A document from the provider, passed on as it comes: only types that are safe to display are
 * sent with their own type (everything else as an octet-stream download), `nosniff`, a CSP, and a
 * `private` cache because every person reads it through their own account.
 */
function fileResponse(
  file: DocumentFileStream,
  kind: DocumentFileKind,
): Response {
  const inline = kind !== "download" && file.inlineSafe;
  const headers = new Headers({
    "Content-Type": file.contentType,
    "Content-Disposition": contentDisposition(
      inline ? "inline" : "attachment",
      file.filename,
    ),
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": inline
      ? `${BASE_CSP}; frame-ancestors 'self'${file.contentType === "application/pdf" ? "" : "; sandbox"}`
      : `${BASE_CSP}; sandbox`,
    "Cache-Control": "private, max-age=300",
  });
  if (file.size !== null) headers.set("Content-Length", String(file.size));
  return new Response(file.stream, { status: 200, headers });
}

function serve(kind: DocumentFileKind) {
  return async ({
    ctx,
    params,
    query,
  }: {
    ctx: AuthedContext;
    params: { provider: DocumentProviderKind; externalId: number };
    query?: { original?: boolean };
  }) =>
    fileResponse(
      await openDocumentFile(
        ctx,
        ctx.user.id,
        params.provider,
        params.externalId,
        kind,
        { original: query?.original },
      ),
      kind,
    );
}

export const preview: Handler<typeof endpoints.documentsPreview> =
  serve("preview");
export const thumb: Handler<typeof endpoints.documentsThumb> = serve("thumb");
export const download: Handler<typeof endpoints.documentsDownload> =
  serve("download");

export const linksList: Handler<typeof endpoints.documentLinksList> = ({
  ctx,
  query,
}) => {
  const { cursor, limit, ...filter } = query;
  const page = listLinks(ctx, ctx.user.id, filter, { cursor, limit });
  return {
    items: page.items.map(wireDocumentLink),
    nextCursor: page.nextCursor,
  };
};

export const linksCreate: Handler<
  typeof endpoints.documentLinksCreate
> = async ({ ctx, body }) => {
  requireOwnerScope(ctx, body.ownerType);
  const row = await createLink(ctx, ctx.user.id, body);
  return wireDocumentLink(linkViews(ctx, ctx.user.id, [row])[0]);
};

export const linksDelete: Handler<typeof endpoints.documentLinksDelete> = ({
  ctx,
  params,
}) => {
  requireOwnerScope(ctx, getLink(ctx, params.id).ownerType);
  deleteLink(ctx, params.id);
  return null;
};

export const pushToDocuments: Handler<
  typeof endpoints.attachmentsPushToDocuments
> = ({ ctx, params, body }) => {
  // The new document is linked to the attachment's owner, so a page owner needs `docs:write`.
  const attachment = findAttachment(ctx, params.id);
  if (!attachment) throw notFound("Attachment");
  requireOwnerScope(ctx, attachment.ownerType);
  return wireUpload(startPush(ctx, ctx.user.id, params.id, body));
};

export const uploadsGet: Handler<typeof endpoints.documentUploadsGet> = ({
  ctx,
  params,
}) => wireUpload(getUpload(ctx, ctx.user.id, params.jobId));
