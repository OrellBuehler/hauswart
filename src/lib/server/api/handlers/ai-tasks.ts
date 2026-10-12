import type { z } from "zod";
import type { AiTaskClosedVia } from "$lib/api/enums";
import type { endpoints } from "$lib/api/registry";
import {
  AI_TASK_CLAIM_MINUTES,
  type aiTaskSchema,
} from "$lib/api/schemas/ai-tasks";
import { toIso } from "$lib/api/schemas/common";
import {
  claimAiTask,
  claimIsActive,
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

export function wireAiTask(
  t: AiTaskRecord,
  now: number,
): z.input<typeof aiTaskSchema> {
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
    claim:
      t.status === "pending" &&
      t.claimedByUserId !== null &&
      t.claimedAt !== null &&
      claimIsActive(t.claimedAt, now)
        ? {
            byUserId: t.claimedByUserId,
            byName: t.claimedByName,
            at: toIso(t.claimedAt),
            expiresAt: toIso(
              new Date(t.claimedAt.getTime() + AI_TASK_CLAIM_MINUTES * 60_000),
            ),
          }
        : null,
    bookedSoFar: t.bookedSoFar,
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
    completedByUserId: t.completedByUserId,
    completedByName: t.completedByName,
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
  const out = wireAiTask(task, ctx.now);
  return replayed ? reply(200, out) : out;
};

export const list: Handler<typeof endpoints.aiTasksList> = ({ ctx, query }) => {
  const { cursor, limit, ...filter } = query;
  const page = listAiTasks(ctx, filter, { cursor, limit });
  return {
    items: page.items.map((task) => wireAiTask(task, ctx.now)),
    nextCursor: page.nextCursor,
  };
};

export const get: Handler<typeof endpoints.aiTasksGet> = ({ ctx, params }) =>
  wireAiTask(getAiTask(ctx, params.id), ctx.now);

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
  wireAiTask(
    completeAiTask(ctx, params.id, body, closedVia(ctx.principal), ctx.user.id),
    ctx.now,
  );

export const dismiss: Handler<typeof endpoints.aiTasksDismiss> = ({
  ctx,
  params,
  body,
}) =>
  wireAiTask(
    dismissAiTask(ctx, params.id, body, closedVia(ctx.principal), ctx.user.id),
    ctx.now,
  );

export const claim: Handler<typeof endpoints.aiTasksClaim> = ({
  ctx,
  params,
}) => wireAiTask(claimAiTask(ctx, params.id, ctx.user.id), ctx.now);

export const remove: Handler<typeof endpoints.aiTasksDelete> = ({
  ctx,
  params,
}) => {
  deleteAiTask(ctx, ctx.user, params.id);
  return null;
};
