import { and, asc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { COST_CATEGORY_COUNTS_AS_EXPENSE } from "$lib/api/enums";
import {
  MAX_COST_RECURRENCES,
  type CreateCostRecurrenceRequest,
  type ListCostRecurrencesQuery,
  type UpdateCostRecurrenceRequest,
} from "$lib/api/schemas/cost-recurrences";
import type { CreateCostRequest } from "$lib/api/schemas/costs";
import type { CostTagRef } from "$lib/api/schemas/cost-tags";
import {
  firstOccurrence,
  nextOccurrenceAfter,
  nextOccurrenceOnOrAfter,
  type RecurrenceRule,
} from "$lib/costs/recurrence";
import {
  assets,
  costBooks,
  costEntries,
  costRecurrences,
  costTags,
  rooms,
  users,
  type DB,
} from "$lib/server/db";
import { getHousehold } from "$lib/server/household/household";
import {
  conflict,
  invalidField,
  notFound,
  type ServiceContext,
} from "$lib/server/service";
import { clockAt } from "$lib/server/tasks/evaluator";
import { defaultCostBook, findCostBookRow } from "./books";
import { checkCostTemplate, createCost, type CostRecord } from "./costs";
import { requireTagIds } from "./tags";

type Db = Pick<ServiceContext, "db">;

export type CostRecurrenceRow = typeof costRecurrences.$inferSelect;

export interface CostRecurrenceRecord extends CostRecurrenceRow {
  bookName: string;
  assetName: string | null;
  roomName: string | null;
  paidByName: string | null;
  tags: CostTagRef[];
}

/** The most occurrences one run books for one recurring cost; a series that was down longer goes on with the next run. */
export const MAX_OCCURRENCES_PER_RUN = 120;

const payer = alias(users, "payer");

function select(ctx: Db) {
  return ctx.db
    .select({
      r: costRecurrences,
      bookName: costBooks.name,
      assetName: assets.name,
      roomName: rooms.name,
      paidByName: sql<
        string | null
      >`coalesce(${payer.displayName}, ${payer.username})`,
    })
    .from(costRecurrences)
    .innerJoin(costBooks, eq(costBooks.id, costRecurrences.bookId))
    .leftJoin(assets, eq(assets.id, costRecurrences.assetId))
    .leftJoin(rooms, eq(rooms.id, costRecurrences.roomId))
    .leftJoin(payer, eq(payer.id, costRecurrences.paidByUserId));
}

type Joined = ReturnType<ReturnType<typeof select>["all"]>[number];

/** The tags that still exist, by name without regard to case; a tag deleted since is simply gone from the template. */
function existingTags(db: DB, ids: readonly string[]): CostTagRef[] {
  if (ids.length === 0) return [];
  return db
    .select({ id: costTags.id, name: costTags.name, color: costTags.color })
    .from(costTags)
    .where(inArray(costTags.id, [...ids]))
    .orderBy(asc(sql`lower(${costTags.name})`), asc(costTags.id))
    .all();
}

function recordsOf(db: DB, rows: readonly Joined[]): CostRecurrenceRecord[] {
  return rows.map((j) => ({
    ...j.r,
    bookName: j.bookName,
    assetName: j.assetName,
    roomName: j.roomName,
    paidByName: j.paidByName,
    tags: existingTags(db, j.r.tagIdsJson),
  }));
}

/** The ones that book, upcoming first; paused and finished ones after them, by title. */
const booking = sql`(${costRecurrences.active} = 1 and ${costRecurrences.nextDate} is not null)`;
const inOrder = [
  sql`${booking} desc`,
  sql`case when ${booking} then ${costRecurrences.nextDate} end asc`,
  asc(sql`lower(${costRecurrences.title})`),
  asc(sql`${costRecurrences}.rowid`),
];

export function listCostRecurrences(
  ctx: Db,
  filter: ListCostRecurrencesQuery = {},
): CostRecurrenceRecord[] {
  const rows = select(ctx)
    .where(
      and(
        filter.active === undefined
          ? undefined
          : filter.active
            ? and(
                eq(costRecurrences.active, true),
                isNotNull(costRecurrences.nextDate),
              )
            : sql`(${costRecurrences.active} = 0 or ${costRecurrences.nextDate} is null)`,
        filter.bookId ? eq(costRecurrences.bookId, filter.bookId) : undefined,
      ),
    )
    .orderBy(...inOrder)
    .all();
  return recordsOf(ctx.db, rows);
}

export function getCostRecurrence(ctx: Db, id: string): CostRecurrenceRecord {
  const row = select(ctx).where(eq(costRecurrences.id, id)).get();
  if (!row) throw notFound("Recurring cost");
  return recordsOf(ctx.db, [row])[0] as CostRecurrenceRecord;
}

function getRow(ctx: Db, id: string): CostRecurrenceRow {
  const row = ctx.db
    .select()
    .from(costRecurrences)
    .where(eq(costRecurrences.id, id))
    .get();
  if (!row) throw notFound("Recurring cost");
  return row;
}

const ruleOf = (r: CostRecurrenceRow): RecurrenceRule => ({
  frequency: r.frequency,
  interval: r.interval,
  dayOfMonth: r.dayOfMonth,
  startDate: r.startDate,
  endDate: r.endDate,
});

/** The entry an occurrence books: the template with the occurrence's date and the tags that still exist. */
function entryOf(
  ctx: Db,
  r: CostRecurrenceRow,
  date: string,
  tagIds: readonly string[] = existingTags(ctx.db, r.tagIdsJson).map(
    (t) => t.id,
  ),
): CreateCostRequest {
  return {
    bookId: r.bookId,
    date,
    title: r.title,
    amountMinor: r.amountMinor,
    currency: r.currency,
    category: r.category,
    assetId: r.assetId,
    roomId: r.roomId,
    payee: r.payee,
    notes: r.notes,
    paidByUserId: r.paidByUserId,
    splitMode: r.splitMode,
    shares: r.splitMode === "custom" ? (r.sharesJson ?? undefined) : undefined,
    participantIds:
      r.splitMode === "equal" ? (r.participantIdsJson ?? undefined) : undefined,
    countsAsExpense: r.countsAsExpense,
    deductible: r.deductible,
    tagIds: [...tagIds],
  };
}

const dayOf = (date: string) => Number(date.slice(8, 10));

/**
 * Saves a recurring cost. The template is checked as booking an entry from it would be (references, the book takes
 * entries, split, tax class, tags), so a mistake shows now and not on the day it is due. The first occurrence is the
 * first one on or after `startDate`; nothing is booked here (see `bookDueRecurrences`).
 */
export function createCostRecurrence(
  ctx: ServiceContext,
  input: CreateCostRecurrenceRequest,
  createdBy: string | null,
): CostRecurrenceRecord {
  const count =
    ctx.db
      .select({ n: sql<number>`count(*)` })
      .from(costRecurrences)
      .get()?.n ?? 0;
  if (count >= MAX_COST_RECURRENCES) {
    throw conflict(
      `There are ${MAX_COST_RECURRENCES} recurring costs already; delete one you do not use first`,
    );
  }
  const book = input.bookId
    ? (findCostBookRow(ctx, input.bookId) ?? undefined)
    : defaultCostBook(ctx);
  const rule: RecurrenceRule = {
    frequency: input.frequency,
    interval: input.interval,
    dayOfMonth: input.dayOfMonth ?? dayOf(input.startDate),
    startDate: input.startDate,
    endDate: input.endDate ?? null,
  };
  const next = firstOccurrence(rule);
  if (next === null) {
    throw invalidField(
      "endDate",
      "The end date leaves no occurrence on or after the start date",
    );
  }
  const template: CreateCostRequest = {
    bookId: input.bookId ?? book?.id,
    date: input.startDate,
    title: input.title,
    amountMinor: input.amountMinor,
    currency: input.currency ?? getHousehold(ctx).currency,
    category: input.category,
    assetId: input.assetId,
    roomId: input.roomId,
    payee: input.payee,
    notes: input.notes,
    paidByUserId: input.paidByUserId,
    splitMode: input.splitMode ?? book?.defaultSplitMode,
    shares: input.shares,
    participantIds: input.participantIds,
    countsAsExpense: input.countsAsExpense,
    deductible: input.deductible,
    tagIds: input.tagIds,
  };
  checkCostTemplate(ctx, template);
  const row = ctx.db
    .insert(costRecurrences)
    .values({
      bookId: template.bookId as string,
      title: input.title,
      amountMinor: input.amountMinor as never,
      currency: template.currency as string,
      category: input.category,
      assetId: input.assetId ?? null,
      roomId: input.roomId ?? null,
      payee: input.payee ?? null,
      notes: input.notes ?? null,
      paidByUserId: input.paidByUserId ?? null,
      splitMode: template.splitMode as CostRecurrenceRow["splitMode"],
      sharesJson: input.shares ?? null,
      participantIdsJson: input.participantIds ?? null,
      tagIdsJson: requireTagIds(ctx, input.tagIds ?? []),
      countsAsExpense:
        input.countsAsExpense ??
        COST_CATEGORY_COUNTS_AS_EXPENSE[input.category],
      deductible: input.deductible,
      frequency: rule.frequency,
      interval: rule.interval,
      dayOfMonth: rule.dayOfMonth,
      startDate: rule.startDate,
      endDate: rule.endDate,
      nextDate: next,
      active: input.active ?? true,
      createdBy,
    })
    .returning({ id: costRecurrences.id })
    .get();
  return getCostRecurrence(ctx, row.id);
}

const TEMPLATE_FIELDS = [
  "bookId",
  "title",
  "amountMinor",
  "currency",
  "category",
  "assetId",
  "roomId",
  "payee",
  "notes",
  "paidByUserId",
  "splitMode",
  "shares",
  "participantIds",
  "tagIds",
  "countsAsExpense",
  "deductible",
] as const;

const RULE_FIELDS = [
  "frequency",
  "interval",
  "dayOfMonth",
  "startDate",
  "endDate",
] as const;

/**
 * Changes a recurring cost. The template applies to entries booked from now on, the ones booked already stay as they
 * are. A change of the rule continues after the newest occurrence that was booked (the next one is worked out again from
 * the new rule); pausing books nothing, and resuming skips what fell due meanwhile instead of booking it afterwards.
 * Any change clears the last error. The template is checked again when the request touches it.
 */
export function updateCostRecurrence(
  ctx: ServiceContext,
  id: string,
  patch: UpdateCostRecurrenceRequest,
): CostRecurrenceRecord {
  const current = getRow(ctx, id);
  const {
    shares,
    participantIds,
    tagIds,
    splitMode,
    bookId,
    amountMinor,
    ...plain
  } = patch;

  const mode = splitMode ?? current.splitMode;
  let sharesJson = current.sharesJson;
  let participantIdsJson = current.participantIdsJson;
  if (shares !== undefined) {
    if (mode !== "custom") {
      throw invalidField(
        "shares",
        "Shares are only allowed for a custom split",
      );
    }
    sharesJson = shares;
    participantIdsJson = null;
  } else if (participantIds !== undefined) {
    if (mode !== "equal") {
      throw invalidField(
        "participantIds",
        "Participants are only allowed for an equal split",
      );
    }
    participantIdsJson = participantIds;
    sharesJson = null;
  } else if (splitMode !== undefined && splitMode !== current.splitMode) {
    if (splitMode === "custom") {
      throw invalidField("shares", "Shares are required for a custom split");
    }
    sharesJson = null;
    participantIdsJson = null;
  }
  const tagIdsJson =
    tagIds === undefined ? current.tagIdsJson : requireTagIds(ctx, tagIds);

  const merged: CostRecurrenceRow = {
    ...current,
    ...plain,
    bookId: bookId ?? current.bookId,
    amountMinor: (amountMinor ?? current.amountMinor) as never,
    splitMode: mode,
    sharesJson,
    participantIdsJson,
    tagIdsJson,
    payee: patch.payee === undefined ? current.payee : patch.payee,
    notes: patch.notes === undefined ? current.notes : patch.notes,
    assetId: patch.assetId === undefined ? current.assetId : patch.assetId,
    roomId: patch.roomId === undefined ? current.roomId : patch.roomId,
    paidByUserId:
      patch.paidByUserId === undefined
        ? current.paidByUserId
        : patch.paidByUserId,
    endDate: patch.endDate === undefined ? current.endDate : patch.endDate,
  };

  if (merged.endDate !== null && merged.endDate < merged.startDate) {
    throw invalidField(
      "endDate",
      "The end date must not be before the start date",
    );
  }
  if (TEMPLATE_FIELDS.some((key) => patch[key] !== undefined)) {
    checkCostTemplate(ctx, entryOf(ctx, merged, merged.startDate, tagIdsJson));
  }

  const rule = ruleOf(merged);
  const ruleChanged = RULE_FIELDS.some(
    (key) => patch[key] !== undefined && patch[key] !== current[key],
  );
  const resumed = patch.active === true && !current.active;
  let nextDate = current.nextDate;
  if (ruleChanged || resumed) {
    nextDate =
      merged.lastOccurrenceDate === null
        ? firstOccurrence(rule)
        : nextOccurrenceAfter(rule, merged.lastOccurrenceDate);
    const { today } = clockAt(ctx.now);
    if (resumed && nextDate !== null && nextDate < today) {
      nextDate = nextOccurrenceOnOrAfter(rule, today);
    }
    if (nextDate === null && merged.lastOccurrenceDate === null) {
      throw invalidField(
        "endDate",
        "The end date leaves no occurrence on or after the start date",
      );
    }
  }

  ctx.db
    .update(costRecurrences)
    .set({
      ...plain,
      bookId: merged.bookId,
      amountMinor: merged.amountMinor,
      splitMode: merged.splitMode,
      sharesJson,
      participantIdsJson,
      tagIdsJson,
      nextDate,
      lastError: null,
    })
    .where(eq(costRecurrences.id, id))
    .run();
  return getCostRecurrence(ctx, id);
}

/** Deletes the recurring cost; the entries it booked stay, no longer tied to it. */
export function deleteCostRecurrence(ctx: Db, id: string): void {
  getRow(ctx, id);
  ctx.db.delete(costRecurrences).where(eq(costRecurrences.id, id)).run();
}

/**
 * Books one occurrence and moves the series on, in one transaction. An occurrence that has an entry already (the pair
 * recurrence and date is unique) books nothing and the series still moves on, so a run that was cut short books each
 * occurrence once. Returns the new entry, or null for one that existed.
 */
function bookOccurrence(
  ctx: ServiceContext,
  rec: CostRecurrenceRow,
  date: string,
): CostRecord | null {
  return ctx.db.transaction((tx) => {
    const inner = { ...ctx, db: tx as unknown as DB };
    const booked = inner.db
      .select({ id: costEntries.id })
      .from(costEntries)
      .where(
        and(
          eq(costEntries.recurrenceId, rec.id),
          eq(costEntries.recurrenceDate, date),
        ),
      )
      .get();
    const entry = booked
      ? null
      : createCost(inner, entryOf(inner, rec, date), rec.createdBy, undefined, {
          id: rec.id,
          date,
        });
    inner.db
      .update(costRecurrences)
      .set({
        lastOccurrenceDate: date,
        nextDate: nextOccurrenceAfter(ruleOf(rec), date),
        lastError: null,
      })
      .where(eq(costRecurrences.id, rec.id))
      .run();
    return entry;
  });
}

/** What went wrong with a recurring cost, as a short code: the book it books into is closed, or anything else. */
function failureOf(ctx: Db, rec: CostRecurrenceRow) {
  const book = findCostBookRow(ctx, rec.bookId);
  return book?.archivedAt ? ("book_archived" as const) : ("failed" as const);
}

function recordFailure(ctx: Db, rec: CostRecurrenceRow, err: unknown) {
  const code = failureOf(ctx, rec);
  ctx.db
    .update(costRecurrences)
    .set({ lastError: code })
    .where(eq(costRecurrences.id, rec.id))
    .run();
  console.error(
    JSON.stringify({
      event: "costs.recurrence_failed",
      code,
      name: err instanceof Error ? err.name : "NonError",
    }),
  );
  return code;
}

/**
 * Books what is due: every occurrence of an active recurring cost up to and including today in the household zone,
 * oldest first, so a server that was down for a while books each occurrence it missed, once. At most
 * `MAX_OCCURRENCES_PER_RUN` per recurring cost and run. One that fails (say its book was archived) records the reason on
 * itself (`lastError`), keeps its place and does not hold up the others. `options.id` limits the run to one.
 */
export function bookDueRecurrences(
  ctx: ServiceContext,
  options: { id?: string } = {},
): { booked: number; failed: number } {
  const { today } = clockAt(ctx.now);
  const due = ctx.db
    .select()
    .from(costRecurrences)
    .where(
      and(
        eq(costRecurrences.active, true),
        isNotNull(costRecurrences.nextDate),
        lte(costRecurrences.nextDate, today),
        options.id ? eq(costRecurrences.id, options.id) : undefined,
      ),
    )
    .orderBy(asc(costRecurrences.nextDate), asc(sql`${costRecurrences}.rowid`))
    .all();
  let booked = 0;
  let failed = 0;
  for (const first of due) {
    let rec = first;
    for (
      let i = 0;
      i < MAX_OCCURRENCES_PER_RUN &&
      rec.nextDate !== null &&
      rec.nextDate <= today;
      i++
    ) {
      try {
        if (bookOccurrence(ctx, rec, rec.nextDate)) booked++;
      } catch (err) {
        recordFailure(ctx, rec, err);
        failed++;
        break;
      }
      rec = getRow(ctx, rec.id);
    }
  }
  return { booked, failed };
}

/**
 * Books the next occurrence if it is due (on or before today): exactly one, so a series that is behind needs several
 * calls. Nothing is booked for a paused or finished recurring cost or one whose next occurrence is still ahead
 * (`entry` is null then). A failure is recorded on the recurring cost like in a run and then thrown.
 */
export function runCostRecurrenceNow(
  ctx: ServiceContext,
  id: string,
): { recurrence: CostRecurrenceRecord; entry: CostRecord | null } {
  const rec = getRow(ctx, id);
  const { today } = clockAt(ctx.now);
  let entry: CostRecord | null = null;
  if (rec.active && rec.nextDate !== null && rec.nextDate <= today) {
    try {
      entry = bookOccurrence(ctx, rec, rec.nextDate);
    } catch (err) {
      recordFailure(ctx, rec, err);
      throw err;
    }
  }
  return { recurrence: getCostRecurrence(ctx, id), entry };
}
