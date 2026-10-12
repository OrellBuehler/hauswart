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
import { costTagIdsInputSchema } from "./cost-tags";
import { currencySchema } from "./household";
import {
  COST_NOTES_MAX,
  COST_TITLE_MAX,
  costCategorySchema,
  costDeductibleSchema,
  costParticipantsInputSchema,
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
  source: costSourceSchema.exclude(["manual", "recurring"]),
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
  /**
   * The cost book the person's settings for the connection offer for this item (`GET /cost-books`), preselected in
   * the accept dialog and used when the body names none; null = the default book. Null as well when that book has
   * been archived or deleted since.
   */
  bookId: z.string().nullable().default(null),
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

/**
 * A transaction that looks like a cost entry somebody booked by hand: the entry's id and the transaction as it would be
 * offered as a cost. This is what is stored; the API adds the entry as it is now (`linkSuggestionPayloadSchema`).
 */
export const storedLinkPayloadSchema = z.object({
  entryId: z.string(),
  transaction: costSuggestionPayloadSchema,
});

/** The cost entry a link suggestion would tie the transaction to, as it is now. */
export const linkedEntrySchema = z
  .object({
    id: z.string(),
    title: z.string(),
    date: dateSchema,
    amountMinor: z.number().int(),
    currency: z.string(),
    payee: z.string().nullable(),
    bookId: z.string(),
    bookName: z.string(),
  })
  .meta({ id: "FinanceLinkedEntry" });

export const linkSuggestionPayloadSchema = z.object({
  entryId: z.string(),
  /** The entry as it is now; null when it was deleted since (dismiss the suggestion to get the transaction back as a cost). */
  entry: linkedEntrySchema.nullable(),
  transaction: costSuggestionPayloadSchema,
});

const costFinanceSuggestionSchema = z.object({
  ...common,
  kind: z.literal("cost"),
  payload: costSuggestionPayloadSchema,
});

export const financeSuggestionSchema = z
  .discriminatedUnion("kind", [
    costFinanceSuggestionSchema,
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
    z.object({
      ...common,
      kind: z.literal("link"),
      payload: linkSuggestionPayloadSchema,
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
 * currency (they are the transaction's), `bookId` included: without one it goes
 * to the book offered with the suggestion (`payload.bookId`) while that is open, else to the default book, and
 * splits as that book says, and `tagIds` label the entry; an asset takes `name`, `assetKind` and `roomId`. A link
 * suggestion takes no override at all (send `{}`).
 */
export const acceptFinanceSuggestionRequestSchema = z.strictObject({
  title: z.string().trim().min(1).max(COST_TITLE_MAX).optional(),
  bookId: idSchema.optional(),
  category: costCategorySchema.optional(),
  notes: nullableText(COST_NOTES_MAX).optional(),
  assetId: idSchema.nullable().optional(),
  roomId: idSchema.nullable().optional(),
  defectId: idSchema.nullable().optional(),
  serviceLogId: idSchema.nullable().optional(),
  paidByUserId: idSchema.nullable().optional(),
  splitMode: costSplitModeSchema.optional(),
  shares: costSharesInputSchema.optional(),
  participantIds: costParticipantsInputSchema.optional(),
  countsAsExpense: z.boolean().optional(),
  deductible: costDeductibleSchema.optional(),
  /** A cost only: the tags of the entry (see `POST /costs`). */
  tagIds: costTagIdsInputSchema.optional(),
  /** A cost only: the receipt task the entry is booked for (see `POST /costs`), 400 for an asset or a bill task. */
  receiptTaskId: idSchema.optional(),
  name: z.string().trim().min(1).max(120).optional(),
  assetKind: z.enum(ASSET_KINDS).optional(),
});
export type AcceptFinanceSuggestionRequest = z.output<
  typeof acceptFinanceSuggestionRequestSchema
>;

/**
 * The entry being typed in the cost form: its amount (signed, as in `POST /costs`), currency (default: the household's) and
 * date. Answers the caller's pending cost suggestions with the same amount and currency booked at most 3 days from the date.
 */
export const financeMatchesQuerySchema = z.object({
  amountMinor: z.coerce
    .number()
    .int()
    .refine((v) => v !== 0, { error: "The amount must not be zero." }),
  currency: currencySchema.optional(),
  date: dateSchema,
});
export type FinanceMatchesQuery = z.output<typeof financeMatchesQuerySchema>;

export const financeMatchesResponseSchema = z.object({
  items: z.array(costFinanceSuggestionSchema),
});

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
