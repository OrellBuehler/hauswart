import { z } from "zod";
import { PART_MOVEMENT_REASONS } from "../enums";
import {
  atLeastOne,
  dateSchema,
  idSchema,
  isoTimestampSchema,
  nullableText,
  paginated,
  paginationQuerySchema,
  queryBooleanSchema,
} from "./common";
import { currencySchema } from "./household";
import { minorAmountSchema, nullableHttpUrl } from "./fields";

export const partMovementReasonSchema = z.enum(PART_MOVEMENT_REASONS);

export const MAX_STOCK = 100_000;
export const PART_MOVEMENTS_IN_DETAIL = 20;

export const partSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    partNumber: z.string().nullable(),
    supplier: z.string().nullable(),
    shopUrl: z.string().nullable(),
    unitPriceMinor: z.number().int().nullable(),
    currency: z.string(),
    stockCount: z.number().int(),
    minStock: z.number().int(),
    reorderQty: z.number().int(),
    leadTimeDays: z.number().int(),
    /** Set while an order is under way; cleared when stock is booked as bought. */
    orderedAt: isoTimestampSchema.nullable(),
    orderedQty: z.number().int(),
    /** Stock is below the minimum stock. */
    lowStock: z.boolean(),
    notes: z.string().nullable(),
    archivedAt: isoTimestampSchema.nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .meta({ id: "Part" });
export type Part = z.infer<typeof partSchema>;

export const partMovementSchema = z
  .object({
    id: z.string(),
    partId: z.string(),
    delta: z.number().int(),
    reason: partMovementReasonSchema,
    userId: z.string().nullable(),
    userName: z.string().nullable(),
    completionId: z.string().nullable(),
    note: z.string().nullable(),
    at: isoTimestampSchema,
  })
  .meta({ id: "PartMovement" });
export type PartMovement = z.infer<typeof partMovementSchema>;

export const partDetailSchema = partSchema
  .extend({
    assets: z.array(z.object({ id: z.string(), name: z.string() })),
    tasks: z.array(
      z.object({ id: z.string(), title: z.string(), qty: z.number().int() }),
    ),
    recentMovements: z.array(partMovementSchema),
  })
  .meta({ id: "PartDetail" });
export type PartDetail = z.infer<typeof partDetailSchema>;

export const listPartsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional(),
  assetId: idSchema.optional(),
  taskId: idSchema.optional(),
  lowStock: queryBooleanSchema.optional(),
  includeArchived: queryBooleanSchema.optional(),
});
export const listPartsResponseSchema = paginated(partSchema);

const partFields = {
  name: z.string().trim().min(1).max(160),
  partNumber: nullableText(120),
  supplier: nullableText(160),
  shopUrl: nullableHttpUrl(),
  unitPriceMinor: minorAmountSchema.nullable(),
  currency: currencySchema,
  stockCount: z.number().int().min(0).max(MAX_STOCK),
  minStock: z.number().int().min(0).max(MAX_STOCK),
  reorderQty: z.number().int().min(1).max(MAX_STOCK),
  leadTimeDays: z.number().int().min(0).max(3650),
  notes: nullableText(10_000),
};

/** `currency` defaults to the household's; stock starts at 0 unless given. */
export const createPartRequestSchema = z.strictObject({
  name: partFields.name,
  partNumber: partFields.partNumber.optional(),
  supplier: partFields.supplier.optional(),
  shopUrl: partFields.shopUrl.optional(),
  unitPriceMinor: partFields.unitPriceMinor.optional(),
  currency: partFields.currency.optional(),
  stockCount: partFields.stockCount.default(0),
  minStock: partFields.minStock.default(0),
  reorderQty: partFields.reorderQty.default(1),
  leadTimeDays: partFields.leadTimeDays.default(14),
  notes: partFields.notes.optional(),
});
export type CreatePartRequest = z.output<typeof createPartRequestSchema>;

/** Stock changes go through `POST /parts/{id}/stock`, so they leave a movement. */
export const updatePartRequestSchema = atLeastOne(
  z.strictObject({
    name: partFields.name.optional(),
    partNumber: partFields.partNumber.optional(),
    supplier: partFields.supplier.optional(),
    shopUrl: partFields.shopUrl.optional(),
    unitPriceMinor: partFields.unitPriceMinor.optional(),
    currency: partFields.currency.optional(),
    minStock: partFields.minStock.optional(),
    reorderQty: partFields.reorderQty.optional(),
    leadTimeDays: partFields.leadTimeDays.optional(),
    notes: partFields.notes.optional(),
    archived: z.boolean().optional(),
  }),
);
export type UpdatePartRequest = z.output<typeof updatePartRequestSchema>;

/** `used` removes stock, `bought` adds it, `correction` does either. */
export const stockMovementRequestSchema = z
  .strictObject({
    delta: z
      .number()
      .int()
      .min(-MAX_STOCK)
      .max(MAX_STOCK)
      .refine((v) => v !== 0, { error: "Must not be zero." }),
    reason: partMovementReasonSchema,
    note: nullableText(500).optional(),
  })
  .refine(
    (v) =>
      v.reason === "correction" ||
      (v.reason === "used" ? v.delta < 0 : v.delta > 0),
    {
      error: "Use a negative delta for `used` and a positive one for `bought`.",
      path: ["delta"],
    },
  );
export type StockMovementRequest = z.output<typeof stockMovementRequestSchema>;

export const listMovementsResponseSchema = paginated(partMovementSchema);

/** Marks an order as placed; 0 clears it. Defaults to the reorder quantity. */
export const markOrderedRequestSchema = z.strictObject({
  qty: z.number().int().min(0).max(MAX_STOCK).optional(),
});
export type MarkOrderedRequest = z.output<typeof markOrderedRequestSchema>;

export const partParamsSchema = z.object({ id: idSchema });
export const assetPartParamsSchema = z.object({
  id: idSchema,
  partId: idSchema,
});

export const assetPartSchema = z
  .object({
    assetId: z.string(),
    partId: z.string(),
    part: partSchema,
  })
  .meta({ id: "AssetPart" });
export type AssetPart = z.infer<typeof assetPartSchema>;
export const listAssetPartsResponseSchema = paginated(assetPartSchema);
export const linkAssetPartRequestSchema = z.strictObject({
  partId: idSchema,
});

export const taskPartSchema = z
  .object({
    taskId: z.string(),
    partId: z.string(),
    qty: z.number().int(),
    part: partSchema,
  })
  .meta({ id: "TaskPart" });
export type TaskPart = z.infer<typeof taskPartSchema>;
export const listTaskPartsResponseSchema = paginated(taskPartSchema);
export const linkTaskPartRequestSchema = z.strictObject({
  partId: idSchema,
  qty: z.number().int().min(1).max(999).default(1),
});
export const updateTaskPartRequestSchema = z.strictObject({
  qty: z.number().int().min(1).max(999),
});

/** A part that has to be ordered now for a task, with what the shopping list needs. */
export const orderNowItemSchema = z
  .object({
    /** `<taskId>:<partId>`. */
    id: z.string(),
    /** The part's name. */
    title: z.string(),
    /** The date to order by. */
    date: dateSchema,
    taskId: z.string(),
    taskTitle: z.string(),
    partId: z.string(),
    partName: z.string(),
    quantity: z.number().int(),
    neededBy: dateSchema,
    orderBy: dateSchema,
    /** Today is past `orderBy`: the part may arrive too late. */
    late: z.boolean(),
    stockCount: z.number().int(),
    supplier: z.string().nullable(),
    shopUrl: z.string().nullable(),
    unitPriceMinor: z.number().int().nullable(),
    currency: z.string(),
  })
  .meta({ id: "OrderNowItem" });
export type OrderNowItem = z.infer<typeof orderNowItemSchema>;
export const listOrderNowResponseSchema = z.object({
  items: z.array(orderNowItemSchema),
});
