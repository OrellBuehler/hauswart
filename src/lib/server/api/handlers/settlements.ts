import type { z } from "zod";
import type { endpoints } from "$lib/api/registry";
import { toIso } from "$lib/api/schemas/common";
import type { settlementSchema } from "$lib/api/schemas/settlements";
import {
  deleteSettlement,
  getSettlement,
  listSettlements,
  recordSettlement,
  updateSettlement,
  type SettlementRecord,
} from "$lib/server/costs/settlements";
import { reply, type Handler } from "../bind";

export function wireSettlement(
  s: SettlementRecord,
): z.input<typeof settlementSchema> {
  return {
    id: s.id,
    bookId: s.bookId,
    bookName: s.bookName,
    fromUserId: s.fromUserId,
    fromName: s.fromName,
    toUserId: s.toUserId,
    toName: s.toName,
    amountMinor: s.amountMinor,
    currency: s.currency,
    date: s.date,
    note: s.note,
    createdBy: s.createdBy,
    createdAt: toIso(s.createdAt),
    updatedAt: toIso(s.updatedAt),
  };
}

export const list: Handler<typeof endpoints.settlementsList> = ({
  ctx,
  query,
}) => {
  const { cursor, limit, ...filter } = query;
  const page = listSettlements(ctx, filter, { cursor, limit }, ctx.user.id);
  return {
    items: page.items.map(wireSettlement),
    nextCursor: page.nextCursor,
  };
};

export const create: Handler<typeof endpoints.settlementsCreate> = ({
  ctx,
  body,
}) => {
  const { settlement, replayed } = recordSettlement(ctx, body, ctx.user.id);
  const out = wireSettlement(settlement);
  return replayed ? reply(200, out) : out;
};

export const get: Handler<typeof endpoints.settlementsGet> = ({
  ctx,
  params,
}) => wireSettlement(getSettlement(ctx, params.id));

export const update: Handler<typeof endpoints.settlementsUpdate> = ({
  ctx,
  params,
  body,
}) => wireSettlement(updateSettlement(ctx, params.id, body));

export const remove: Handler<typeof endpoints.settlementsDelete> = ({
  ctx,
  params,
}) => {
  deleteSettlement(ctx, params.id);
  return null;
};
