import { z } from "zod";
import { COST_BOOK_SPLIT_MODES } from "../enums";
import {
  atLeastOne,
  isoTimestampSchema,
  nullableText,
  paginated,
  paginationQuerySchema,
  queryBooleanSchema,
  slugSchema,
} from "./common";

export const COST_BOOK_NAME_MAX = 60;

/** How a book splits an entry that does not say: by ownership, equally among everybody, or not at all. */
export const costBookSplitModeSchema = z.enum(COST_BOOK_SPLIT_MODES);

export const costBookSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    /** A key the client maps to an icon (a Lucide name such as `house`); null for none. */
    icon: z.string().nullable(),
    /** The split an entry gets when the request names none. */
    defaultSplitMode: costBookSplitModeSchema,
    /** Whether the tax class (`deductible`) of its entries means anything: the apartment's books, not the groceries. */
    taxRelevant: z.boolean(),
    /** Set while the book is archived: closed to new entries, still counted in the balances. */
    archivedAt: isoTimestampSchema.nullable(),
    sortOrder: z.number().int(),
    /** Where an entry or a settlement without `bookId` goes: the first book that is not archived. */
    isDefault: z.boolean(),
    entryCount: z.number().int(),
    settlementCount: z.number().int(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .meta({ id: "CostBook" });
export type CostBook = z.infer<typeof costBookSchema>;

export const listCostBooksQuerySchema = paginationQuerySchema.extend({
  /** Archived books are left out unless this is true. */
  includeArchived: queryBooleanSchema.optional(),
});
export type ListCostBooksQuery = z.output<typeof listCostBooksQuerySchema>;
export const listCostBooksResponseSchema = paginated(costBookSchema);

const bookFields = {
  name: z.string().trim().min(1).max(COST_BOOK_NAME_MAX),
  slug: slugSchema,
  icon: nullableText(64),
  defaultSplitMode: costBookSplitModeSchema,
  taxRelevant: z.boolean(),
  sortOrder: z.number().int().min(0).max(100_000),
};

/**
 * `slug` is derived from the name when omitted, `defaultSplitMode` is `ownership`, `taxRelevant` false and the book
 * goes to the end of the list.
 */
export const createCostBookRequestSchema = z.strictObject({
  name: bookFields.name,
  slug: bookFields.slug.optional(),
  icon: bookFields.icon.optional(),
  defaultSplitMode: bookFields.defaultSplitMode.optional(),
  taxRelevant: bookFields.taxRelevant.optional(),
  sortOrder: bookFields.sortOrder.optional(),
});
export type CreateCostBookRequest = z.output<
  typeof createCostBookRequestSchema
>;

/** `archived` archives or restores. */
export const updateCostBookRequestSchema = atLeastOne(
  z.strictObject({
    name: bookFields.name.optional(),
    slug: bookFields.slug.optional(),
    icon: bookFields.icon.optional(),
    defaultSplitMode: bookFields.defaultSplitMode.optional(),
    taxRelevant: bookFields.taxRelevant.optional(),
    sortOrder: bookFields.sortOrder.optional(),
    archived: z.boolean().optional(),
  }),
);
export type UpdateCostBookRequest = z.output<
  typeof updateCostBookRequestSchema
>;
