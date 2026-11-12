import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { PutTaskStepsRequest } from "$lib/api/schemas/task-steps";
import {
  deleteOwnedAttachmentRows,
  findAttachment,
  releaseAttachments,
  type AttachmentRecord,
} from "$lib/server/attachments/attachments";
import { attachments, taskSteps, tasks, type DB } from "$lib/server/db";
import {
  notFound,
  invalidField,
  type ServiceContext,
} from "$lib/server/service";

type Db = Pick<ServiceContext, "db">;
type Now = Pick<ServiceContext, "db" | "now">;

export interface StepRecord {
  id: string;
  taskId: string;
  position: number;
  title: string;
  body: string;
  /** The pictures of the step, in the order they were uploaded. */
  images: AttachmentRecord[];
}

/** Where the steps come from, as the task row stores it. */
export interface StoredStepsSource {
  label: string | null;
  url: string | null;
  attachmentId: string | null;
  page: number | null;
}

export interface StepsSourceRecord extends StoredStepsSource {
  /** The file `attachmentId` names; null when none is named or it has been deleted. */
  attachment: AttachmentRecord | null;
}

export interface TaskStepsRecord {
  steps: StepRecord[];
  stepsSource: StepsSourceRecord | null;
  stepCount: number;
}

/**
 * The source as a reader sees it: a file that no longer exists drops out of it (`attachmentId`, `page` and `attachment`
 * read as null), and when nothing else is left there is no source at all.
 */
export function resolveStepsSource(
  ctx: Db,
  stored: StoredStepsSource | null,
): StepsSourceRecord | null {
  if (!stored) return null;
  const attachment = stored.attachmentId
    ? (findAttachment(ctx, stored.attachmentId) ?? null)
    : null;
  const source: StepsSourceRecord = {
    label: stored.label,
    url: stored.url,
    attachmentId: attachment ? attachment.id : null,
    page: attachment ? stored.page : null,
    attachment,
  };
  return source.label === null &&
    source.url === null &&
    source.attachmentId === null
    ? null
    : source;
}

/** The steps of a task in order, each with its pictures. */
export function listSteps(ctx: Db, taskId: string): StepRecord[] {
  const rows = ctx.db
    .select()
    .from(taskSteps)
    .where(eq(taskSteps.taskId, taskId))
    .orderBy(
      asc(taskSteps.position),
      asc(taskSteps.createdAt),
      sql`${taskSteps}.rowid`,
    )
    .all();
  if (rows.length === 0) return [];
  const images = new Map<string, AttachmentRecord[]>();
  for (const image of ctx.db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.ownerType, "task_step"),
        inArray(
          attachments.ownerId,
          rows.map((row) => row.id),
        ),
      ),
    )
    .orderBy(asc(attachments.createdAt), sql`${attachments}.rowid`)
    .all()) {
    images.set(image.ownerId, [...(images.get(image.ownerId) ?? []), image]);
  }
  return rows.map((row) => ({
    id: row.id,
    taskId: row.taskId,
    position: row.position,
    title: row.title,
    body: row.body,
    images: images.get(row.id) ?? [],
  }));
}

/** The steps of a task and where they come from; 404 for a missing task. */
export function getTaskSteps(ctx: Db, taskId: string): TaskStepsRecord {
  const task = ctx.db
    .select({ stepsSource: tasks.stepsSource })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .get();
  if (!task) throw notFound("Task");
  const steps = listSteps(ctx, taskId);
  return {
    steps,
    stepsSource: resolveStepsSource(ctx, task.stepsSource),
    stepCount: steps.length,
  };
}

function storedSource(
  ctx: Db,
  source: NonNullable<PutTaskStepsRequest["source"]>,
): StoredStepsSource {
  if (
    source.attachmentId != null &&
    !findAttachment(ctx, source.attachmentId)
  ) {
    throw invalidField("source", "attachmentId: no such attachment");
  }
  return {
    label: source.label ?? null,
    url: source.url ?? null,
    attachmentId: source.attachmentId ?? null,
    page: source.page ?? null,
  };
}

/**
 * Replaces the steps of a task with the list given, in one transaction. A step with the id of one of this task's steps
 * keeps it (its pictures and creation time stay) and takes the new title, body and place; a step without an id is new;
 * a step of the task that the list leaves out is deleted with its pictures. An id that is no step of this task is a 400
 * on `steps`. `source` left out keeps the source, `null` removes it. The task itself is not touched: it is not
 * re-evaluated and its `updatedAt` (which the calendar feeds read) stays.
 */
export function replaceTaskSteps(
  ctx: Now,
  taskId: string,
  input: PutTaskStepsRequest,
): TaskStepsRecord {
  const task = ctx.db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .get();
  if (!task) throw notFound("Task");
  const source =
    input.source === undefined || input.source === null
      ? input.source
      : storedSource(ctx, input.source);
  const at = new Date(ctx.now);

  const removed = ctx.db.transaction((tx) => {
    const db = { db: tx as unknown as DB };
    const current = new Map(
      tx
        .select()
        .from(taskSteps)
        .where(eq(taskSteps.taskId, taskId))
        .all()
        .map((row) => [row.id, row]),
    );
    for (const step of input.steps) {
      if (step.id !== undefined && !current.has(step.id)) {
        throw invalidField(
          "steps",
          `Step ${step.id} is not a step of this task`,
        );
      }
    }
    const kept = new Set(input.steps.flatMap((step) => step.id ?? []));
    const gone = [...current.keys()].filter((id) => !kept.has(id));
    if (gone.length > 0) {
      tx.delete(taskSteps).where(inArray(taskSteps.id, gone)).run();
    }
    for (const [position, step] of input.steps.entries()) {
      const old = step.id === undefined ? undefined : current.get(step.id);
      if (!old) {
        tx.insert(taskSteps)
          .values({
            taskId,
            position,
            title: step.title,
            body: step.body,
            createdAt: at,
            updatedAt: at,
          })
          .run();
      } else if (
        old.position !== position ||
        old.title !== step.title ||
        old.body !== step.body
      ) {
        tx.update(taskSteps)
          .set({
            position,
            title: step.title,
            body: step.body,
            updatedAt: at,
          })
          .where(eq(taskSteps.id, old.id))
          .run();
      }
    }
    if (source !== undefined) {
      // `updatedAt` is written back as it is: the task did not change, and the calendar feeds read it.
      tx.update(tasks)
        .set({ stepsSource: source, updatedAt: sql`${tasks.updatedAt}` })
        .where(eq(tasks.id, taskId))
        .run();
    }
    return deleteOwnedAttachmentRows(db, "task_step", gone);
  });
  releaseAttachments(ctx, removed);
  return getTaskSteps(ctx, taskId);
}
