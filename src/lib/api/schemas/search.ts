import { z } from "zod";

export const SEARCH_HIT_TYPES = ["page", "asset", "room", "task"] as const;
export const searchHitTypeSchema = z.enum(SEARCH_HIT_TYPES);

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  /** Restrict to one kind of result. */
  type: searchHitTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const searchHitSchema = z
  .object({
    type: searchHitTypeSchema,
    id: z.string(),
    title: z.string(),
    /** Plain text, not HTML-safe: escape it when displaying. Never contains secret text. */
    snippet: z.string(),
    /** App path of the hit (`/docs/<slug>`, `/inventory/<id>`, `/plants/<id>`, `/rooms/<id>`, `/tasks/<id>`). */
    url: z.string(),
  })
  .meta({ id: "SearchHit" });

export const searchResponseSchema = z.object({
  items: z.array(searchHitSchema),
});
