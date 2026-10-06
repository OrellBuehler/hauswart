import type { endpoints } from "$lib/api/registry";
import { listWarranties } from "$lib/server/warranties/warranties";
import type { Handler } from "../bind";
import { wireWarranty } from "../wire";

export const list: Handler<typeof endpoints.warrantiesList> = ({
  ctx,
  query,
}) => {
  const { cursor, limit, ...filter } = query;
  const page = listWarranties(ctx, filter, { cursor, limit });
  return { items: page.items.map(wireWarranty), nextCursor: page.nextCursor };
};
