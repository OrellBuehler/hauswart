import { and, asc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { addMonths } from "$lib/dates";
import type { DefectSeverity, DefectStatus } from "$lib/api/enums";
import {
  ACTIVE_DEFECT_STATUSES,
  DEFECT_TRANSITIONS,
  type AddDefectEventRequest,
  type ChangeDefectStatusRequest,
  type CreateDefectRequest,
  type UpdateDefectRequest,
} from "$lib/api/schemas/defects";
import {
  assets,
  contacts,
  defectEvents,
  defects,
  rooms,
  tasks,
  users,
  type DB,
} from "$lib/server/db";
import { removeOwnedAttachments } from "$lib/server/attachments/attachments";
import { allCommentsOf, type Viewer } from "$lib/server/comments/comments";
import { commentCountSql } from "$lib/server/comments/counts";
import { costsOfSql, type CostsOf } from "$lib/server/costs/totals";
import { getHousehold } from "$lib/server/household/household";
import { paginateArray } from "$lib/server/pagination";
import {
  conflict,
  invalidField,
  notFound,
  type ServiceContext,
} from "$lib/server/service";
import { clockAt } from "$lib/server/tasks/evaluator";
import { deleteTask } from "$lib/server/tasks/tasks";
import { syncReminder } from "./reminder";

type Db = Pick<ServiceContext, "db">;

export type DefectRow = typeof defects.$inferSelect;
export interface DefectRecord extends DefectRow {
  roomName: string | null;
  assetName: string | null;
  responsibleContactName: string | null;
  reminderTaskId: string | null;
  commentCount: number;
  costs: CostsOf;
}

const isActive = (status: DefectStatus) =>
  (ACTIVE_DEFECT_STATUSES as readonly DefectStatus[]).includes(status);

const selectDefects = (db: DB) =>
  db
    .select({
      defect: defects,
      roomName: rooms.name,
      assetName: assets.name,
      contactName: contacts.name,
      reminderTaskId: sql<
        string | null
      >`(select id from tasks where tasks.external_source = 'defect' and tasks.external_ref = ${defects.id} and tasks.archived_at is null)`,
      commentCount: commentCountSql("defect", defects.id),
      costTotal: costsOfSql("defect_id", defects.id).total,
      costCount: costsOfSql("defect_id", defects.id).count,
    })
    .from(defects)
    .leftJoin(rooms, eq(rooms.id, defects.roomId))
    .leftJoin(assets, eq(assets.id, defects.assetId))
    .leftJoin(contacts, eq(contacts.id, defects.responsibleContactId));

type Joined = {
  defect: DefectRow;
  roomName: string | null;
  assetName: string | null;
  contactName: string | null;
  reminderTaskId: string | null;
  commentCount: number;
  costTotal: number;
  costCount: number;
};
const toRecord = (j: Joined): DefectRecord => ({
  ...j.defect,
  roomName: j.roomName,
  assetName: j.assetName,
  responsibleContactName: j.contactName,
  reminderTaskId: j.reminderTaskId,
  commentCount: Number(j.commentCount),
  costs: { totalMinor: Number(j.costTotal), count: Number(j.costCount) },
});

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface DefectFilter {
  status?: DefectStatus;
  active?: boolean;
  severity?: DefectSeverity;
  roomId?: string;
  assetId?: string;
  q?: string;
}

function whereOf(filter: DefectFilter): SQL | undefined {
  const where: SQL[] = [];
  if (filter.status) where.push(eq(defects.status, filter.status));
  if (filter.active) {
    where.push(inArray(defects.status, [...ACTIVE_DEFECT_STATUSES]));
  }
  if (filter.severity) where.push(eq(defects.severity, filter.severity));
  if (filter.roomId) where.push(eq(defects.roomId, filter.roomId));
  if (filter.assetId) where.push(eq(defects.assetId, filter.assetId));
  if (filter.q) {
    const pattern = `%${escapeLike(filter.q.toLowerCase())}%`;
    where.push(
      or(
        sql`lower(${defects.title}) like ${pattern} escape '\\'`,
        sql`lower(${defects.descriptionMd}) like ${pattern} escape '\\'`,
        sql`lower(${defects.locationDetail}) like ${pattern} escape '\\'`,
      ) as SQL,
    );
  }
  return where.length > 0 ? and(...where) : undefined;
}

/** Defects that need attention first, by deadline (none last), then by number. */
export function compareDefects(a: DefectRow, b: DefectRow): number {
  return (
    Number(!isActive(a.status)) - Number(!isActive(b.status)) ||
    (a.deadlineDate ?? "9999-12-31").localeCompare(
      b.deadlineDate ?? "9999-12-31",
    ) ||
    a.number - b.number
  );
}

export function selectAllDefects(
  ctx: Db,
  filter: DefectFilter,
): DefectRecord[] {
  return selectDefects(ctx.db)
    .where(whereOf(filter))
    .all()
    .map(toRecord)
    .sort(compareDefects);
}

export function listDefects(
  ctx: Db,
  filter: DefectFilter,
  page: { cursor?: string; limit: number },
) {
  return paginateArray(selectAllDefects(ctx, filter), page.cursor, page.limit);
}

export function getDefect(ctx: Db, id: string): DefectRecord {
  const row = selectDefects(ctx.db).where(eq(defects.id, id)).get();
  if (!row) throw notFound("Defect");
  return toRecord(row);
}

export interface DefectEventRecord {
  id: string;
  defectId: string;
  at: Date;
  userId: string | null;
  userName: string | null;
  type: typeof defectEvents.$inferSelect.type;
  fromStatus: DefectStatus | null;
  toStatus: DefectStatus | null;
  bodyMd: string;
  externalRef: string | null;
}

const selectEvents = (db: DB) =>
  db
    .select({
      id: defectEvents.id,
      defectId: defectEvents.defectId,
      at: defectEvents.at,
      userId: defectEvents.userId,
      userName: sql<
        string | null
      >`coalesce(${users.displayName}, ${users.username})`,
      type: defectEvents.type,
      fromStatus: defectEvents.fromStatus,
      toStatus: defectEvents.toStatus,
      bodyMd: defectEvents.bodyMd,
      externalRef: defectEvents.externalRef,
    })
    .from(defectEvents)
    .leftJoin(users, eq(users.id, defectEvents.userId));

export function eventsOf(ctx: Db, defectId: string): DefectEventRecord[] {
  return selectEvents(ctx.db)
    .where(eq(defectEvents.defectId, defectId))
    .orderBy(asc(defectEvents.at), asc(sql`${defectEvents}.rowid`))
    .all();
}

export interface DefectDetailRecord extends DefectRecord {
  events: DefectEventRecord[];
}

export function getDefectDetail(ctx: Db, id: string): DefectDetailRecord {
  return { ...getDefect(ctx, id), events: eventsOf(ctx, id) };
}

function assertRefs(
  ctx: Db,
  refs: {
    roomId?: string | null;
    assetId?: string | null;
    responsibleContactId?: string | null;
  },
) {
  const check = (
    table: typeof rooms | typeof assets | typeof contacts,
    id: string | null | undefined,
    field: string,
    label: string,
  ) => {
    if (!id) return;
    const hit = ctx.db
      .select({ id: table.id })
      .from(table)
      .where(eq(table.id, id))
      .get();
    if (!hit) throw invalidField(field, `${label} does not exist`);
  };
  check(rooms, refs.roomId, "roomId", "Room");
  check(assets, refs.assetId, "assetId", "Asset");
  check(contacts, refs.responsibleContactId, "responsibleContactId", "Contact");
}

/** The handover date plus the household's defect deadline months; null without a handover date. */
export function handoverDeadline(ctx: Db): string | null {
  const { handoverDate, settings } = getHousehold(ctx);
  return handoverDate
    ? addMonths(handoverDate, settings.defectDeadlineMonths)
    : null;
}

/**
 * Writes the defect and its "created" event in one transaction (a savepoint inside the caller's
 * transaction, if it has one) and returns the id. No reminder task: `createDefect` adds that.
 */
export function insertDefect(
  ctx: Pick<ServiceContext, "db" | "now">,
  input: CreateDefectRequest,
  createdBy: string | null,
): string {
  assertRefs(ctx, input);
  const handover =
    input.deadlineDate === undefined ? handoverDeadline(ctx) : null;
  const deadlineDate =
    input.deadlineDate === undefined ? handover : input.deadlineDate;
  const deadlineSource =
    input.deadlineDate === undefined && handover !== null
      ? "handover"
      : "manual";
  const id = ctx.db.transaction((tx) => {
    const next =
      (tx
        .select({ max: sql<number | null>`max(${defects.number})` })
        .from(defects)
        .get()?.max ?? 0) + 1;
    const row = tx
      .insert(defects)
      .values({
        number: next,
        title: input.title,
        descriptionMd: input.descriptionMd,
        severity: input.severity,
        roomId: input.roomId ?? null,
        assetId: input.assetId ?? null,
        locationDetail: input.locationDetail ?? null,
        discoveredOn: input.discoveredOn ?? clockAt(ctx.now).today,
        reportedOn: input.reportedOn ?? null,
        responsibleContactId: input.responsibleContactId ?? null,
        deadlineDate,
        deadlineSource,
        createdBy,
      })
      .returning({ id: defects.id })
      .get();
    tx.insert(defectEvents)
      .values({
        defectId: row.id,
        at: new Date(ctx.now),
        userId: createdBy,
        type: "created",
        toStatus: "open",
        createdAt: new Date(ctx.now),
      })
      .run();
    return row.id;
  });
  return id;
}

export async function createDefect(
  ctx: ServiceContext,
  input: CreateDefectRequest,
  createdBy: string | null,
): Promise<DefectRecord> {
  const id = insertDefect(ctx, input, createdBy);
  await syncReminder(ctx, getDefect(ctx, id));
  return getDefect(ctx, id);
}

export async function updateDefect(
  ctx: ServiceContext,
  id: string,
  patch: UpdateDefectRequest,
): Promise<DefectRecord> {
  getDefect(ctx, id);
  assertRefs(ctx, patch);
  const { deadlineSource, ...fields } = patch;
  const deadline: Partial<DefectRow> = {};
  if (deadlineSource === "handover") {
    const date = handoverDeadline(ctx);
    if (date === null) {
      throw invalidField(
        "deadlineSource",
        "The household has no handover date",
      );
    }
    deadline.deadlineDate = date;
    deadline.deadlineSource = "handover";
  } else if (patch.deadlineDate !== undefined) {
    deadline.deadlineSource = "manual";
  }
  ctx.db
    .update(defects)
    .set({ ...fields, ...deadline })
    .where(eq(defects.id, id))
    .run();
  const updated = getDefect(ctx, id);
  await syncReminder(ctx, updated);
  return getDefect(ctx, id);
}

export async function changeStatus(
  ctx: ServiceContext,
  id: string,
  input: ChangeDefectStatusRequest,
  userId: string | null,
): Promise<DefectDetailRecord> {
  const current = getDefect(ctx, id);
  if (current.status === input.status) {
    throw conflict("The defect already has this status");
  }
  if (!DEFECT_TRANSITIONS[current.status].includes(input.status)) {
    throw conflict(
      `A ${current.status} defect cannot become ${input.status}; reopen it first`,
    );
  }
  const today = clockAt(ctx.now).today;
  const reportedOn =
    input.reportedOn ??
    (input.status === "reported"
      ? (current.reportedOn ?? today)
      : current.reportedOn);
  const fixedOn = input.status === "fixed" ? (input.fixedOn ?? today) : null;
  ctx.db.transaction((tx) => {
    tx.update(defects)
      .set({ status: input.status, reportedOn, fixedOn })
      .where(eq(defects.id, id))
      .run();
    tx.insert(defectEvents)
      .values({
        defectId: id,
        at: new Date(ctx.now),
        userId,
        type: "status",
        fromStatus: current.status,
        toStatus: input.status,
        bodyMd: input.note ?? "",
        createdAt: new Date(ctx.now),
      })
      .run();
  });
  await syncReminder(ctx, getDefect(ctx, id));
  return getDefectDetail(ctx, id);
}

export function addEvent(
  ctx: Pick<ServiceContext, "db" | "now">,
  id: string,
  input: AddDefectEventRequest,
  userId: string | null,
): DefectEventRecord {
  getDefect(ctx, id);
  const row = ctx.db
    .insert(defectEvents)
    .values({
      defectId: id,
      at: new Date(ctx.now),
      userId,
      type: input.type,
      bodyMd: input.bodyMd,
      externalRef: input.externalRef ?? null,
      createdAt: new Date(ctx.now),
    })
    .returning({ id: defectEvents.id })
    .get();
  return selectEvents(ctx.db).where(eq(defectEvents.id, row.id)).get()!;
}

/** Removes the defect with its events, comments, attachments and reminder task. */
export function deleteDefect(ctx: ServiceContext, id: string): void {
  getDefect(ctx, id);
  ctx.db.transaction((tx) => {
    const reminders = tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.externalSource, "defect"), eq(tasks.externalRef, id)))
      .all();
    for (const task of reminders)
      deleteTask({ db: tx as unknown as DB, now: ctx.now }, task.id);
    tx.delete(defects).where(eq(defects.id, id)).run();
  });
  removeOwnedAttachments(ctx, "defect", id);
}

export type TimelineItem =
  | ({ kind: "event" } & DefectEventRecord)
  | {
      kind: "comment";
      id: string;
      at: Date;
      userId: string | null;
      userName: string | null;
      bodyMd: string;
      editedAt: Date | null;
      deleted: boolean;
    };

/** Events and comments of one defect, oldest first (events before comments at the same instant). */
export function getTimeline(
  ctx: Pick<ServiceContext, "db" | "now">,
  viewer: Viewer,
  id: string,
): TimelineItem[] {
  getDefect(ctx, id);
  const items: TimelineItem[] = [
    ...eventsOf(ctx, id).map((e) => ({ kind: "event" as const, ...e })),
    ...allCommentsOf(ctx, viewer, "defect", id).map((c) => ({
      kind: "comment" as const,
      id: c.id,
      at: c.createdAt,
      userId: c.author?.id ?? null,
      userName: c.author?.displayName ?? null,
      bodyMd: c.bodyMd,
      editedAt: c.editedAt,
      deleted: c.deleted,
    })),
  ];
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        a.item.at.getTime() - b.item.at.getTime() ||
        Number(a.item.kind === "comment") - Number(b.item.kind === "comment") ||
        a.index - b.index,
    )
    .map(({ item }) => item);
}

/**
 * Deadlines derived from the handover date follow the household's handover
 * date and deadline months; call after either changed.
 */
export async function recomputeHandoverDeadlines(
  ctx: ServiceContext,
): Promise<number> {
  const date = handoverDeadline(ctx);
  const rows = ctx.db
    .select()
    .from(defects)
    .where(eq(defects.deadlineSource, "handover"))
    .all();
  let changed = 0;
  for (const row of rows) {
    if (row.deadlineDate === date) continue;
    ctx.db
      .update(defects)
      .set({ deadlineDate: date })
      .where(eq(defects.id, row.id))
      .run();
    await syncReminder(ctx, getDefect(ctx, row.id));
    changed += 1;
  }
  return changed;
}
