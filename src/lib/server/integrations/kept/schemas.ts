import { z } from "zod";
import { isValidDate } from "$lib/dates";

/**
 * DTOs of the Kept external API (`/api/external/v1`), written from its
 * documentation. Unknown fields are stripped; a value outside the documented
 * shape fails the whole response. Money is an integer in minor units, dates are
 * `YYYY-MM-DD`, instants are ISO 8601 with an offset.
 */

export const KEPT_SCOPES = [
  "bills:read",
  "transactions:read",
  "recurring:read",
  "categories:read",
  "accounts:read",
  "links:write",
] as const;
export type KeptScope = (typeof KEPT_SCOPES)[number];

export const BILL_QUERY_STATUSES = [
  "open",
  "overdue",
  "paid",
  "refund",
  "cancelled",
  "all",
] as const;
export type BillQueryStatus = (typeof BILL_QUERY_STATUSES)[number];

export const BILL_KINDS = ["invoice", "credit_note"] as const;
export const BILL_STATUSES = [
  "open",
  "partially_paid",
  "paid",
  "overpaid",
  "credit_due",
  "cancelled",
] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

export const SERIES_STATUSES = ["suggested", "confirmed", "dismissed"] as const;
export type SeriesStatus = (typeof SERIES_STATUSES)[number];

export const LINK_ENTITY_TYPES = ["bill", "transaction"] as const;
export type LinkEntityType = (typeof LINK_ENTITY_TYPES)[number];

const id = z.string().min(1).max(128);
const text = z.string();
const nullableText = text.nullable();
const date = z.string().refine(isValidDate, "not a YYYY-MM-DD date");
const instant = z.iso.datetime({ offset: true });
const currency = z.string().regex(/^[A-Z]{3}$/);
const money = z.number().int();

/** Only http(s) ever reaches a link in hauswart: a `javascript:` URL from a server must not pass. */
const httpUrl = z
  .string()
  .max(2048)
  .refine((v) => {
    if (!URL.canParse(v)) return false;
    const u = new URL(v);
    return (
      (u.protocol === "http:" || u.protocol === "https:") &&
      u.username === "" &&
      u.password === ""
    );
  }, "not an http(s) URL");

export const meSchema = z.object({
  id,
  username: text,
  displayName: nullableText,
  locale: text,
  defaultCurrency: currency,
  token: z.object({
    scopes: z.array(z.string()),
    categoryIds: z.array(id).nullable(),
  }),
});
export type KeptMe = z.output<typeof meSchema>;

export const billSchema = z.object({
  id,
  kind: z.enum(BILL_KINDS),
  creditorName: nullableText,
  amount: money.nonnegative().nullable(),
  currency,
  issueDate: date.nullable(),
  dueDate: date.nullable(),
  invoiceNumber: nullableText,
  status: z.enum(BILL_STATUSES),
  overdue: z.boolean(),
  paidAmount: money,
  remainingAmount: money.nullable(),
  lastPaymentDate: date.nullable(),
  notes: nullableText,
  url: httpUrl,
  updatedAt: instant,
});
export type KeptBill = z.output<typeof billSchema>;

export const transactionSchema = z.object({
  id,
  accountId: id,
  bookingDate: date,
  amount: money,
  currency,
  counterpartyName: nullableText,
  description: nullableText,
  categoryId: id.nullable(),
  billIds: z.array(id),
  url: httpUrl,
  updatedAt: instant,
});
export type KeptTransaction = z.output<typeof transactionSchema>;

export const categorySchema = z.object({
  id,
  name: text,
  parentId: id.nullable(),
  kind: z.enum(["expense", "income"]),
  color: nullableText,
  updatedAt: instant,
});
export type KeptCategory = z.output<typeof categorySchema>;

export const recurringSeriesSchema = z.object({
  id,
  status: z.enum(SERIES_STATUSES),
  name: text,
  cadence: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
  currency,
  amount: money,
  monthlyCost: money,
  annualCost: money,
  firstDate: date,
  lastDate: date,
  lastAmount: money,
  occurrences: z.number().int().nonnegative(),
  nextExpected: date,
  overdue: z.boolean(),
  updatedAt: instant,
});
export type KeptRecurringSeries = z.output<typeof recurringSeriesSchema>;

export const accountSchema = z.object({
  id,
  name: text,
  currency,
  type: z.enum([
    "current",
    "savings",
    "credit_card",
    "investment",
    "pension",
    "pillar_3a",
    "cash",
    "other",
  ]),
  archived: z.boolean(),
  updatedAt: instant,
});
export type KeptAccount = z.output<typeof accountSchema>;

export const linkSchema = z.object({
  id,
  entityType: z.enum(LINK_ENTITY_TYPES),
  entityId: id,
  source: text,
  label: text,
  url: httpUrl,
  createdAt: instant,
});
export type KeptLink = z.output<typeof linkSchema>;

export const linkListSchema = z.object({ items: z.array(linkSchema) });

export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().min(1).max(512).nullable(),
  });
}
export interface KeptPage<T> {
  items: T[];
  nextCursor: string | null;
}

/** Scopes of `required` that the token of `me` does not hold. */
export function missingScopes(
  me: Pick<KeptMe, "token">,
  required: readonly KeptScope[],
): KeptScope[] {
  return required.filter((s) => !me.token.scopes.includes(s));
}
