import type { AttachmentOwnerType } from "$lib/api/enums";
import type { endpoints } from "$lib/api/registry";
import { requireScopes } from "$lib/server/auth/guards";
import {
  createAttachment,
  deleteAttachment,
  getAttachment,
  listAttachments,
  openAttachmentFile,
  updateAttachment,
} from "$lib/server/attachments/attachments";
import { defaultDisposition, fileResponse } from "$lib/server/files/serve";
import { notFound } from "$lib/server/service";
import type { AuthedContext } from "../context";
import type { Handler } from "../bind";
import { wireAttachment } from "../wire";

/**
 * Files on a documentation page are documentation: they need the same scope as editing it. Receipts
 * on a cost entry are financial records: they need the costs scope.
 */
function requireOwnerScope(ctx: AuthedContext, ownerType: AttachmentOwnerType) {
  if (ownerType === "page") requireScopes(ctx.principal, ["docs:write"]);
  if (ownerType === "cost") requireScopes(ctx.principal, ["costs:write"]);
}

export const upload: Handler<typeof endpoints.attachmentsUpload> = async ({
  ctx,
  body,
}) => {
  requireOwnerScope(ctx, body.ownerType);
  const row = await createAttachment(ctx, {
    bytes: new Uint8Array(await body.file.arrayBuffer()),
    filename: body.file.name,
    declaredMime: body.file.type,
    ownerType: body.ownerType,
    ownerId: body.ownerId,
    caption: body.caption,
    guestVisible: body.guestVisible,
    uploadedBy: ctx.user.id,
  });
  return wireAttachment(row);
};

export const list: Handler<typeof endpoints.attachmentsList> = ({
  ctx,
  query,
}) => {
  const { cursor, limit, ...owner } = query;
  const page = listAttachments(ctx, owner, { cursor, limit });
  return {
    items: page.items.map(wireAttachment),
    nextCursor: page.nextCursor,
  };
};

export const get: Handler<typeof endpoints.attachmentsGet> = ({
  ctx,
  params,
}) => wireAttachment(getAttachment(ctx, params.id));

export const update: Handler<typeof endpoints.attachmentsUpdate> = ({
  ctx,
  params,
  body,
}) => {
  requireOwnerScope(ctx, getAttachment(ctx, params.id).ownerType);
  return wireAttachment(updateAttachment(ctx, params.id, body));
};

export const remove: Handler<typeof endpoints.attachmentsDelete> = async ({
  ctx,
  params,
}) => {
  requireOwnerScope(ctx, getAttachment(ctx, params.id).ownerType);
  await deleteAttachment(ctx, params.id);
  return null;
};

const THUMB_MIME = "image/webp";

async function serve(
  ctx: AuthedContext,
  id: string,
  variant: "content" | "thumb",
  download: boolean,
  request: Request,
): Promise<Response> {
  const row = getAttachment(ctx, id);
  const file = await openAttachmentFile(row, variant);
  if (!file) {
    if (variant === "content" || row.thumbPath) {
      // The row exists but the stored file is gone: say so in the log (id only), answer 404.
      console.error(
        JSON.stringify({ event: "attachments.file_missing", id: row.id }),
      );
    }
    throw notFound("File");
  }
  const mime = variant === "thumb" ? THUMB_MIME : row.mime;
  return fileResponse(file, {
    mime,
    filename: variant === "thumb" ? "thumbnail.webp" : row.filename,
    disposition: download ? "attachment" : defaultDisposition(mime),
    etag: `"${row.sha256}${variant === "thumb" ? "-thumb" : ""}"`,
    request,
  });
}

export const content: Handler<typeof endpoints.attachmentsContent> = ({
  ctx,
  params,
  query,
  event,
}) => serve(ctx, params.id, "content", query.download ?? false, event.request);

export const thumb: Handler<typeof endpoints.attachmentsThumb> = ({
  ctx,
  params,
  event,
}) => serve(ctx, params.id, "thumb", false, event.request);
