import { createHash } from "node:crypto";
import { and, desc, eq, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AiTaskClosedVia, AiTaskKind, UserRole } from "$lib/api/enums";
import type { ListAiTasksQuery } from "$lib/api/schemas/ai-tasks";
import {
  attachmentsById,
  copyAttachment,
  insertAttachment,
  moveAttachment,
  removeOwnedAttachments,
  storeAttachmentFile,
  type AttachmentRecord,
} from "$lib/server/attachments/attachments";
import { requireOpenCostBook } from "$lib/server/costs/books";
import { flagForReview } from "$lib/server/costs/costs";
import {
  aiTasks,
  assets,
  costBooks,
  costEntries,
  fuelLogs,
  users,
  type AiTaskResult,
  type DB,
} from "$lib/server/db";
import { decodeCursor, pageOf } from "$lib/server/pagination";
import {
  conflict,
  forbidden,
  invalidField,
  isUniqueViolation,
  notFound,
  type ServiceContext,
} from "$lib/server/service";

type Db = Pick<ServiceContext, "db">;

export type AiTaskRow = typeof aiTasks.$inferSelect;

/** A cost entry a task produced, as it is now. */
export interface AiTaskCostRecord {
  id: string;
  date: string;
  title: string;
  amountMinor: number;
  currency: string;
  reviewNeeded: boolean;
}

export interface AiTaskRecord extends AiTaskRow {
  createdByName: string | null;
  bookName: string | null;
  assetName: string | null;
  /** The file: the task's own while it is open, the receipt of a cost entry once the task is done. */
  attachment: AttachmentRecord | null;
  /** The cost entries the result names (and those of its fuel log entries) that still exist. */
  resultCosts: AiTaskCostRecord[];
}

const selectTasks = (db: DB) =>
  db
    .select({
      task: aiTasks,
      createdByName: sql<
        string | null
      >`coalesce(${users.displayName}, ${users.username})`,
      bookName: costBooks.name,
      assetName: assets.name,
      rowid: sql<number>`${aiTasks}.rowid`,
    })
    .from(aiTasks)
    .leftJoin(users, eq(users.id, aiTasks.createdByUserId))
    .leftJoin(costBooks, eq(costBooks.id, aiTasks.bookId))
    .leftJoin(assets, eq(assets.id, aiTasks.assetId));

type Joined = ReturnType<ReturnType<typeof selectTasks>["all"]>[number];

/** The cost entry each fuel log entry booked (none for a free fill, or once the entry is deleted). */
function fuelCostEntries(db: DB, fuelLogIds: readonly string[]) {
  if (fuelLogIds.length === 0) return new Map<string, string | null>();
  return new Map(
    db
      .select({ id: fuelLogs.id, costEntryId: fuelLogs.costEntryId })
      .from(fuelLogs)
      .where(inArray(fuelLogs.id, [...fuelLogIds]))
      .all()
      .map((row) => [row.id, row.costEntryId]),
  );
}

function hydrate(db: DB, joined: readonly Joined[]): AiTaskRecord[] {
  const files = attachmentsById(
    { db },
    joined.flatMap((j) => (j.task.attachmentId ? [j.task.attachmentId] : [])),
  );
  const done = joined.flatMap((j) => (j.task.resultJson ? [j.task] : []));
  const fuel = fuelCostEntries(
    db,
    done.flatMap((t) => t.resultJson?.createdFuelLogIds ?? []),
  );
  const entryIdsOf = (result: AiTaskResult): string[] => [
    ...new Set([
      ...result.createdCostIds,
      ...result.createdFuelLogIds.flatMap((id) => {
        const entry = fuel.get(id);
        return entry ? [entry] : [];
      }),
    ]),
  ];
  const wanted = [...new Set(done.flatMap((t) => entryIdsOf(t.resultJson!)))];
  const entries = new Map(
    (wanted.length === 0
      ? []
      : db
          .select({
            id: costEntries.id,
            date: costEntries.date,
            title: costEntries.title,
            amountMinor: costEntries.amountMinor,
            currency: costEntries.currency,
            reviewNeeded: costEntries.reviewNeeded,
          })
          .from(costEntries)
          .where(inArray(costEntries.id, wanted))
          .all()
    ).map((e) => [e.id, e satisfies AiTaskCostRecord]),
  );
  return joined.map((j) => ({
    ...j.task,
    createdByName: j.createdByName,
    bookName: j.bookName,
    assetName: j.assetName,
    attachment: j.task.attachmentId
      ? (files.get(j.task.attachmentId) ?? null)
      : null,
    resultCosts: j.task.resultJson
      ? entryIdsOf(j.task.resultJson).flatMap((id) => {
          const entry = entries.get(id);
          return entry ? [entry] : [];
        })
      : [],
  }));
}

export function findAiTask(ctx: Db, id: string): AiTaskRecord | undefined {
  const row = selectTasks(ctx.db).where(eq(aiTasks.id, id)).get();
  return row ? hydrate(ctx.db, [row])[0] : undefined;
}

export function getAiTask(ctx: Db, id: string): AiTaskRecord {
  const task = findAiTask(ctx, id);
  if (!task) throw notFound("Task");
  return task;
}

const cursorSchema = z.object({ t: z.number().int(), r: z.number().int() });

/** Newest first; every member sees every task. */
export function listAiTasks(
  ctx: Db,
  filter: Pick<ListAiTasksQuery, "status" | "kind">,
  page: { cursor?: string; limit: number },
) {
  const where: SQL[] = [];
  if (filter.status) where.push(eq(aiTasks.status, filter.status));
  if (filter.kind) where.push(eq(aiTasks.kind, filter.kind));
  if (page.cursor) {
    const at = decodeCursor(page.cursor, cursorSchema);
    where.push(
      or(
        lt(aiTasks.createdAt, new Date(at.t)),
        and(
          eq(aiTasks.createdAt, new Date(at.t)),
          lt(sql`${aiTasks}.rowid`, at.r),
        ),
      ) as SQL,
    );
  }
  const rows = selectTasks(ctx.db)
    .where(and(...where))
    .orderBy(desc(aiTasks.createdAt), desc(sql`${aiTasks}.rowid`))
    .limit(page.limit + 1)
    .all();
  const paged = pageOf(rows, page.limit, (r) => ({
    t: r.task.createdAt.getTime(),
    r: r.rowid,
  }));
  return { items: hydrate(ctx.db, paged.items), nextCursor: paged.nextCursor };
}

export interface NewAiTask {
  kind: AiTaskKind;
  bytes: Uint8Array;
  filename: string;
  declaredMime?: string;
  note?: string | null;
  bookId?: string;
  assetId?: string;
  /** Chosen by the caller; see `recordAiTask`. */
  idempotencyKey?: string;
  /** Files directory; defaults to `HAUSWART_FILES_DIR`. */
  root?: string;
}

/** What an idempotency key stands for: the kind, the hints and the bytes uploaded (the note does not count). */
function digestOf(
  input: Pick<NewAiTask, "kind" | "bookId" | "assetId" | "bytes">,
): string {
  const file = createHash("sha256").update(input.bytes).digest("hex");
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.kind,
        input.bookId ?? null,
        input.assetId ?? null,
        file,
      ]),
    )
    .digest("hex");
}

/**
 * Puts a file in the queue. The hints are checked first (an open book, an existing device: 400 on the field), then the
 * file is stored (`FileError` for what is no image or PDF) and the task and its attachment are written in one
 * transaction, so there is never a task without its file.
 */
export async function createAiTask(
  ctx: ServiceContext,
  input: NewAiTask,
  userId: string,
): Promise<AiTaskRecord> {
  if (input.bookId) requireOpenCostBook(ctx, input.bookId);
  if (
    input.assetId &&
    !ctx.db
      .select({ id: assets.id })
      .from(assets)
      .where(eq(assets.id, input.assetId))
      .get()
  ) {
    throw invalidField("assetId", "Asset does not exist");
  }
  const stored = await storeAttachmentFile(input);
  const id = crypto.randomUUID();
  ctx.db.transaction((tx) => {
    const inner: Db = { db: tx as unknown as DB };
    const file = insertAttachment(inner, stored, {
      ownerType: "ai_task",
      ownerId: id,
      uploadedBy: userId,
    });
    tx.insert(aiTasks)
      .values({
        id,
        kind: input.kind,
        note: input.note ? input.note : null,
        createdByUserId: userId,
        attachmentId: file.id,
        bookId: input.bookId ?? null,
        assetId: input.assetId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        idempotencyDigest: input.idempotencyKey ? digestOf(input) : null,
        createdAt: new Date(ctx.now),
      })
      .run();
  });
  return getAiTask(ctx, id);
}

/** The task the person queued with this key, if any. */
function findByKey(
  ctx: Db,
  userId: string,
  key: string,
): AiTaskRecord | undefined {
  const row = selectTasks(ctx.db)
    .where(
      and(eq(aiTasks.createdByUserId, userId), eq(aiTasks.idempotencyKey, key)),
    )
    .get();
  return row ? hydrate(ctx.db, [row])[0] : undefined;
}

/**
 * `createAiTask` for an upload that may be sent twice. With an `idempotencyKey` the person's earlier task with that key is
 * returned (`replayed`, whatever became of it since) and nothing is stored or queued; the same key for a different receipt
 * is a 409. Once the task is deleted its key is free again. Without a key every call queues a task.
 */
export async function recordAiTask(
  ctx: ServiceContext,
  input: NewAiTask,
  userId: string,
): Promise<{ task: AiTaskRecord; replayed: boolean }> {
  const key = input.idempotencyKey;
  const replay = () => {
    if (!key) return null;
    const existing = findByKey(ctx, userId, key);
    if (!existing) return null;
    if (existing.idempotencyDigest !== digestOf(input)) {
      throw conflict("This idempotency key was used for another receipt");
    }
    return { task: existing, replayed: true };
  };
  const first = replay();
  if (first) return first;
  try {
    return { task: await createAiTask(ctx, input, userId), replayed: false };
  } catch (err) {
    if (key && isUniqueViolation(err)) {
      const raced = replay();
      if (raced) return raced;
    }
    throw err;
  }
}

export interface CompleteAiTaskInput {
  createdCostIds?: readonly string[];
  createdFuelLogIds?: readonly string[];
  note?: string | null;
}

const unique = (ids: readonly string[] | undefined) => [...new Set(ids ?? [])];
const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length &&
  [...a].sort().join("\n") === [...b].sort().join("\n");

/**
 * Closes a pending task as done with the entries it produced, in one transaction: every cost entry named (and the cost
 * entry each named fuel log entry booked) is flagged for review, the file moves to the first of them as its receipt
 * and the others get a copy, and the task keeps the result. Entries that do not exist are a 400 on their field and
 * nothing changes. Completing a done task with the same entries changes nothing and returns it; with other entries it
 * is a 409, as is completing a dismissed task.
 */
export function completeAiTask(
  ctx: ServiceContext,
  id: string,
  input: CompleteAiTaskInput,
  via: AiTaskClosedVia,
): AiTaskRecord {
  const task = getAiTask(ctx, id);
  const costIds = unique(input.createdCostIds);
  const fuelLogIds = unique(input.createdFuelLogIds);
  if (task.status === "dismissed") {
    throw conflict("This task was dismissed; upload the receipt again", {
      status: "dismissed",
    });
  }
  if (task.status === "done") {
    const recorded = task.resultJson as AiTaskResult;
    if (
      sameIds(recorded.createdCostIds, costIds) &&
      sameIds(recorded.createdFuelLogIds, fuelLogIds)
    ) {
      return task;
    }
    throw conflict("This task is done already, with other entries", {
      status: "done",
      createdCostIds: recorded.createdCostIds,
      createdFuelLogIds: recorded.createdFuelLogIds,
    });
  }

  const known = new Set(
    costIds.length === 0
      ? []
      : ctx.db
          .select({ id: costEntries.id })
          .from(costEntries)
          .where(inArray(costEntries.id, costIds))
          .all()
          .map((row) => row.id),
  );
  const missingCosts = costIds.filter((cost) => !known.has(cost));
  if (missingCosts.length > 0) {
    throw invalidField(
      "createdCostIds",
      `Unknown cost entries: ${missingCosts.join(", ")}`,
    );
  }
  const booked = fuelCostEntries(ctx.db, fuelLogIds);
  const missingFuel = fuelLogIds.filter((fuel) => !booked.has(fuel));
  if (missingFuel.length > 0) {
    throw invalidField(
      "createdFuelLogIds",
      `Unknown fuel log entries: ${missingFuel.join(", ")}`,
    );
  }
  const targets = unique([
    ...costIds,
    ...fuelLogIds.flatMap((fuel) => {
      const entry = booked.get(fuel);
      return entry ? [entry] : [];
    }),
  ]);

  ctx.db.transaction((tx) => {
    const inner: Db = { db: tx as unknown as DB };
    flagForReview(inner, targets);
    const file = task.attachment ?? undefined;
    if (
      file &&
      file.ownerType === "ai_task" &&
      file.ownerId === task.id &&
      targets.length > 0
    ) {
      moveAttachment(inner, file.id, {
        ownerType: "cost",
        ownerId: targets[0],
      });
      for (const target of targets.slice(1)) {
        copyAttachment(inner, file, { ownerType: "cost", ownerId: target });
      }
    }
    tx.update(aiTasks)
      .set({
        status: "done",
        resultJson: {
          createdCostIds: costIds,
          createdFuelLogIds: fuelLogIds,
          note: input.note ? input.note : null,
        },
        completedAt: new Date(ctx.now),
        completedVia: via,
      })
      .where(and(eq(aiTasks.id, id), eq(aiTasks.status, "pending")))
      .run();
  });
  return getAiTask(ctx, id);
}

/**
 * Closes a pending task without booking anything. The file stays with the task. Dismissing a dismissed task changes
 * nothing (the first reason stays); a done task is a 409.
 */
export function dismissAiTask(
  ctx: ServiceContext,
  id: string,
  input: { reason?: string | null },
  via: AiTaskClosedVia,
): AiTaskRecord {
  const task = getAiTask(ctx, id);
  if (task.status === "dismissed") return task;
  if (task.status === "done") {
    throw conflict("This task is done already", { status: "done" });
  }
  ctx.db
    .update(aiTasks)
    .set({
      status: "dismissed",
      dismissReason: input.reason ? input.reason : null,
      completedAt: new Date(ctx.now),
      completedVia: via,
    })
    .where(and(eq(aiTasks.id, id), eq(aiTasks.status, "pending")))
    .run();
  return getAiTask(ctx, id);
}

/**
 * Removes a task, for its uploader or an administrator (403 otherwise). The file goes with it while it still belongs
 * to the task (pending or dismissed); one that moved to a cost entry stays there as that entry's receipt.
 */
export function deleteAiTask(
  ctx: ServiceContext,
  viewer: { id: string; role: UserRole },
  id: string,
): void {
  const task = getAiTask(ctx, id);
  if (task.createdByUserId !== viewer.id && viewer.role !== "admin") {
    throw forbidden("Only the uploader or an administrator may delete a task");
  }
  ctx.db.transaction((tx) => {
    tx.delete(aiTasks).where(eq(aiTasks.id, id)).run();
    removeOwnedAttachments({ ...ctx, db: tx as unknown as DB }, "ai_task", id);
  });
}
