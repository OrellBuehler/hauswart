import type { z } from "zod";
import type { endpoints } from "$lib/api/registry";
import type { costRecurrenceSchema } from "$lib/api/schemas/cost-recurrences";
import { toIso } from "$lib/api/schemas/common";
import {
  bookDueRecurrences,
  createCostRecurrence,
  deleteCostRecurrence,
  getCostRecurrence,
  listCostRecurrences,
  runCostRecurrenceNow,
  updateCostRecurrence,
  type CostRecurrenceRecord,
} from "$lib/server/costs/recurrences";
import type { Handler } from "../bind";
import { wireCost } from "./costs";

export function wireCostRecurrence(
  r: CostRecurrenceRecord,
): z.input<typeof costRecurrenceSchema> {
  return {
    id: r.id,
    bookId: r.bookId,
    bookName: r.bookName,
    title: r.title,
    amountMinor: r.amountMinor,
    currency: r.currency,
    category: r.category,
    assetId: r.assetId,
    assetName: r.assetName,
    roomId: r.roomId,
    roomName: r.roomName,
    payee: r.payee,
    notes: r.notes,
    paidByUserId: r.paidByUserId,
    paidByName: r.paidByName,
    splitMode: r.splitMode,
    shares: r.splitMode === "custom" ? r.sharesJson : null,
    participantIds: r.splitMode === "equal" ? r.participantIdsJson : null,
    tags: r.tags,
    countsAsExpense: r.countsAsExpense,
    deductible: r.deductible,
    frequency: r.frequency,
    interval: r.interval,
    dayOfMonth: r.dayOfMonth,
    startDate: r.startDate,
    endDate: r.endDate,
    nextDate: r.nextDate,
    lastOccurrenceDate: r.lastOccurrenceDate,
    active: r.active,
    lastError: r.lastError,
    createdBy: r.createdBy,
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
  };
}

export const list: Handler<typeof endpoints.costRecurrencesList> = ({
  ctx,
  query,
}) => ({ items: listCostRecurrences(ctx, query).map(wireCostRecurrence) });

/** What a saved recurring cost already owes (a start date in the past) is booked right away, not at the next run. */
export const create: Handler<typeof endpoints.costRecurrencesCreate> = ({
  ctx,
  body,
}) => {
  const created = createCostRecurrence(ctx, body, ctx.user.id);
  bookDueRecurrences(ctx, { id: created.id });
  return wireCostRecurrence(getCostRecurrence(ctx, created.id));
};

export const get: Handler<typeof endpoints.costRecurrencesGet> = ({
  ctx,
  params,
}) => wireCostRecurrence(getCostRecurrence(ctx, params.id));

export const update: Handler<typeof endpoints.costRecurrencesUpdate> = ({
  ctx,
  params,
  body,
}) => {
  updateCostRecurrence(ctx, params.id, body);
  bookDueRecurrences(ctx, { id: params.id });
  return wireCostRecurrence(getCostRecurrence(ctx, params.id));
};

export const remove: Handler<typeof endpoints.costRecurrencesDelete> = ({
  ctx,
  params,
}) => {
  deleteCostRecurrence(ctx, params.id);
  return null;
};

export const runNow: Handler<typeof endpoints.costRecurrencesRun> = ({
  ctx,
  params,
}) => {
  const { recurrence, entry } = runCostRecurrenceNow(ctx, params.id);
  return {
    recurrence: wireCostRecurrence(recurrence),
    entry: entry ? wireCost(entry, ctx.user.id) : null,
  };
};
