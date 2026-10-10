import { and, eq, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "$lib/api/errors";
import type { FuelUnit, OdometerUnit } from "$lib/api/enums";
import type {
  CreateCostRequest,
  UpdateCostRequest,
} from "$lib/api/schemas/costs";
import type {
  CreateFuelLogRequest,
  UpdateFuelLogRequest,
} from "$lib/api/schemas/fuel-logs";
import { m } from "$lib/paraglide/messages";
import { minor } from "$lib/money";
import { dateInZone, householdTimeZone } from "$lib/server/config";
import { createCost, deleteCost, updateCost } from "$lib/server/costs/costs";
import {
  assets,
  costEntries,
  fuelLogs,
  vehicleDetails,
  type DB,
} from "$lib/server/db";
import { getHousehold } from "$lib/server/household/household";
import { decodeCursor, pageOf } from "$lib/server/pagination";
import {
  invalidField,
  notFound,
  type ServiceContext,
} from "$lib/server/service";
import {
  fuelStretches,
  pricePerUnitMinor,
  type FuelFill,
  type Stretch,
} from "$lib/vehicles/fuel";
import { removeReadingsOfSource, writeOdometer } from "./odometer";
import { odometerUnitOf } from "./summary";

type Ctx = Pick<ServiceContext, "db" | "now">;

export type FuelLogRow = typeof fuelLogs.$inferSelect;

export interface FuelLogRecord extends FuelLogRow {
  odometerUnit: OdometerUnit;
  paidByUserId: string | null;
  pricePerUnitMinor: number | null;
  distance: number | null;
  consumptionPer100: number | null;
  costPerDistanceMinor: number | null;
}

/** The titles of the cost entries are system text, written in the base language. */
const BASE = { locale: "de" } as const;

const todayOf = (ctx: Pick<ServiceContext, "now">) =>
  dateInZone(ctx.now, householdTimeZone());

/** The vehicle's fuel type decides the unit a fill is counted in unless it says so. */
function vehicleOf(ctx: Pick<ServiceContext, "db">, assetId: string) {
  const row = ctx.db
    .select({ kind: assets.kind, fuelType: vehicleDetails.fuelType })
    .from(assets)
    .leftJoin(vehicleDetails, eq(vehicleDetails.assetId, assets.id))
    .where(eq(assets.id, assetId))
    .get();
  if (!row) throw notFound("Asset");
  if (row.kind !== "vehicle") {
    throw new ApiError("invalid_request", "Only vehicles have a fuel log");
  }
  return row;
}

export const defaultFuelUnit = (fuelType: string | null): FuelUnit =>
  fuelType === "electric" ? "kWh" : "l";

/** "Tanken Muster Tankstelle", "Laden" for kilowatt hours. */
export function costTitle(unit: FuelUnit, station: string | null): string {
  const verb =
    unit === "kWh"
      ? m.fuel_log_title_charge({}, BASE)
      : m.fuel_log_title_fuel({}, BASE);
  return station ? `${verb} ${station}` : verb;
}

function assertNotFuture(ctx: Pick<ServiceContext, "now">, date: string) {
  if (date > todayOf(ctx)) {
    throw invalidField("date", "Must not be in the future");
  }
}

/** Every fill of the vehicle as the consumption needs it; amounts in another currency count as unknown. */
function fillsOf(
  ctx: Pick<ServiceContext, "db">,
  assetId: string,
  currency: string,
): FuelFill[] {
  return ctx.db
    .select()
    .from(fuelLogs)
    .where(eq(fuelLogs.assetId, assetId))
    .all()
    .map((row) => ({
      id: row.id,
      date: row.date,
      odometer: row.odometer,
      quantity: row.quantity,
      unit: row.unit,
      amountMinor: row.currency === currency ? row.amountMinor : null,
      fullTank: row.fullTank,
      missedPrevious: row.missedPrevious,
    }));
}

/** The stretches of a vehicle's whole log, in the household currency. */
export function stretchesOf(
  ctx: Pick<ServiceContext, "db">,
  assetId: string,
): Stretch[] {
  return fuelStretches(fillsOf(ctx, assetId, getHousehold(ctx).currency));
}

function toRecords(
  ctx: Pick<ServiceContext, "db">,
  assetId: string,
  rows: readonly FuelLogRow[],
): FuelLogRecord[] {
  const stretches = new Map(
    stretchesOf(ctx, assetId).map((s) => [s.fillId, s]),
  );
  const unit = odometerUnitOf(ctx.db, assetId);
  const payers = new Map(
    rows.flatMap((r) => {
      if (!r.costEntryId) return [];
      const cost = ctx.db
        .select({ paidByUserId: costEntries.paidByUserId })
        .from(costEntries)
        .where(eq(costEntries.id, r.costEntryId))
        .get();
      return cost ? [[r.id, cost.paidByUserId] as const] : [];
    }),
  );
  const currency = getHousehold(ctx).currency;
  return rows.map((row) => {
    const stretch = stretches.get(row.id);
    return {
      ...row,
      odometerUnit: unit,
      paidByUserId: payers.get(row.id) ?? null,
      pricePerUnitMinor: pricePerUnitMinor({
        amountMinor: row.currency === currency ? row.amountMinor : null,
        quantity: row.quantity,
      }),
      distance: stretch?.distance ?? null,
      consumptionPer100: stretch?.consumptionPer100 ?? null,
      costPerDistanceMinor: stretch?.costPerDistanceMinor ?? null,
    };
  });
}

function row(ctx: Pick<ServiceContext, "db">, id: string): FuelLogRow {
  const found = ctx.db.select().from(fuelLogs).where(eq(fuelLogs.id, id)).get();
  if (!found) throw notFound("Fuel log entry");
  return found;
}

export function getFuelLog(
  ctx: Pick<ServiceContext, "db">,
  id: string,
): FuelLogRecord {
  const found = row(ctx, id);
  return toRecords(ctx, found.assetId, [found])[0];
}

const cursorSchema = z.object({
  d: z.string(),
  t: z.number().int(),
  r: z.number().int(),
});

/** Newest first by date, then by when it was entered; keyset pages on (date, createdAt, rowid). */
export function listFuelLogs(
  ctx: Pick<ServiceContext, "db">,
  assetId: string,
  filter: { year?: number },
  page: { cursor?: string; limit: number },
) {
  const asset = ctx.db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.id, assetId))
    .get();
  if (!asset) throw notFound("Asset");
  const where: SQL[] = [eq(fuelLogs.assetId, assetId)];
  if (filter.year !== undefined) {
    const y = String(filter.year).padStart(4, "0");
    where.push(sql`${fuelLogs.date} >= ${`${y}-01-01`}`);
    where.push(sql`${fuelLogs.date} <= ${`${y}-12-31`}`);
  }
  if (page.cursor) {
    const at = decodeCursor(page.cursor, cursorSchema);
    where.push(
      or(
        lt(fuelLogs.date, at.d),
        and(
          eq(fuelLogs.date, at.d),
          or(
            lt(fuelLogs.createdAt, new Date(at.t)),
            and(
              eq(fuelLogs.createdAt, new Date(at.t)),
              lt(sql`${fuelLogs}.rowid`, at.r),
            ),
          ),
        ),
      ) as SQL,
    );
  }
  const rows = ctx.db
    .select({ log: fuelLogs, rowid: sql<number>`${fuelLogs}.rowid` })
    .from(fuelLogs)
    .where(and(...where))
    .orderBy(
      sql`${fuelLogs.date} desc`,
      sql`${fuelLogs.createdAt} desc`,
      sql`${fuelLogs}.rowid desc`,
    )
    .limit(page.limit + 1)
    .all();
  const paged = pageOf(rows, page.limit, (r) => ({
    d: r.log.date,
    t: r.log.createdAt.getTime(),
    r: r.rowid,
  }));
  return {
    items: toRecords(
      ctx,
      assetId,
      paged.items.map((r) => r.log),
    ),
    nextCursor: paged.nextCursor,
  };
}

/** What the cost entry of a fill is built from. */
function costBody(
  log: Pick<
    FuelLogRow,
    "date" | "unit" | "station" | "amountMinor" | "currency" | "assetId"
  >,
  booking: {
    paidByUserId: string | null;
    splitMode: CreateCostRequest["splitMode"];
    shares: CreateCostRequest["shares"];
  },
): CreateCostRequest {
  return {
    date: log.date,
    title: costTitle(log.unit, log.station),
    amountMinor: log.amountMinor,
    currency: log.currency,
    category: "fuel",
    assetId: log.assetId,
    payee: log.station,
    splitMode: booking.splitMode,
    shares: booking.shares,
    paidByUserId: booking.paidByUserId,
    deductible: "unknown",
  };
}

/**
 * Logs a fill-up. In one transaction it records the odometer (a reading of the vehicle, source
 * `fuel_log`; lower than the reading before is a 400 on `odometer`) and books a cost entry of the
 * category `fuel` for the vehicle, unless the fill was free. Nothing is kept if any part fails.
 */
export function createFuelLog(
  ctx: Ctx,
  assetId: string,
  input: CreateFuelLogRequest,
  userId: string | null,
): FuelLogRecord {
  const vehicle = vehicleOf(ctx, assetId);
  const date = input.date ?? todayOf(ctx);
  assertNotFuture(ctx, date);
  const currency = input.currency ?? getHousehold(ctx).currency;
  const unit = input.unit ?? defaultFuelUnit(vehicle.fuelType);
  const id = ctx.db.transaction((tx) => {
    const inner: Ctx = { ...ctx, db: tx as unknown as DB };
    const created = tx
      .insert(fuelLogs)
      .values({
        assetId,
        date,
        odometer: input.odometer,
        quantity: input.quantity,
        unit,
        amountMinor: minor(input.amountMinor),
        currency,
        fullTank: input.fullTank,
        missedPrevious: input.missedPrevious,
        station: input.station ?? null,
        notes: input.notes ?? null,
        createdBy: userId,
        createdAt: new Date(ctx.now),
      })
      .returning()
      .get();
    writeOdometer(
      inner,
      {
        assetId,
        date,
        value: input.odometer,
        source: "fuel_log",
        sourceId: created.id,
        createdBy: userId,
      },
      { date: "date", value: "odometer", asset: null },
    );
    if (input.amountMinor > 0) {
      const cost = createCost(
        inner,
        costBody(created, {
          paidByUserId:
            input.paidByUserId === undefined ? userId : input.paidByUserId,
          splitMode: input.splitMode ?? "ownership",
          shares: input.shares,
        }),
        userId,
      );
      tx.update(fuelLogs)
        .set({ costEntryId: cost.id })
        .where(eq(fuelLogs.id, created.id))
        .run();
    }
    return created.id;
  });
  return getFuelLog(ctx, id);
}

/**
 * Changes a fill. The reading follows the date and the odometer; the cost entry follows the amount,
 * the currency, the date, the station and the payer or split. A fill that becomes free loses its
 * cost entry; one that costs something now and has none gets one (unless only other things changed).
 */
export function updateFuelLog(
  ctx: Ctx,
  id: string,
  patch: UpdateFuelLogRequest,
  userId: string | null,
): FuelLogRecord {
  const current = row(ctx, id);
  if (patch.date !== undefined) assertNotFuture(ctx, patch.date);
  ctx.db.transaction((tx) => {
    const inner: Ctx = { ...ctx, db: tx as unknown as DB };
    const { paidByUserId, splitMode, shares, amountMinor, ...fields } = patch;
    tx.update(fuelLogs)
      .set({
        ...fields,
        ...(amountMinor === undefined
          ? {}
          : { amountMinor: minor(amountMinor) }),
      })
      .where(eq(fuelLogs.id, id))
      .run();
    const next = row(inner, id);

    if (patch.date !== undefined || patch.odometer !== undefined) {
      writeOdometer(
        inner,
        {
          assetId: next.assetId,
          date: next.date,
          value: next.odometer,
          source: "fuel_log",
          sourceId: id,
          createdBy: current.createdBy,
        },
        { date: "date", value: "odometer", asset: null },
      );
    }

    const booking =
      paidByUserId !== undefined ||
      splitMode !== undefined ||
      shares !== undefined;
    const titleChanged =
      patch.station !== undefined || patch.unit !== undefined;
    const moneyChanged =
      patch.amountMinor !== undefined || patch.currency !== undefined;
    if (current.costEntryId) {
      if (next.amountMinor === 0) {
        tx.update(fuelLogs)
          .set({ costEntryId: null })
          .where(eq(fuelLogs.id, id))
          .run();
        deleteCost(inner, current.costEntryId);
      } else if (
        moneyChanged ||
        titleChanged ||
        patch.date !== undefined ||
        booking
      ) {
        const costPatch: UpdateCostRequest = {
          ...(patch.date === undefined ? {} : { date: next.date }),
          ...(titleChanged
            ? { title: costTitle(next.unit, next.station), payee: next.station }
            : {}),
          ...(patch.amountMinor === undefined
            ? {}
            : { amountMinor: next.amountMinor }),
          ...(patch.currency === undefined ? {} : { currency: next.currency }),
          ...(paidByUserId === undefined ? {} : { paidByUserId }),
          ...(splitMode === undefined ? {} : { splitMode }),
          ...(shares === undefined ? {} : { shares }),
        };
        if (Object.keys(costPatch).length > 0) {
          updateCost(inner, current.costEntryId, costPatch);
        }
      }
    } else if (moneyChanged && next.amountMinor > 0) {
      const cost = createCost(
        inner,
        costBody(next, {
          paidByUserId: paidByUserId === undefined ? userId : paidByUserId,
          splitMode: splitMode ?? "ownership",
          shares,
        }),
        userId,
      );
      tx.update(fuelLogs)
        .set({ costEntryId: cost.id })
        .where(eq(fuelLogs.id, id))
        .run();
    }
  });
  return getFuelLog(ctx, id);
}

/**
 * Deletes a fill with the reading it wrote and the cost entry it booked (receipts attached to that
 * entry go with it).
 */
export function deleteFuelLog(ctx: Ctx, id: string): void {
  const current = row(ctx, id);
  ctx.db.transaction((tx) => {
    const inner: Ctx = { ...ctx, db: tx as unknown as DB };
    removeReadingsOfSource(inner, "fuel_log", id);
    tx.delete(fuelLogs).where(eq(fuelLogs.id, id)).run();
    // Last: it removes files, which nothing after it may undo.
    if (current.costEntryId) deleteCost(inner, current.costEntryId);
  });
}
