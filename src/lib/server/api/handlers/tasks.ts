import type { CompletionSource } from "$lib/api/enums";
import type { endpoints } from "$lib/api/registry";
import { RECENT_COMPLETIONS_IN_DETAIL } from "$lib/api/schemas/tasks";
import type { Principal } from "$lib/server/auth/types";
import {
  completeTask,
  listCompletions,
  recentCompletionsOf,
  snoozeTask,
  undoCompletion,
} from "$lib/server/tasks/completions";
import {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  previewTrigger,
  updateTask,
} from "$lib/server/tasks/tasks";
import { listPreparations } from "$lib/server/tasks/preparations";
import { reply, type Handler } from "../bind";
import { wireCompletion, wirePreparation, wireTask } from "../wire";

/**
 * Who did it, as the record will say. A browser session is `manual` unless it
 * says it came from a QR scan or a notification; a token is attributed by what
 * it is (an MCP server, a home-automation hub, otherwise a client of the API) and
 * cannot claim to be a person at a QR code.
 */
export function completionSourceFor(
  principal: Principal,
  requested?: "manual" | "qr" | "notification",
): CompletionSource {
  if (principal.auth === "session") return requested ?? "manual";
  switch (principal.token.kind) {
    case "mcp":
      return "mcp";
    case "ha":
      return "ha";
    default:
      return "api";
  }
}

export const list: Handler<typeof endpoints.tasksList> = ({ ctx, query }) => {
  const { cursor, limit, ...filter } = query;
  const page = listTasks(ctx, filter, { cursor, limit }, ctx.user.id);
  return { items: page.items.map(wireTask), nextCursor: page.nextCursor };
};

export const create: Handler<typeof endpoints.tasksCreate> = async ({
  ctx,
  body,
}) => wireTask(await createTask(ctx, body, ctx.user.id));

export const preview: Handler<typeof endpoints.tasksPreview> = ({
  ctx,
  body,
}) =>
  previewTrigger(ctx, body.trigger, {
    today: body.today,
    graceDays: body.graceDays,
    dueSoonDays: body.dueSoonDays,
  });

export const get: Handler<typeof endpoints.tasksGet> = async ({
  ctx,
  params,
}) => {
  const task = getTask(ctx, params.id);
  return {
    ...wireTask(task),
    preparations: (await listPreparations(ctx, task.id)).map(wirePreparation),
    recentCompletions: recentCompletionsOf(
      ctx,
      task.id,
      RECENT_COMPLETIONS_IN_DETAIL,
    ).map(wireCompletion),
  };
};

export const update: Handler<typeof endpoints.tasksUpdate> = async ({
  ctx,
  params,
  body,
}) => wireTask(await updateTask(ctx, params.id, body));

export const remove: Handler<typeof endpoints.tasksDelete> = ({
  ctx,
  params,
}) => {
  deleteTask(ctx, params.id);
  return null;
};

export const complete: Handler<typeof endpoints.tasksComplete> = async ({
  ctx,
  params,
  body,
}) => {
  const result = await completeTask(ctx, params.id, {
    kind: "done",
    source: completionSourceFor(ctx.principal, body.source),
    userId: ctx.user.id,
    note: body.note,
    occurrenceKey: body.occurrenceKey,
    completedAt: body.completedAt ? Date.parse(body.completedAt) : undefined,
    idempotencyKey: body.idempotencyKey,
    counterValue: body.counterValue,
  });
  const out = {
    completion: wireCompletion(result.completion),
    task: wireTask(result.task),
  };
  return result.replayed ? reply(200, out) : out;
};

export const skip: Handler<typeof endpoints.tasksSkip> = async ({
  ctx,
  params,
  body,
}) => {
  const result = await completeTask(ctx, params.id, {
    kind: "skipped",
    source: completionSourceFor(ctx.principal, body.source),
    userId: ctx.user.id,
    note: body.note,
    occurrenceKey: body.occurrenceKey,
    completedAt: body.completedAt ? Date.parse(body.completedAt) : undefined,
    idempotencyKey: body.idempotencyKey,
  });
  const out = {
    completion: wireCompletion(result.completion),
    task: wireTask(result.task),
  };
  return result.replayed ? reply(200, out) : out;
};

export const snooze: Handler<typeof endpoints.tasksSnooze> = async ({
  ctx,
  params,
  body,
}) => wireTask(await snoozeTask(ctx, params.id, body.until));

export const listAllCompletions: Handler<typeof endpoints.completionsList> = ({
  ctx,
  query,
}) => {
  const { cursor, limit, ...filter } = query;
  const page = listCompletions(ctx, filter, { cursor, limit });
  return {
    items: page.items.map(wireCompletion),
    nextCursor: page.nextCursor,
  };
};

export const undo: Handler<typeof endpoints.completionsUndo> = async ({
  ctx,
  params,
}) => {
  await undoCompletion(ctx, params.id, ctx.user.id);
  return null;
};
