import { z } from "zod";
import {
  ASSET_KINDS,
  FINANCE_SUGGESTION_KINDS,
  FINANCE_SUGGESTION_STATUSES,
} from "../enums";
import {
  dateSchema,
  idSchema,
  isoTimestampSchema,
  nullableText,
  paginated,
} from "./common";
import {
  COST_NOTES_MAX,
  COST_TITLE_MAX,
  costCategorySchema,
  costDeductibleSchema,
  costSharesInputSchema,
  costSourceSchema,
  costSplitModeSchema,
} from "./costs";

export const financeSuggestionKindSchema = z.enum(FINANCE_SUGGESTION_KINDS);
export const financeSuggestionStatusSchema = z.enum(
  FINANCE_SUGGESTION_STATUSES,
);

const common = {
  id: z.string(),
  status: z.enum(FINANCE_SUGGESTION_STATUSES),
  /** The cost entry, asset or task that accepting created. */
  acceptedEntityId: z.string().nullable(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
};

/** An expense (positive) or refund (negative) the finance provider saw and the person may book as a cost. */
export const costSuggestionPayloadSchema = z.object({
  source: costSourceSchema,
  date: dateSchema,
  amountMinor: z.number().int(),
  currency: z.string(),
  title: z.string(),
  payee: z.string().nullable(),
  category: costCategorySchema,
  /** Where the item lives in the finance app; only its owner ever sees this. */
  url: z.string().nullable(),
  /** The asset created from the same transaction, if the person accepted that first. */
  assetId: z.string().nullable(),
});

export const assetSuggestionPayloadSchema = z.object({
  name: z.string(),
  purchaseDate: dateSchema,
  priceMinor: z.number().int(),
  currency: z.string(),
  url: z.string().nullable(),
});

export const billTaskSuggestionPayloadSchema = z.object({
  title: z.string(),
  dueDate: dateSchema,
  amountMinor: z.number().int().nullable(),
  currency: z.string(),
  url: z.string().nullable(),
});

export const financeSuggestionSchema = z
  .discriminatedUnion("kind", [
    z.object({
      ...common,
      kind: z.literal("cost"),
      payload: costSuggestionPayloadSchema,
    }),
    z.object({
      ...common,
      kind: z.literal("asset"),
      payload: assetSuggestionPayloadSchema,
    }),
    z.object({
      ...common,
      kind: z.literal("bill_task"),
      payload: billTaskSuggestionPayloadSchema,
    }),
  ])
  .meta({ id: "FinanceSuggestion" });
export type FinanceSuggestion = z.infer<typeof financeSuggestionSchema>;

export const listFinanceSuggestionsQuerySchema = z.object({
  kind: financeSuggestionKindSchema.optional(),
  /** Defaults to `pending`. */
  status: financeSuggestionStatusSchema.default("pending"),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const listFinanceSuggestionsResponseSchema = paginated(
  financeSuggestionSchema,
);

/**
 * Overrides when accepting. Fields that belong to another kind are a 400.
 * A cost takes everything of a new cost entry except date, amount and
 * currency (they are the transaction's); an asset takes `name`, `assetKind`
 * and `roomId`.
 */
export const acceptFinanceSuggestionRequestSchema = z.strictObject({
  title: z.string().trim().min(1).max(COST_TITLE_MAX).optional(),
  category: costCategorySchema.optional(),
  notes: nullableText(COST_NOTES_MAX).optional(),
  assetId: idSchema.nullable().optional(),
  roomId: idSchema.nullable().optional(),
  defectId: idSchema.nullable().optional(),
  serviceLogId: idSchema.nullable().optional(),
  paidByUserId: idSchema.nullable().optional(),
  splitMode: costSplitModeSchema.optional(),
  shares: costSharesInputSchema.optional(),
  countsAsExpense: z.boolean().optional(),
  deductible: costDeductibleSchema.optional(),
  name: z.string().trim().min(1).max(120).optional(),
  assetKind: z.enum(ASSET_KINDS).optional(),
});
export type AcceptFinanceSuggestionRequest = z.output<
  typeof acceptFinanceSuggestionRequestSchema
>;

export const acceptFinanceSuggestionResponseSchema = z
  .object({
    suggestion: financeSuggestionSchema,
    entity: z.object({
      type: z.enum(["cost", "asset", "task"]),
      id: z.string(),
    }),
  })
  .meta({ id: "FinanceSuggestionAccepted" });

export const financeSyncResponseSchema = z
  .object({
    /** False when the provider could not be reached or refused the token; `error` says why. */
    ok: z.boolean(),
    error: z.object({ code: z.string(), message: z.string() }).nullable(),
    /** What the run changed, by name (`suggestions`, `autoAccepted`, `tasksCreated`, ...). */
    stats: z.record(z.string(), z.number().int()),
  })
  .meta({ id: "FinanceSync" });

/** A category of the connected finance app (picker for the category map). */
export const financeCategorySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    parentId: z.string().nullable(),
    kind: z.enum(["expense", "income"]),
  })
  .meta({ id: "FinanceCategory" });
export const listFinanceCategoriesResponseSchema = z.object({
  items: z.array(financeCategorySchema),
});

export const financeAccountSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    currency: z.string(),
    type: z.string(),
    archived: z.boolean(),
  })
  .meta({ id: "FinanceAccount" });
export const listFinanceAccountsResponseSchema = z.object({
  items: z.array(financeAccountSchema),
});
