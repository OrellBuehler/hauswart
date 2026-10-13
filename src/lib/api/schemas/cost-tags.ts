import { z } from "zod";
import { COST_TAG_COLORS } from "../enums";
import { atLeastOne, idSchema, isoTimestampSchema } from "./common";

export const COST_TAG_NAME_MAX = 40;
/** How many tags the household can have; the list is not paged. */
export const MAX_COST_TAGS = 200;
/** How many tags one cost entry (or recurring cost) can carry. */
export const MAX_TAGS_PER_COST = 10;

export const costTagColorSchema = z.enum(COST_TAG_COLORS);

const tagName = z.string().trim().min(1).max(COST_TAG_NAME_MAX);

/** A tag as an entry carries it. */
export const costTagRefSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    /** A key the client maps to a colour. */
    color: costTagColorSchema,
  })
  .meta({ id: "CostTagRef" });
export type CostTagRef = z.infer<typeof costTagRefSchema>;

export const costTagSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    color: costTagColorSchema,
    /** How many cost entries carry the tag. */
    entryCount: z.number().int(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .meta({ id: "CostTag" });
export type CostTag = z.infer<typeof costTagSchema>;

export const listCostTagsResponseSchema = z.object({
  items: z.array(costTagSchema),
});

/** The tags an entry or a recurring cost is to carry, each once; unknown ids are a 400 on `tagIds`. */
export const costTagIdsInputSchema = z.array(idSchema).max(MAX_TAGS_PER_COST);

/** `color` defaults to `gray`. */
export const createCostTagRequestSchema = z.strictObject({
  name: tagName,
  color: costTagColorSchema.optional(),
});
export type CreateCostTagRequest = z.output<typeof createCostTagRequestSchema>;

export const updateCostTagRequestSchema = atLeastOne(
  z.strictObject({
    name: tagName.optional(),
    color: costTagColorSchema.optional(),
  }),
);
export type UpdateCostTagRequest = z.output<typeof updateCostTagRequestSchema>;
