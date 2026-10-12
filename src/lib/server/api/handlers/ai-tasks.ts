import type { z } from "zod";
import type { AiTaskClosedVia } from "$lib/api/enums";
import type { endpoints } from "$lib/api/registry";
import type { aiTaskSchema } from "$lib/api/schemas/ai-tasks";
import { toIso } from "$lib/api/schemas/common";
import {
  completeAiTask,
  deleteAiTask,
  dismissAiTask,
  getAiTask,
  listAiTasks,
  recordAiTask,
  type AiTaskRecord,
} from "$lib/server/ai-tasks/ai-tasks";
import { taskPreview } from "$lib/server/ai-tasks/preview";
import { fileResponse } from "$lib/server/files/serve";
import type { Principal } from "$lib/server/auth/types";
import { reply, type Handler } from "../bind";
import { wireAttachment } from "../wire";

/** `session` for a person in the browser, else the kind of the API token. */
export function closedVia(principal: Principal): AiTaskClosedVia {
  return principal.auth === "session" ? "session" : principal.token.kind;
}

const iso = (value: Date | null) => (value ? toIso(value) : null);

export function wireAiTask(t: AiTaskRecord): z.input<typeof aiTaskSchema> {
  return {
    id: t.id,
    kind: t.kind,
    status: t.status,
    note: t.note,
    createdByUserId: t.createdByUserId,
    createdByName: t.createdByName,
    attachment: t.attachment ? wireAttachment(t.attachment) : null,
    bookId: t.bookId,
    bookName: t.bookName,
    assetId: t.assetId,
    assetName: t.assetName,
    result: t.resultJson
      ? {
          createdCostIds: t.resultJson.createdCostIds,
          createdFuelLogIds: t.resultJson.createdFuelLogIds,
          note: t.resultJson.note,
          costs: t.resultCosts,
        }
      : null,
    dismissReason: t.dismissReason,
    completedAt: iso(t.completedAt),
    completedVia: t.completedVia,
    createdAt: toIso(t.createdAt),
    updatedAt: toIso(t.updatedAt),
  };
}

export const create: Handler<typeof endpoints.aiTasksCreate> = async ({
  ctx,
  body,
}) => {
  const { task, replayed } = await recordAiTask(
    ctx,
    {
      kind: body.kind,
      bytes: new Uint8Array(await body.file.arrayBuffer()),
      filename: body.file.name,
      declaredMime: body.file.type,
      note: body.note,
      bookId: body.bookId,
      assetId: body.assetId,
      idempotencyKey: body.idempotencyKey,
    },
    ctx.user.id,
  );
  const out = wireAiTask(task);
  return replayed ? reply(200, out) : out;
};

export const list: Handler<typeof endpoints.aiTasksList> = ({ ctx, query }) => {
  const { cursor, limit, ...filter } = query;
  const page = listAiTasks(ctx, filter, { cursor, limit });
  return { items: page.items.map(wireAiTask), nextCursor: page.nextCursor };
};

export const get: Handler<typeof endpoints.aiTasksGet> = ({ ctx, params }) =>
  wireAiTask(getAiTask(ctx, params.id));

export const preview: Handler<typeof endpoints.aiTasksPreview> = async ({
  ctx,
  params,
  event,
}) => {
  const file = await taskPreview(ctx, params.id);
  return fileResponse(new Blob([file.bytes as BlobPart]), {
    mime: file.mime,
    filename: file.filename,
    disposition: "inline",
    etag: file.etag,
    request: event.request,
  });
};

export const complete: Handler<typeof endpoints.aiTasksComplete> = ({
  ctx,
  params,
  body,
}) =>
  wireAiTask(completeAiTask(ctx, params.id, body, closedVia(ctx.principal)));

export const dismiss: Handler<typeof endpoints.aiTasksDismiss> = ({
  ctx,
  params,
  body,
}) => wireAiTask(dismissAiTask(ctx, params.id, body, closedVia(ctx.principal)));

export const remove: Handler<typeof endpoints.aiTasksDelete> = ({
  ctx,
  params,
}) => {
  deleteAiTask(ctx, ctx.user, params.id);
  return null;
};
