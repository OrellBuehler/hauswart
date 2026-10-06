import { eq } from "drizzle-orm";
import type { CommentEntityType } from "$lib/api/enums";
import {
  assetHints,
  assets,
  contacts,
  defects,
  parts,
  rooms,
  serviceLog,
  tasks,
  type DB,
} from "$lib/server/db";

/**
 * What a kind of entity must offer to be commented on: whether an id exists,
 * a title and a link for notifications, and optionally who is involved
 * (user ids; null means every household member).
 */
export interface Commentable {
  exists(db: DB, id: string): boolean;
  title(db: DB, id: string): string | null;
  url(db: DB, id: string): string;
  audience?(db: DB, id: string): string[] | null;
}

const registry = new Map<CommentEntityType, Commentable>();

/** Adds (or replaces) an entity type; returns a function that removes it. */
export function registerCommentable(
  type: CommentEntityType,
  commentable: Commentable,
): () => void {
  registry.set(type, commentable);
  return () => {
    if (registry.get(type) === commentable) registry.delete(type);
  };
}

export function commentableOf(
  type: CommentEntityType,
): Commentable | undefined {
  return registry.get(type);
}

function simple(
  table:
    | typeof assets
    | typeof assetHints
    | typeof rooms
    | typeof parts
    | typeof contacts
    | typeof serviceLog
    | typeof defects,
  titleOf: (row: Record<string, unknown>) => string,
  url: (db: DB, id: string) => string,
): Commentable {
  const find = (db: DB, id: string) =>
    db.select().from(table).where(eq(table.id, id)).get() as
      Record<string, unknown> | undefined;
  return {
    exists: (db, id) => find(db, id) !== undefined,
    title: (db, id) => {
      const row = find(db, id);
      return row ? titleOf(row) : null;
    },
    url,
  };
}

registerCommentable("task", {
  exists: (db, id) =>
    db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, id)).get() !==
    undefined,
  title: (db, id) =>
    db.select({ t: tasks.title }).from(tasks).where(eq(tasks.id, id)).get()
      ?.t ?? null,
  url: (_db, id) => `/tasks/${id}`,
  audience: (db, id) => {
    const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!task) return null;
    if (task.assignMode === "fixed" && task.assigneeUserId) {
      return [task.assigneeUserId];
    }
    if (task.assignMode === "rotate" && task.rotationOrder.length > 0) {
      return task.rotationOrder;
    }
    return null;
  },
});
registerCommentable(
  "defect",
  simple(
    defects,
    (r) => `#${r.number as number} ${r.title as string}`,
    (_db, id) => `/defects/${id}`,
  ),
);
registerCommentable(
  "asset",
  simple(
    assets,
    (r) => r.name as string,
    (_db, id) => `/inventory/${id}`,
  ),
);
registerCommentable(
  "asset_hint",
  simple(
    assetHints,
    (r) => r.title as string,
    (db, id) =>
      `/inventory/${
        db
          .select({ assetId: assetHints.assetId })
          .from(assetHints)
          .where(eq(assetHints.id, id))
          .get()?.assetId ?? ""
      }`,
  ),
);
registerCommentable(
  "room",
  simple(
    rooms,
    (r) => r.name as string,
    (_db, id) => `/rooms/${id}`,
  ),
);
registerCommentable(
  "part",
  simple(
    parts,
    (r) => r.name as string,
    (_db, id) => `/parts/${id}`,
  ),
);
registerCommentable(
  "contact",
  simple(
    contacts,
    (r) => r.name as string,
    (_db, id) => `/contacts/${id}`,
  ),
);
registerCommentable(
  "service_log",
  simple(
    serviceLog,
    (r) => r.title as string,
    (db, id) =>
      `/inventory/${
        db
          .select({ assetId: serviceLog.assetId })
          .from(serviceLog)
          .where(eq(serviceLog.id, id))
          .get()?.assetId ?? ""
      }`,
  ),
);
