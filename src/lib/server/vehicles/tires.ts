import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { ApiError } from "$lib/api/errors";
import type { OdometerUnit } from "$lib/api/enums";
import type {
  CreateTireSetRequest,
  MeasureTreadRequest,
  MountTireSetRequest,
  UpdateTireSetRequest,
} from "$lib/api/schemas/tire-sets";
import { removeOwnedAttachments } from "$lib/server/attachments/attachments";
import { dateInZone, householdTimeZone } from "$lib/server/config";
import {
  assets,
  contacts,
  odometerReadings,
  tireSetEvents,
  tireSets,
  type DB,
} from "$lib/server/db";
import { paginateArray } from "$lib/server/pagination";
import {
  conflict,
  invalidField,
  notFound,
  type ServiceContext,
} from "$lib/server/service";
import { tireSetDistance } from "$lib/vehicles/tires";
import { removeReadingsOfSource, writeOdometer } from "./odometer";
import { odometerUnitOf } from "./summary";

type Ctx = Pick<ServiceContext, "db" | "now">;

export type TireSetRow = typeof tireSets.$inferSelect;
export type TireEventRow = typeof tireSetEvents.$inferSelect;

export interface TireSetRecord extends TireSetRow {
  storageContactName: string | null;
  /** The day it was mounted, while it is. */
  mountedOn: string | null;
  distance: number | null;
  odometerUnit: OdometerUnit;
}

export interface TireSetDetailRecord extends TireSetRecord {
  events: TireEventRow[];
}

const todayOf = (ctx: Pick<ServiceContext, "now">) =>
  dateInZone(ctx.now, householdTimeZone());

/** The vehicle must exist; an asset of another kind has no tire sets (400). */
function assertVehicle(ctx: Pick<ServiceContext, "db">, assetId: string) {
  const asset = ctx.db
    .select({ kind: assets.kind })
    .from(assets)
    .where(eq(assets.id, assetId))
    .get();
  if (!asset) throw notFound("Asset");
  if (asset.kind !== "vehicle") {
    throw new ApiError("invalid_request", "Only vehicles have tire sets");
  }
}

function assertContact(
  ctx: Pick<ServiceContext, "db">,
  contactId: string | null | undefined,
) {
  if (!contactId) return;
  const hit = ctx.db
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .get();
  if (!hit) throw invalidField("storageContactId", "Contact does not exist");
}

function assertNotFuture(ctx: Pick<ServiceContext, "now">, date: string) {
  if (date > todayOf(ctx))
    throw invalidField("date", "Must not be in the future");
}

const eventOrder = [
  asc(tireSetEvents.date),
  asc(tireSetEvents.createdAt),
  asc(sql`${tireSetEvents}.rowid`),
];

function eventsOf(
  db: Pick<DB, "select">,
  setIds: readonly string[],
): Map<string, TireEventRow[]> {
  const out = new Map<string, TireEventRow[]>();
  if (setIds.length === 0) return out;
  for (const row of db
    .select()
    .from(tireSetEvents)
    .where(inArray(tireSetEvents.tireSetId, [...setIds]))
    .orderBy(...eventOrder)
    .all()) {
    const list = out.get(row.tireSetId) ?? [];
    list.push(row);
    out.set(row.tireSetId, list);
  }
  return out;
}

function toRecords(
  db: Pick<DB, "select">,
  assetId: string,
  rows: readonly TireSetRow[],
): TireSetDetailRecord[] {
  const events = eventsOf(
    db,
    rows.map((r) => r.id),
  );
  const readings = db
    .select({ date: odometerReadings.date, value: odometerReadings.value })
    .from(odometerReadings)
    .where(eq(odometerReadings.assetId, assetId))
    .all();
  const unit = odometerUnitOf(db, assetId);
  const contactIds = [
    ...new Set(
      rows.flatMap((r) => (r.storageContactId ? [r.storageContactId] : [])),
    ),
  ];
  const names = new Map(
    contactIds.length === 0
      ? []
      : db
          .select({ id: contacts.id, name: contacts.name })
          .from(contacts)
          .where(inArray(contacts.id, contactIds))
          .all()
          .map((c) => [c.id, c.name] as const),
  );
  return rows.map((row) => {
    const list = events.get(row.id) ?? [];
    const lastMount = [...list].reverse().find((e) => e.kind === "mounted");
    return {
      ...row,
      storageContactName: row.storageContactId
        ? (names.get(row.storageContactId) ?? null)
        : null,
      mountedOn: row.mounted ? (lastMount?.date ?? null) : null,
      distance: tireSetDistance(list, readings),
      odometerUnit: unit,
      events: list,
    };
  });
}

const SEASON_ORDER = { summer: 0, winter: 1, all_season: 2 } as const;

/** The mounted set first, then sets in use by season, retired ones last; newest first among equals. */
function compareSets(a: TireSetRow, b: TireSetRow): number {
  return (
    Number(b.mounted) - Number(a.mounted) ||
    Number(a.retiredAt !== null) - Number(b.retiredAt !== null) ||
    SEASON_ORDER[a.season] - SEASON_ORDER[b.season] ||
    b.createdAt.getTime() - a.createdAt.getTime() ||
    (a.id < b.id ? -1 : 1)
  );
}

export function listTireSets(
  ctx: Pick<ServiceContext, "db">,
  assetId: string,
  filter: { includeRetired?: boolean },
  page: { cursor?: string; limit: number },
) {
  const asset = ctx.db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.id, assetId))
    .get();
  if (!asset) throw notFound("Asset");
  const rows = ctx.db
    .select()
    .from(tireSets)
    .where(
      and(
        eq(tireSets.assetId, assetId),
        filter.includeRetired ? undefined : isNull(tireSets.retiredAt),
      ),
    )
    .all()
    .sort(compareSets);
  const paged = paginateArray(rows, page.cursor, page.limit);
  return {
    items: toRecords(ctx.db, assetId, paged.items),
    nextCursor: paged.nextCursor,
  };
}

function setRow(ctx: Pick<ServiceContext, "db">, id: string): TireSetRow {
  const row = ctx.db.select().from(tireSets).where(eq(tireSets.id, id)).get();
  if (!row) throw notFound("Tire set");
  return row;
}

export function getTireSet(
  ctx: Pick<ServiceContext, "db">,
  id: string,
): TireSetDetailRecord {
  const row = setRow(ctx, id);
  return toRecords(ctx.db, row.assetId, [row])[0];
}

/** The set a vehicle is running on, if any. */
export function mountedTireSet(
  ctx: Pick<ServiceContext, "db">,
  assetId: string,
): TireSetDetailRecord | null {
  const row = ctx.db
    .select()
    .from(tireSets)
    .where(and(eq(tireSets.assetId, assetId), eq(tireSets.mounted, true)))
    .get();
  return row ? toRecords(ctx.db, assetId, [row])[0] : null;
}

export function createTireSet(
  ctx: Ctx,
  assetId: string,
  input: CreateTireSetRequest,
): TireSetDetailRecord {
  assertVehicle(ctx, assetId);
  assertContact(ctx, input.storageContactId);
  if (input.treadMeasuredOn !== undefined && input.treadDepthMm === undefined) {
    throw invalidField("treadDepthMm", "Required with treadMeasuredOn");
  }
  const measuredOn =
    input.treadDepthMm === undefined
      ? null
      : (input.treadMeasuredOn ?? todayOf(ctx));
  if (measuredOn) assertNotFuture(ctx, measuredOn);
  const id = ctx.db.transaction((tx) => {
    const row = tx
      .insert(tireSets)
      .values({
        assetId,
        season: input.season,
        brand: input.brand ?? null,
        model: input.model ?? null,
        size: input.size ?? null,
        dot: input.dot ?? null,
        treadDepthMm: input.treadDepthMm ?? null,
        treadMeasuredOn: measuredOn,
        storageLocation: input.storageLocation ?? null,
        storageContactId: input.storageContactId ?? null,
        purchasedOn: input.purchasedOn ?? null,
        notes: input.notes ?? null,
        createdAt: new Date(ctx.now),
      })
      .returning({ id: tireSets.id })
      .get();
    if (measuredOn && input.treadDepthMm !== undefined) {
      tx.insert(tireSetEvents)
        .values({
          tireSetId: row.id,
          date: measuredOn,
          kind: "tread_measured",
          treadDepthMm: input.treadDepthMm,
          createdAt: new Date(ctx.now),
        })
        .run();
    }
    return row.id;
  });
  return getTireSet(ctx, id);
}

/** Puts a mounted set away: the event is written, the flag cleared. */
function takeOff(
  tx: DB,
  ctx: Pick<ServiceContext, "now">,
  set: TireSetRow,
  date: string,
  odometer: number | null,
) {
  tx.update(tireSets)
    .set({ mounted: false })
    .where(eq(tireSets.id, set.id))
    .run();
  tx.insert(tireSetEvents)
    .values({
      tireSetId: set.id,
      date,
      kind: "unmounted",
      odometer,
      createdAt: new Date(ctx.now),
    })
    .run();
}

export function updateTireSet(
  ctx: Ctx,
  id: string,
  patch: UpdateTireSetRequest,
): TireSetDetailRecord {
  const current = setRow(ctx, id);
  assertContact(ctx, patch.storageContactId);
  const { retired, ...fields } = patch;
  ctx.db.transaction((tx) => {
    if (retired === true && current.mounted) {
      takeOff(tx as unknown as DB, ctx, current, todayOf(ctx), null);
    }
    tx.update(tireSets)
      .set({
        ...fields,
        ...(retired === undefined
          ? {}
          : {
              retiredAt: retired
                ? (current.retiredAt ?? new Date(ctx.now))
                : null,
            }),
      })
      .where(eq(tireSets.id, id))
      .run();
  });
  return getTireSet(ctx, id);
}

/** Deletes the set with its events and the readings they wrote, and its attachments. */
export function deleteTireSet(ctx: Ctx, id: string): void {
  setRow(ctx, id);
  ctx.db.transaction((tx) => {
    const inner: Ctx = { ...ctx, db: tx as unknown as DB };
    const eventIds = tx
      .select({ id: tireSetEvents.id })
      .from(tireSetEvents)
      .where(eq(tireSetEvents.tireSetId, id))
      .all();
    for (const event of eventIds) {
      removeReadingsOfSource(inner, "tire_change", event.id);
    }
    tx.delete(tireSets).where(eq(tireSets.id, id)).run();
  });
  removeOwnedAttachments(ctx, "tire_set", id);
}

/**
 * Mounts a set on its vehicle: the set that was mounted is taken off first (an `unmounted` event of
 * the same day and odometer), then the `mounted` event is written, and with an odometer value the
 * vehicle gets that reading (source `tire_change`, the mount event as its source record) under the
 * usual rule that it must not be lower than the reading before. All of it or nothing. A retired
 * set or one already mounted is a 409.
 */
export function mountTireSet(
  ctx: Ctx,
  assetId: string,
  setId: string,
  input: MountTireSetRequest,
  userId: string | null,
): TireSetDetailRecord {
  const date = input.date ?? todayOf(ctx);
  assertNotFuture(ctx, date);
  ctx.db.transaction((tx) => {
    const inner: Ctx = { ...ctx, db: tx as unknown as DB };
    const set = setRow(inner, setId);
    if (set.assetId !== assetId) throw notFound("Tire set");
    if (set.retiredAt) throw conflict("A retired tire set cannot be mounted");
    if (set.mounted) throw conflict("This tire set is already mounted");
    const before = tx
      .select()
      .from(tireSets)
      .where(and(eq(tireSets.assetId, assetId), eq(tireSets.mounted, true)))
      .get();
    if (before) takeOff(inner.db, ctx, before, date, input.odometer ?? null);
    tx.update(tireSets)
      .set({ mounted: true })
      .where(eq(tireSets.id, setId))
      .run();
    const event = tx
      .insert(tireSetEvents)
      .values({
        tireSetId: setId,
        date,
        kind: "mounted",
        odometer: input.odometer ?? null,
        createdAt: new Date(ctx.now),
      })
      .returning({ id: tireSetEvents.id })
      .get();
    if (input.odometer !== undefined) {
      writeOdometer(
        inner,
        {
          assetId,
          date,
          value: input.odometer,
          source: "tire_change",
          sourceId: event.id,
          createdBy: userId,
        },
        { date: "date", value: "odometer", asset: null },
      );
    }
  });
  return getTireSet(ctx, setId);
}

/**
 * Records a tread measurement: an event, and the set's current depth when the measurement is the
 * newest. With an odometer value it is a reading of the vehicle as well.
 */
export function measureTread(
  ctx: Ctx,
  setId: string,
  input: MeasureTreadRequest,
  userId: string | null,
): TireSetDetailRecord {
  const date = input.date ?? todayOf(ctx);
  assertNotFuture(ctx, date);
  ctx.db.transaction((tx) => {
    const inner: Ctx = { ...ctx, db: tx as unknown as DB };
    const set = setRow(inner, setId);
    const event = tx
      .insert(tireSetEvents)
      .values({
        tireSetId: setId,
        date,
        kind: "tread_measured",
        odometer: input.odometer ?? null,
        treadDepthMm: input.treadDepthMm,
        createdAt: new Date(ctx.now),
      })
      .returning({ id: tireSetEvents.id })
      .get();
    if (set.treadMeasuredOn === null || date >= set.treadMeasuredOn) {
      tx.update(tireSets)
        .set({ treadDepthMm: input.treadDepthMm, treadMeasuredOn: date })
        .where(eq(tireSets.id, setId))
        .run();
    }
    if (input.odometer !== undefined) {
      writeOdometer(
        inner,
        {
          assetId: set.assetId,
          date,
          value: input.odometer,
          source: "tire_change",
          sourceId: event.id,
          createdBy: userId,
        },
        { date: "date", value: "odometer", asset: null },
      );
    }
  });
  return getTireSet(ctx, setId);
}
