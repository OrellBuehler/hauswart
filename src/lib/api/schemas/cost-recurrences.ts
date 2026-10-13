import { z } from "zod";
import { COST_RECURRENCE_ERRORS, COST_RECURRENCE_FREQUENCIES } from "../enums";
import {
  atLeastOne,
  dateSchema,
  idSchema,
  isoTimestampSchema,
  queryBooleanSchema,
} from "./common";
import { costTagRefSchema } from "./cost-tags";
import {
  costCategorySchema,
  costDeductibleSchema,
  costEntrySchema,
  costFields,
  costShareInputSchema,
  costSplitModeSchema,
} from "./costs";

export const costRecurrenceFrequencySchema = z.enum(
  COST_RECURRENCE_FREQUENCIES,
);
export const costRecurrenceErrorSchema = z.enum(COST_RECURRENCE_ERRORS);

/** How many recurring costs the household can have; the list is not paged. */
export const MAX_COST_RECURRENCES = 200;

const interval = z.number().int().min(1).max(12);
const dayOfMonth = z.number().int().min(1).max(31);

export const costRecurrenceSchema = z
  .object({
    id: z.string(),
    bookId: z.string(),
    bookName: z.string(),
    title: z.string(),
    /** Positive = expense, negative = refund. Minor units of `currency`. */
    amountMinor: z.number().int(),
    currency: z.string(),
    category: costCategorySchema,
    assetId: z.string().nullable(),
    assetName: z.string().nullable(),
    roomId: z.string().nullable(),
    roomName: z.string().nullable(),
    payee: z.string().nullable(),
    notes: z.string().nullable(),
    paidByUserId: z.string().nullable(),
    paidByName: z.string().nullable(),
    splitMode: costSplitModeSchema,
    /** The shares of a `custom` split, else null. Every booked entry freezes the split on the day it is booked. */
    shares: z.array(costShareInputSchema).nullable(),
    /** The people an `equal` split is narrowed to, else null (everybody at the time of booking). */
    participantIds: z.array(z.string()).nullable(),
    tags: z.array(costTagRefSchema),
    countsAsExpense: z.boolean(),
    deductible: costDeductibleSchema,
    frequency: costRecurrenceFrequencySchema,
    /** Every n-th month (`monthly`), quarter or year. */
    interval: z.number().int(),
    /** The day of the month an occurrence falls on; on a shorter month it is the last day. */
    dayOfMonth: z.number().int(),
    startDate: dateSchema,
    endDate: dateSchema.nullable(),
    /** The next occurrence to book; null once the series is over. An occurrence on or before today is booked by the next run. */
    nextDate: dateSchema.nullable(),
    /** The newest occurrence that was booked. */
    lastOccurrenceDate: dateSchema.nullable(),
    /** A paused recurring cost books nothing; resuming skips what fell due meanwhile. */
    active: z.boolean(),
    /** Why the last attempt to book failed (`book_archived`: the book is closed to new entries); null while it works. */
    lastError: costRecurrenceErrorSchema.nullable(),
    createdBy: z.string().nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .meta({ id: "CostRecurrence" });
export type CostRecurrence = z.infer<typeof costRecurrenceSchema>;

export const listCostRecurrencesQuerySchema = z.object({
  /** `true`: only the ones that book; `false`: only the paused and finished ones. */
  active: queryBooleanSchema.optional(),
  bookId: idSchema.optional(),
});
export type ListCostRecurrencesQuery = z.output<
  typeof listCostRecurrencesQuerySchema
>;

export const listCostRecurrencesResponseSchema = z.object({
  items: z.array(costRecurrenceSchema),
});

const endsAfterStart = (v: { startDate?: string; endDate?: string | null }) =>
  !v.startDate || !v.endDate || v.endDate >= v.startDate;

/**
 * The template of the entries that are booked: the fields of `POST /costs` (`bookId` defaults to the default book,
 * `currency` to the household's, `splitMode` to the book's split; `shares`, `participantIds`, `tagIds` and `deductible` as
 * there, checked now and again when an entry is booked) without a date. The rule: an occurrence every `interval` months
 * (`monthly`), quarters or years, counted from the month of `startDate`, on `dayOfMonth` (default: the day of
 * `startDate`; 31 means the last day of a shorter month). The first occurrence is the first one on or after `startDate`;
 * `endDate` (included) closes the series (400 on `endDate` when it is before the start or leaves no occurrence).
 */
export const createCostRecurrenceRequestSchema = z
  .strictObject({
    bookId: costFields.bookId.optional(),
    title: costFields.title,
    amountMinor: costFields.amountMinor,
    currency: costFields.currency.optional(),
    category: costFields.category,
    assetId: costFields.assetId.optional(),
    roomId: costFields.roomId.optional(),
    payee: costFields.payee.optional(),
    notes: costFields.notes.optional(),
    paidByUserId: costFields.paidByUserId.optional(),
    splitMode: costFields.splitMode.optional(),
    shares: costFields.shares.optional(),
    participantIds: costFields.participantIds.optional(),
    tagIds: costFields.tagIds.optional(),
    countsAsExpense: costFields.countsAsExpense.optional(),
    deductible: costFields.deductible.default("unknown"),
    frequency: costRecurrenceFrequencySchema,
    interval: interval.default(1),
    dayOfMonth: dayOfMonth.optional(),
    startDate: dateSchema,
    endDate: dateSchema.nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine(endsAfterStart, {
    error: "The end date must not be before the start date.",
    path: ["endDate"],
  });
export type CreateCostRecurrenceRequest = z.output<
  typeof createCostRecurrenceRequestSchema
>;

/**
 * Changes the template (applies to entries booked from now on; the ones booked already stay as they are) and the rule.
 * A change of the rule continues after the newest occurrence that was booked. `active: true` on a paused one skips what
 * fell due while it was paused. `splitMode`, `shares` and `participantIds` follow the rules of `PATCH /costs/{id}`;
 * `tagIds` replaces the tags.
 */
export const updateCostRecurrenceRequestSchema = atLeastOne(
  z
    .strictObject({
      bookId: costFields.bookId.optional(),
      title: costFields.title.optional(),
      amountMinor: costFields.amountMinor.optional(),
      currency: costFields.currency.optional(),
      category: costFields.category.optional(),
      assetId: costFields.assetId.optional(),
      roomId: costFields.roomId.optional(),
      payee: costFields.payee.optional(),
      notes: costFields.notes.optional(),
      paidByUserId: costFields.paidByUserId.optional(),
      splitMode: costFields.splitMode.optional(),
      shares: costFields.shares.optional(),
      participantIds: costFields.participantIds.optional(),
      tagIds: costFields.tagIds.optional(),
      countsAsExpense: costFields.countsAsExpense.optional(),
      deductible: costFields.deductible.optional(),
      frequency: costRecurrenceFrequencySchema.optional(),
      interval: interval.optional(),
      dayOfMonth: dayOfMonth.optional(),
      startDate: dateSchema.optional(),
      endDate: dateSchema.nullable().optional(),
      active: z.boolean().optional(),
    })
    .refine(endsAfterStart, {
      error: "The end date must not be before the start date.",
      path: ["endDate"],
    }),
);
export type UpdateCostRecurrenceRequest = z.output<
  typeof updateCostRecurrenceRequestSchema
>;

export const runCostRecurrenceResultSchema = z
  .object({
    recurrence: costRecurrenceSchema,
    /** The entry that was booked; null when nothing was due (paused, finished, or the next occurrence is still ahead). */
    entry: costEntrySchema.nullable(),
  })
  .meta({ id: "CostRecurrenceRun" });
export type CostRecurrenceRun = z.infer<typeof runCostRecurrenceResultSchema>;
