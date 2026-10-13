import type { z } from "zod";
import type { endpoints } from "$lib/api/registry";
import type { costTagSchema } from "$lib/api/schemas/cost-tags";
import { toIso } from "$lib/api/schemas/common";
import {
  createCostTag,
  deleteCostTag,
  getCostTag,
  listCostTags,
  updateCostTag,
  type CostTagRecord,
} from "$lib/server/costs/tags";
import type { Handler } from "../bind";

export function wireCostTag(t: CostTagRecord): z.input<typeof costTagSchema> {
  return {
    id: t.id,
    name: t.name,
    color: t.color,
    entryCount: t.entryCount,
    createdAt: toIso(t.createdAt),
    updatedAt: toIso(t.updatedAt),
  };
}

export const list: Handler<typeof endpoints.costTagsList> = ({ ctx }) => ({
  items: listCostTags(ctx).map(wireCostTag),
});

export const create: Handler<typeof endpoints.costTagsCreate> = ({
  ctx,
  body,
}) => wireCostTag(createCostTag(ctx, body));

export const get: Handler<typeof endpoints.costTagsGet> = ({ ctx, params }) =>
  wireCostTag(getCostTag(ctx, params.id));

export const update: Handler<typeof endpoints.costTagsUpdate> = ({
  ctx,
  params,
  body,
}) => wireCostTag(updateCostTag(ctx, params.id, body));

export const remove: Handler<typeof endpoints.costTagsDelete> = ({
  ctx,
  params,
}) => {
  deleteCostTag(ctx, params.id);
  return null;
};
