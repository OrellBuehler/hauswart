import { z } from "zod";
import {
  atLeastOne,
  dateSchema,
  idSchema,
  isoTimestampSchema,
  nullableText,
  paginated,
  paginationQuerySchema,
} from "./common";
import { MAX_COST_MINOR } from "./costs";
import { currencySchema } from "./household";

export const SETTLEMENT_NOTE_MAX = 500;

/** A payment between two people is always positive: who paid whom says the direction. */
export const settlementAmountSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_COST_MINOR);

export const settlementSchema = z
  .object({
    id: z.string(),
    /** The book the payment settles; null = across all books. */
    bookId: z.string().nullable(),
    bookName: z.string().nullable(),
    /** Who handed the money over. */
    fromUserId: z.string(),
    fromName: z.string().nullable(),
    /** Who received it. */
    toUserId: z.string(),
    toName: z.string().nullable(),
    /** Minor units of `currency`, always positive. */
    amountMinor: z.number().int(),
    currency: z.string(),
    date: dateSchema,
    note: z.string().nullable(),
    createdBy: z.string().nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .meta({ id: "Settlement" });
export type Settlement = z.infer<typeof settlementSchema>;

const year = z.coerce.number().int().min(1990).max(2200);

export const listSettlementsQuerySchema = paginationQuerySchema.extend({
  /** Only the payments of this book (payments across all books are not listed then). */
  bookId: idSchema.optional(),
  year: year.optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  /** Payments this person made or received: a user id, or `me`. */
  userId: idSchema.optional(),
});
export type ListSettlementsQuery = z.output<typeof listSettlementsQuerySchema>;
export const listSettlementsResponseSchema = paginated(settlementSchema);

const fields = {
  bookId: idSchema.nullable(),
  fromUserId: idSchema,
  toUserId: idSchema,
  amountMinor: settlementAmountSchema,
  currency: currencySchema,
  date: dateSchema,
  note: nullableText(SETTLEMENT_NOTE_MAX),
};

/**
 * `bookId` omitted or null settles across all books, `currency` defaults to the household's and `date` to today.
 * The two people must differ and be members of the household. `idempotencyKey` (8 to 128 characters, chosen by the
 * caller, unique per person who records) makes a retried request return the first payment with status 200 instead of
 * recording a second one; the same key for a different payment (other people, amount, currency or book) is a 409.
 */
export const createSettlementRequestSchema = z.strictObject({
  bookId: fields.bookId.optional(),
  fromUserId: fields.fromUserId,
  toUserId: fields.toUserId,
  amountMinor: fields.amountMinor,
  currency: fields.currency.optional(),
  date: fields.date.optional(),
  note: fields.note.optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});
export type CreateSettlementRequest = z.output<
  typeof createSettlementRequestSchema
>;

export const updateSettlementRequestSchema = atLeastOne(
  z.strictObject({
    bookId: fields.bookId.optional(),
    fromUserId: fields.fromUserId.optional(),
    toUserId: fields.toUserId.optional(),
    amountMinor: fields.amountMinor.optional(),
    currency: fields.currency.optional(),
    date: fields.date.optional(),
    note: fields.note.optional(),
  }),
);
export type UpdateSettlementRequest = z.output<
  typeof updateSettlementRequestSchema
>;
