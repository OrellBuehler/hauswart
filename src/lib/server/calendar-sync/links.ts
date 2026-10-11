import { and, eq, sql } from "drizzle-orm";
import type { CalendarLinkStatus } from "$lib/api/enums";
import { calendarLinks } from "$lib/server/db";
import type { ServiceContext } from "$lib/server/service";
import type { DesiredItem } from "./items";
import type { LinkRecord } from "./reconcile";

type Db = Pick<ServiceContext, "db">;
type Clocked = Pick<ServiceContext, "db" | "now">;

export function listLinks(ctx: Db, targetId: string): LinkRecord[] {
  return ctx.db
    .select({
      id: calendarLinks.id,
      kind: calendarLinks.kind,
      itemId: calendarLinks.itemId,
      instanceKey: calendarLinks.instanceKey,
      ref: calendarLinks.ref,
      remoteUid: calendarLinks.remoteUid,
      status: calendarLinks.status,
      contentHash: calendarLinks.contentHash,
      pushedAt: calendarLinks.lastPushedAt,
    })
    .from(calendarLinks)
    .where(eq(calendarLinks.targetId, targetId))
    .all()
    .map((row) => ({ ...row, pushedAt: row.pushedAt?.getTime() ?? null }));
}

/** How many events hauswart keeps in the target's calendar (links that are not notes about deleted ones). */
export function countLinks(ctx: Db, targetId: string): number {
  return (
    ctx.db
      .select({ n: sql<number>`count(*)` })
      .from(calendarLinks)
      .where(
        and(
          eq(calendarLinks.targetId, targetId),
          eq(calendarLinks.status, "synced"),
        ),
      )
      .get()?.n ?? 0
  );
}

export interface LinkValues {
  remoteUid: string | null;
  status: CalendarLinkStatus;
  contentHash: string;
  /** Null for a note that nothing was written for. */
  pushedAt: number | null;
}

/** Creates the link of an item or replaces what it remembers; one row per target, kind, item and occurrence. */
export function saveLink(
  ctx: Clocked,
  targetId: string,
  item: Pick<DesiredItem, "kind" | "itemId" | "instanceKey" | "ref">,
  values: LinkValues,
): void {
  const row = {
    targetId,
    kind: item.kind,
    itemId: item.itemId,
    instanceKey: item.instanceKey,
    ref: item.ref,
    remoteUid: values.remoteUid,
    status: values.status,
    contentHash: values.contentHash,
    lastPushedAt: values.pushedAt === null ? null : new Date(values.pushedAt),
    createdAt: new Date(ctx.now),
    updatedAt: new Date(ctx.now),
  };
  ctx.db
    .insert(calendarLinks)
    .values(row)
    .onConflictDoUpdate({
      target: [
        calendarLinks.targetId,
        calendarLinks.kind,
        calendarLinks.itemId,
        calendarLinks.instanceKey,
      ],
      set: {
        ref: row.ref,
        remoteUid: row.remoteUid,
        status: row.status,
        contentHash: row.contentHash,
        lastPushedAt: row.lastPushedAt,
        updatedAt: row.updatedAt,
      },
    })
    .run();
}

/** Only the id the calendar gave the event. */
export function setLinkUid(
  ctx: Clocked,
  targetId: string,
  ref: string,
  uid: string,
): void {
  ctx.db
    .update(calendarLinks)
    .set({ remoteUid: uid, updatedAt: new Date(ctx.now) })
    .where(
      and(eq(calendarLinks.targetId, targetId), eq(calendarLinks.ref, ref)),
    )
    .run();
}

export function deleteLink(ctx: Db, id: string): void {
  ctx.db.delete(calendarLinks).where(eq(calendarLinks.id, id)).run();
}
