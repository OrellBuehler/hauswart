import { z } from "zod";
import {
  COST_CATEGORIES,
  COST_DEDUCTIBLE,
  COST_SOURCES,
  COST_SPLIT_MODES,
} from "../enums";
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
import { costTagIdsInputSchema, costTagRefSchema } from "./cost-tags";
import { currencySchema } from "./household";

export const costCategorySchema = z.enum(COST_CATEGORIES);
export const costSplitModeSchema = z.enum(COST_SPLIT_MODES);
export const costDeductibleSchema = z.enum(COST_DEDUCTIBLE);
export const costSourceSchema = z.enum(COST_SOURCES);

export const COST_TITLE_MAX = 200;
export const COST_NOTES_MAX = 4000;
export const MAX_COST_MINOR = 1_000_000_000_00;
export const SHARE_BPS_TOTAL = 10_000;

/** An expense is positive, a refund negative; zero is not a booking. */
export const costAmountSchema = z
  .number()
  .int()
  .min(-MAX_COST_MINOR)
  .max(MAX_COST_MINOR)
  .refine((v) => v !== 0, { error: "The amount must not be zero." });

export const costShareInputSchema = z.strictObject({
  userId: idSchema,
  shareBps: z.number().int().min(1).max(SHARE_BPS_TOTAL),
});
export const costSharesInputSchema = z
  .array(costShareInputSchema)
  .min(1)
  .max(20);
/** The people an equal split is narrowed to; each is a household member and listed once. */
export const costParticipantsInputSchema = z.array(idSchema).min(1).max(20);

export const costShareSchema = z
  .object({
    userId: z.string(),
    userName: z.string().nullable(),
    shareBps: z.number().int(),
    /** The person's part of the amount in minor units; the parts add up to the amount exactly. */
    amountMinor: z.number().int(),
  })
  .meta({ id: "CostShare" });

export const costEntrySchema = z
  .object({
    id: z.string(),
    /** The book (ledger) the entry belongs to; `GET /cost-books`. */
    bookId: z.string(),
    bookName: z.string(),
    /** Whether the book is tax relevant, i.e. whether `deductible` means anything for this entry. */
    bookTaxRelevant: z.boolean(),
    date: dateSchema,
    title: z.string(),
    /** Positive = expense, negative = refund. Minor units of `currency`. */
    amountMinor: z.number().int(),
    currency: z.string(),
    category: costCategorySchema,
    assetId: z.string().nullable(),
    assetName: z.string().nullable(),
    roomId: z.string().nullable(),
    roomName: z.string().nullable(),
    defectId: z.string().nullable(),
    defectNumber: z.number().int().nullable(),
    defectTitle: z.string().nullable(),
    serviceLogId: z.string().nullable(),
    serviceLogTitle: z.string().nullable(),
    payee: z.string().nullable(),
    notes: z.string().nullable(),
    paidByUserId: z.string().nullable(),
    paidByName: z.string().nullable(),
    splitMode: costSplitModeSchema,
    /**
     * Who bears which part; empty for `none`. Frozen when the split was set. For an `equal` split these are exactly
     * the participants.
     */
    shares: z.array(costShareSchema),
    /** The tags of the entry (`GET /cost-tags`), by name. */
    tags: z.array(costTagRefSchema),
    /** False for what builds equity (mortgage repayment); such entries stay out of the expense totals. */
    countsAsExpense: z.boolean(),
    /** The tax class; `unknown` and without meaning unless the book is tax relevant. */
    deductible: costDeductibleSchema,
    source: costSourceSchema,
    /** The entry in the person's finance app; shown only to the person who booked it from there. */
    providerUrl: z.string().nullable(),
    /**
     * The fuel log entry (`GET /fuel-logs/{id}`) that booked this entry, else null. That entry owns the amount, currency,
     * date and device and the entry's deletion: asking for other values, or to delete it, is a 409 `conflict` with
     * `details.fuelLogId`. Everything else stays editable here.
     */
    fuelLogId: z.string().nullable(),
    /**
     * True while a person still has to look at the entry: the receipt queue sets it on what an assistant booked from a
     * receipt, `POST /costs/{id}/review` clears it. Nothing else depends on it (the entry counts in every total).
     */
    reviewNeeded: z.boolean(),
    /** When and by whom the entry was last reviewed; null if it never was (or was flagged again since). */
    reviewedAt: isoTimestampSchema.nullable(),
    reviewedByUserId: z.string().nullable(),
    /**
     * The receipt task (`GET /ai-tasks/{id}`) the entry was booked for, when the booking named it (`receiptTaskId`);
     * null for every other entry and once the task is deleted.
     */
    receiptTaskId: z.string().nullable(),
    /**
     * The recurring cost (`GET /cost-recurrences/{id}`) that booked the entry (`source` is then `recurring`); null for
     * every other entry and once the recurring cost is deleted.
     */
    recurrenceId: z.string().nullable(),
    commentCount: z.number().int(),
    createdBy: z.string().nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .meta({ id: "CostEntry" });
export type CostEntry = z.infer<typeof costEntrySchema>;

const year = z.coerce.number().int().min(1990).max(2200);

export const listCostsQuerySchema = paginationQuerySchema.extend({
  /** Only the entries of this book. */
  bookId: idSchema.optional(),
  year: year.optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  category: costCategorySchema.optional(),
  assetId: idSchema.optional(),
  roomId: idSchema.optional(),
  defectId: idSchema.optional(),
  /** A user id, or `me`. */
  paidBy: idSchema.optional(),
  /** Only the entries that carry this tag (`GET /cost-tags`); a tag that does not exist is a 404. */
  tagId: idSchema.optional(),
  /** `true`: only the entries a person still has to review; `false`: only the others. */
  reviewNeeded: queryBooleanSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export type ListCostsQuery = z.output<typeof listCostsQuerySchema>;
export const listCostsResponseSchema = paginated(costEntrySchema);

export const costFields = {
  bookId: idSchema,
  date: dateSchema,
  title: z.string().trim().min(1).max(COST_TITLE_MAX),
  amountMinor: costAmountSchema,
  currency: currencySchema,
  category: costCategorySchema,
  assetId: idSchema.nullable(),
  roomId: idSchema.nullable(),
  defectId: idSchema.nullable(),
  serviceLogId: idSchema.nullable(),
  payee: nullableText(200),
  notes: nullableText(COST_NOTES_MAX),
  paidByUserId: idSchema.nullable(),
  splitMode: costSplitModeSchema,
  shares: costSharesInputSchema,
  participantIds: costParticipantsInputSchema,
  countsAsExpense: z.boolean(),
  deductible: costDeductibleSchema,
  tagIds: costTagIdsInputSchema,
};

/**
 * `bookId` defaults to the default book (`isDefault` of `GET /cost-books`), `date` to today, `currency` to the
 * household's, `splitMode` to the book's default split, `countsAsExpense` to true (false for a mortgage repayment).
 * `shares` are required for `custom` and refused otherwise; `participantIds` narrow an `equal` split to those people
 * (everybody without it) and are refused for any other split. `deductible` other than `unknown` needs a tax relevant book.
 * `receiptTaskId` names the receipt task (`/ai-tasks`) the entry is booked for: the entry is flagged `reviewNeeded` at
 * once and recorded on the task (`bookedSoFar`) in the same transaction; an unknown task is a 400 on the field, a task that
 * is not waiting any more a 409.
 * `tagIds` are the tags (`GET /cost-tags`) the entry carries, each once (400 on `tagIds` for one that does not exist).
 * `idempotencyKey` (8 to 128 characters, chosen by the caller, unique per person who books) makes a retried request return
 * the first entry with status 200 instead of booking a second one; the same key for a different entry (amount, currency,
 * category, title, and book, date or payer when the retry names them) is a 409.
 */
export const createCostRequestSchema = z.strictObject({
  bookId: costFields.bookId.optional(),
  date: costFields.date.optional(),
  title: costFields.title,
  amountMinor: costFields.amountMinor,
  currency: costFields.currency.optional(),
  category: costFields.category,
  assetId: costFields.assetId.optional(),
  roomId: costFields.roomId.optional(),
  defectId: costFields.defectId.optional(),
  serviceLogId: costFields.serviceLogId.optional(),
  payee: costFields.payee.optional(),
  notes: costFields.notes.optional(),
  paidByUserId: costFields.paidByUserId.optional(),
  splitMode: costFields.splitMode.optional(),
  shares: costFields.shares.optional(),
  participantIds: costFields.participantIds.optional(),
  countsAsExpense: costFields.countsAsExpense.optional(),
  deductible: costFields.deductible.default("unknown"),
  tagIds: costFields.tagIds.optional(),
  receiptTaskId: idSchema.optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});
export type CreateCostRequest = z.output<typeof createCostRequestSchema>;

/**
 * Setting `splitMode` to `ownership` or `equal` splits again by the people's
 * current shares; sending `shares` needs `custom`, `participantIds` an `equal` split (the entry's, or the one set in
 * the same request) and split again among those people. Changing only the amount keeps the frozen shares.
 * `bookId` moves the entry to another book that is not archived. `tagIds` replaces the entry's tags (an empty list removes them all).
 */
export const updateCostRequestSchema = atLeastOne(
  z.strictObject({
    bookId: costFields.bookId.optional(),
    date: costFields.date.optional(),
    title: costFields.title.optional(),
    amountMinor: costFields.amountMinor.optional(),
    currency: costFields.currency.optional(),
    category: costFields.category.optional(),
    assetId: costFields.assetId.optional(),
    roomId: costFields.roomId.optional(),
    defectId: costFields.defectId.optional(),
    serviceLogId: costFields.serviceLogId.optional(),
    payee: costFields.payee.optional(),
    notes: costFields.notes.optional(),
    paidByUserId: costFields.paidByUserId.optional(),
    splitMode: costFields.splitMode.optional(),
    shares: costFields.shares.optional(),
    participantIds: costFields.participantIds.optional(),
    countsAsExpense: costFields.countsAsExpense.optional(),
    deductible: costFields.deductible.optional(),
    tagIds: costFields.tagIds.optional(),
  }),
);
export type UpdateCostRequest = z.output<typeof updateCostRequestSchema>;

/** The most entries one request moves. */
export const MOVE_COSTS_MAX_IDS = 500;

/**
 * Moves cost entries into the book `bookId`: either the entries in `ids` (1 to 500, each once) or every entry of the
 * device `assetId`; exactly one of the two.
 */
export const moveCostsToBookRequestSchema = z
  .strictObject({
    bookId: idSchema,
    ids: z.array(idSchema).min(1).max(MOVE_COSTS_MAX_IDS).optional(),
    assetId: idSchema.optional(),
    /** Only work out what the move would do (the same checks, the same numbers) and write nothing. */
    dryRun: z.boolean().optional(),
  })
  .refine((v) => (v.ids === undefined) !== (v.assetId === undefined), {
    error: "Give either ids or assetId.",
    path: ["ids"],
  });
export type MoveCostsToBookRequest = z.output<
  typeof moveCostsToBookRequestSchema
>;

export const moveCostsToBookResultSchema = z
  .object({
    bookId: z.string(),
    /** Entries that were in another book and are in `bookId` now. */
    moved: z.number().int(),
    /** Entries that were in `bookId` already. */
    unchanged: z.number().int(),
    /** Moved entries whose tax class was reset to `unknown` because the book is not tax relevant. */
    deductibleReset: z.number().int(),
    /** True for a preview (`dryRun`): nothing was written, and `moved` and `deductibleReset` are what a move would do. */
    dryRun: z.boolean(),
    /** The first and the last year of the dates of the entries that move (or would); null when none does. */
    years: z
      .object({ from: z.number().int(), to: z.number().int() })
      .nullable(),
  })
  .meta({ id: "MoveCostsToBookResult" });
export type MoveCostsToBookResult = z.infer<typeof moveCostsToBookResultSchema>;

export const costsSummaryQuerySchema = z.object({
  year: year.optional(),
  /** Only the cost entries of this asset: totals, months, categories and settlement are then those of the asset. */
  assetId: idSchema.optional(),
  /** Only the cost entries of this book: everything in the summary, the settlement included, is then that book's alone. */
  bookId: idSchema.optional(),
  /** Only the cost entries that carry this tag: everything in the summary is then theirs alone; a tag that does not exist is a 404. */
  tagId: idSchema.optional(),
});
export type CostsSummaryQuery = z.output<typeof costsSummaryQuerySchema>;

const totalByCategory = z.object({
  category: costCategorySchema,
  totalMinor: z.number().int(),
  count: z.number().int(),
});

export const costsSummarySchema = z
  .object({
    year: z.number().int(),
    /** The household currency: every total counts entries in this currency only. */
    currency: z.string(),
    /** Entries in another currency, left out of every total (they are in the CSV). */
    otherCurrencyCount: z.number().int(),
    /** What the year cost: entries that count as an expense, refunds netted off. */
    expenseTotalMinor: z.number().int(),
    /** Entries that build equity (mortgage repayment) and are not an expense. */
    equityTotalMinor: z.number().int(),
    /** Expenses per category, largest first; categories without entries are left out. */
    byCategory: z.array(totalByCategory),
    /** Expenses per month, always twelve entries (`YYYY-MM`). */
    byMonth: z.array(
      z.object({
        month: z.string(),
        totalMinor: z.number().int(),
        count: z.number().int(),
      }),
    ),
    /** The assets with the highest expenses, at most ten. */
    byAsset: z.array(
      z.object({
        assetId: z.string(),
        assetName: z.string(),
        totalMinor: z.number().int(),
        count: z.number().int(),
      }),
    ),
    /** Expenses per tax class (`unknown` until someone decides); entries of books that are not tax relevant are left out. */
    byDeductible: z.array(
      z.object({
        deductible: costDeductibleSchema,
        totalMinor: z.number().int(),
        count: z.number().int(),
      }),
    ),
    /**
     * Who paid what and who bears what, over every split entry with a payer
     * (equity entries included: it is about cash, not about expenses).
     * `balanceMinor` = paid - share: positive means the others owe this person.
     */
    people: z.array(
      z.object({
        userId: z.string(),
        userName: z.string().nullable(),
        paidMinor: z.number().int(),
        shareMinor: z.number().int(),
        balanceMinor: z.number().int(),
      }),
    ),
    /** The payments that settle the balances, fewest first ("A owes B CHF x"). */
    settlement: z.array(
      z.object({
        fromUserId: z.string(),
        fromName: z.string().nullable(),
        toUserId: z.string(),
        toName: z.string().nullable(),
        amountMinor: z.number().int(),
      }),
    ),
    /** Split entries without a payer: they cannot be settled until someone is named. */
    unassignedPayerCount: z.number().int(),
    /**
     * Entries of the summary's scope (the year, and the asset or book if one was asked for) a person still has to review,
     * in any currency and whether or not they count as an expense.
     */
    reviewNeededCount: z.number().int(),
  })
  .meta({ id: "CostsSummary" });
export type CostsSummary = z.infer<typeof costsSummarySchema>;

/**
 * What the year has cost so far, across all books together (the dashboard's slice). Household currency, entries that
 * count as an expense, refunds netted off: the same numbers `GET /costs/summary` adds up. Who owes whom is not part of
 * it (a year of entries knows nothing of recorded payments): that is `Dashboard.balances`.
 */
export const dashboardCostsSchema = z
  .object({
    year: z.number().int(),
    currency: z.string(),
    /** All books together; the sum of `byBook`. */
    totalMinor: z.number().int(),
    /** The three largest expense categories, all books together. */
    byCategory: z.array(totalByCategory),
    /**
     * The same expenses per book, largest first: only books with an expense this year, archived ones included.
     * `taxRelevant` tells the apartment's books from the everyday ones, whose sum a person may not want to read as
     * "the cost of the apartment".
     */
    byBook: z.array(
      z.object({
        bookId: z.string(),
        bookName: z.string(),
        taxRelevant: z.boolean(),
        archived: z.boolean(),
        totalMinor: z.number().int(),
        count: z.number().int(),
      }),
    ),
  })
  .meta({ id: "DashboardCosts" });

/** How many of the newest entries of each book `GET /costs/recent-categories` looks at. */
export const RECENT_CATEGORY_ENTRIES = 100;

export const recentCategoriesQuerySchema = z.object({
  /** Only this book; without it every book is answered, each on its own. */
  bookId: idSchema.optional(),
});
export type RecentCategoriesQuery = z.output<
  typeof recentCategoriesQuerySchema
>;

export const recentCategoriesSchema = z
  .object({
    /** How many of the newest entries of each book were counted (`RECENT_CATEGORY_ENTRIES`). */
    entriesPerBook: z.number().int(),
    /**
     * How often each category was used by those entries: per book in the order of the books, most used first (then by
     * name). A category a book did not use lately is not listed; a book without entries has no rows.
     */
    items: z.array(
      z.object({
        bookId: z.string(),
        category: costCategorySchema,
        count: z.number().int(),
      }),
    ),
  })
  .meta({ id: "RecentCategories" });

export const exportCostsQuerySchema = z.object({
  year: year.optional(),
  /** Only the entries of this book. */
  bookId: idSchema.optional(),
  /** Only the entries that carry this tag. */
  tagId: idSchema.optional(),
});
export type ExportCostsQuery = z.output<typeof exportCostsQuerySchema>;

/**
 * One book (`bookId`) or all of them together (`all=true`, also what no parameter at all means). Naming a book and
 * `all=true` together, or `all=false` without a book, contradict each other and are a 400.
 */
export const costBalancesQuerySchema = z.object({
  bookId: idSchema.optional(),
  all: queryBooleanSchema.optional(),
});
export type CostBalancesQuery = z.output<typeof costBalancesQuerySchema>;

export const costBalancesSchema = z
  .object({
    /** The book the numbers are for; null = all books together. */
    book: z.object({ id: z.string(), name: z.string() }).nullable(),
    /** The household currency: only entries and payments in this currency are counted. */
    currency: z.string(),
    /** Entries and payments in another currency, left out of every number. */
    otherCurrencyCount: z.number().int(),
    /** Split entries without a payer: they cannot be settled until someone is named. */
    unassignedPayerCount: z.number().int(),
    /**
     * Everybody, all time: `balanceMinor` = `paidMinor` - `shareMinor` + `sentMinor` - `receivedMinor`; positive means
     * the others owe this person. `sentMinor` and `receivedMinor` are recorded payments (settlements).
     */
    people: z.array(
      z.object({
        userId: z.string(),
        userName: z.string().nullable(),
        paidMinor: z.number().int(),
        shareMinor: z.number().int(),
        sentMinor: z.number().int(),
        receivedMinor: z.number().int(),
        balanceMinor: z.number().int(),
      }),
    ),
    /**
     * Only in the view of a single book: the recorded payments across all books, which that view leaves out because
     * they cannot be attributed to one book (household currency; `count` of them, `totalMinor` their amounts added up,
     * not their effect on anybody's balance). The view of all books includes them: null there.
     */
    crossBookSettlements: z
      .object({ count: z.number().int(), totalMinor: z.number().int() })
      .nullable(),
    /** The fewest payments that would square the balances ("A owes B CHF x"); empty when everybody is square. */
    suggestedPayments: z.array(
      z.object({
        fromUserId: z.string(),
        fromName: z.string().nullable(),
        toUserId: z.string(),
        toName: z.string().nullable(),
        amountMinor: z.number().int(),
      }),
    ),
  })
  .meta({ id: "CostBalances" });
export type CostBalances = z.infer<typeof costBalancesSchema>;

/** Where the caller stands across all books, for the dashboard: one pass over the same ledger as `GET /costs/balances`. */
export const dashboardBalancesSchema = z
  .object({
    /** The household currency: only entries and payments in it are counted. */
    currency: z.string(),
    /** The caller's balance, recorded payments included: positive means the others owe the caller. */
    myBalanceMinor: z.number().int(),
    /** Whether anything was ever paid, shared or settled: false reads "nothing to square yet", not "all square". */
    hasActivity: z.boolean(),
    /** The first (largest) three of the fewest payments that would square everybody, between any two people. */
    suggestedPayments: costBalancesSchema.shape.suggestedPayments,
    /** How many payments there are in all, so the card can say "and 2 more". */
    suggestedPaymentCount: z.number().int(),
  })
  .meta({ id: "DashboardBalances" });
export type DashboardBalances = z.infer<typeof dashboardBalancesSchema>;
export type DashboardCosts = z.infer<typeof dashboardCostsSchema>;

/** Cost entries booked against a defect or service log entry. */
export const costsOfSchema = z
  .object({
    /** Sum of the entries in the household currency; refunds net off. */
    totalMinor: z.number().int(),
    count: z.number().int(),
  })
  .meta({ id: "CostsOf" });
