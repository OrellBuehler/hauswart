import type { endpoints } from "$lib/api/registry";
import {
  completePreparation,
  createPreparation,
  deletePreparation,
  listPreparations,
  updatePreparation,
} from "$lib/server/tasks/preparations";
import type { Handler } from "../bind";
import { wirePreparation } from "../wire";

export const list: Handler<typeof endpoints.preparationsList> = async ({
  ctx,
  params,
}) => ({
  items: (await listPreparations(ctx, params.id)).map(wirePreparation),
  nextCursor: null,
});

export const create: Handler<typeof endpoints.preparationsCreate> = async ({
  ctx,
  params,
  body,
}) => wirePreparation(await createPreparation(ctx, params.id, body));

export const update: Handler<typeof endpoints.preparationsUpdate> = async ({
  ctx,
  params,
  body,
}) =>
  wirePreparation(await updatePreparation(ctx, params.id, params.prepId, body));

export const remove: Handler<typeof endpoints.preparationsDelete> = ({
  ctx,
  params,
}) => {
  deletePreparation(ctx, params.id, params.prepId);
  return null;
};

export const complete: Handler<typeof endpoints.preparationsComplete> = async ({
  ctx,
  params,
  body,
}) =>
  wirePreparation(
    await completePreparation(ctx, params.id, params.prepId, {
      userId: ctx.user.id,
      occurrenceKey: body.occurrenceKey,
    }),
  );
