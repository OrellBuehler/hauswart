import { z } from "zod";
import { PART_MOVEMENT_REASONS } from "../../../src/lib/api/enums";
import { endpoints } from "../../../src/lib/api/registry";
import type { OrderNowItem, Part } from "../../../src/lib/api/schemas/parts";
import { ToolError } from "../errors";
import { moreHint, plural } from "../format";
import { defineTool } from "../tool";
import { resolvePart } from "./resolve";

const partRef = z
  .string()
  .min(1)
  .max(160)
  .describe("Part id, name or part number, from list_parts");

const partRow = (p: Part) => ({
  id: p.id,
  name: p.name,
  partNumber: p.partNumber,
  supplier: p.supplier,
  stock: p.stockCount,
  minStock: p.minStock || null,
  lowStock: p.lowStock ? true : null,
  reorderQty: p.reorderQty,
  leadTimeDays: p.leadTimeDays,
  onOrder: p.orderedQty || null,
  orderedAt: p.orderedAt?.slice(0, 10),
  notes: p.notes,
  archived: p.archivedAt ? true : null,
});

const orderRow = (i: OrderNowItem) => ({
  part: i.partName,
  partId: i.partId,
  task: i.taskTitle,
  quantity: i.quantity,
  inStock: i.stockCount,
  neededBy: i.neededBy,
  orderBy: i.orderBy,
  late: i.late ? true : null,
  supplier: i.supplier,
  shopUrl: i.shopUrl,
});

export const listParts = defineTool({
  name: "list_parts",
  title: "List spare parts",
  description:
    "Spare parts and consumables (filter cartridges, seals, bulbs) with stock, minimum stock and what is on order. Filter by q (name, part number, supplier), asset (id or name) the part belongs to, or lowStock (below minimum). orderNow: true returns instead the shopping list: parts that must be ordered now for upcoming tasks, with order-by dates and shop links. Archived parts are hidden unless includeArchived.",
  mode: "read",
  input: {
    q: z.string().trim().min(1).max(100).optional(),
    asset: z.string().min(1).max(120).optional(),
    lowStock: z.boolean().optional(),
    orderNow: z.boolean().default(false),
    includeArchived: z.boolean().default(false),
    limit: z.number().int().min(1).max(100).default(30),
    cursor: z.string().min(1).max(512).optional(),
  },
  async handler(args, ctx) {
    if (args.orderNow) {
      const { items } = await ctx.api.call(endpoints.partsOrderNow);
      return {
        summary: `${plural(items.length, "part")} to order now.`,
        data: { orderNow: items.map(orderRow) },
      };
    }
    const asset = args.asset ? await ctx.resolveAsset(args.asset) : undefined;
    const page = await ctx.api.call(endpoints.partsList, {
      query: {
        q: args.q,
        assetId: asset?.id,
        lowStock:
          args.lowStock === undefined
            ? undefined
            : args.lowStock
              ? "true"
              : "false",
        includeArchived: args.includeArchived ? "true" : undefined,
        cursor: args.cursor,
        limit: args.limit,
      },
    });
    return {
      summary: `${plural(page.items.length, "part")}.${moreHint(page.nextCursor)}`,
      data: { parts: page.items.map(partRow), nextCursor: page.nextCursor },
    };
  },
});

export const adjustStock = defineTool({
  name: "adjust_stock",
  title: "Adjust the stock of a part",
  description:
    "Books a stock movement for a spare part and returns the new stock. delta is the change: negative when parts were used up, positive when bought (a purchase also ends a pending order). reason defaults to `used` for a negative and `bought` for a positive delta; use `correction` after counting. Stock never goes below zero. Completing a task that has the part linked already books its usage, do not book it twice.",
  mode: "create",
  input: {
    part: partRef,
    delta: z
      .number()
      .int()
      .min(-100_000)
      .max(100_000)
      .describe("Change in pieces: -2 = two used, +10 = ten bought"),
    reason: z.enum(PART_MOVEMENT_REASONS).optional(),
    note: z.string().trim().max(500).optional(),
  },
  async handler({ part: ref, delta, reason, note }, ctx) {
    if (delta === 0) {
      throw new ToolError("invalid_request", "delta must not be zero.");
    }
    const part = await resolvePart(ctx, ref);
    const updated = await ctx.api.call(endpoints.partsStock, {
      params: { id: part.id },
      body: { delta, reason: reason ?? (delta < 0 ? "used" : "bought"), note },
    });
    return {
      summary: `${updated.name}: stock ${part.stockCount} -> ${updated.stockCount}${updated.lowStock ? " (below minimum)" : ""}.`,
      data: partRow(updated),
    };
  },
});

export const partTools = [listParts, adjustStock];
