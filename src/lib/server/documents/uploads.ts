import { and, eq, inArray, lt } from "drizzle-orm";
import {
  DOCUMENT_LINK_OWNER_TYPES,
  type DocumentLinkOwnerType,
} from "$lib/api/enums";
import { ApiError } from "$lib/api/errors";
import type { PushToDocumentsRequest } from "$lib/api/schemas/documents";
import {
  getAttachment,
  openAttachmentFile,
  trackBackground,
  type AttachmentRecord,
} from "$lib/server/attachments/attachments";
import { getDB, documentUploads } from "$lib/server/db";
import { IntegrationError } from "$lib/server/connections/errors";
import {
  invalidField,
  notFound,
  type ServiceContext,
} from "$lib/server/service";
import { createLink, findLinkByKey } from "./links";
import { documentSession, viaProvider } from "./session";

type Db = Pick<ServiceContext, "db">;
type Now = Pick<ServiceContext, "db" | "now">;

export type UploadRow = typeof documentUploads.$inferSelect;

const ACTIVE = ["queued", "uploading", "processing"] as const;

const isLinkOwner = (type: string): type is DocumentLinkOwnerType =>
  (DOCUMENT_LINK_OWNER_TYPES as readonly string[]).includes(type);

const titleOf = (attachment: AttachmentRecord): string =>
  attachment.filename.replace(/\.[^./\\]{1,10}$/, "").slice(0, 128) ||
  "Dokument";

/** A person's own job; anybody else's is a 404. */
export function getUpload(ctx: Db, userId: string, jobId: string): UploadRow {
  const row = ctx.db
    .select()
    .from(documentUploads)
    .where(
      and(eq(documentUploads.id, jobId), eq(documentUploads.userId, userId)),
    )
    .get();
  if (!row) throw notFound("Upload");
  return row;
}

/**
 * Starts pushing an attachment into the caller's own document connection. Returns the queued
 * job at once; the work runs in the background (`runUpload`) and the person polls the job. A job
 * for the same attachment that is still running is returned instead of a second one.
 */
export function startPush(
  ctx: Now,
  userId: string,
  attachmentId: string,
  input: PushToDocumentsRequest,
): UploadRow {
  const attachment = getAttachment(ctx, attachmentId);
  if (!isLinkOwner(attachment.ownerType)) {
    throw invalidField(
      "ownerType",
      "A document cannot be linked to the owner of this attachment",
    );
  }
  const session = documentSession(ctx, input.provider, userId);
  const running = ctx.db
    .select()
    .from(documentUploads)
    .where(
      and(
        eq(documentUploads.connectionId, session.row.id),
        eq(documentUploads.attachmentId, attachmentId),
        inArray(documentUploads.status, [...ACTIVE]),
      ),
    )
    .get();
  if (running) return running;
  const job = ctx.db
    .insert(documentUploads)
    .values({
      provider: input.provider,
      connectionId: session.row.id,
      userId,
      attachmentId,
      ownerType: attachment.ownerType,
      ownerId: attachment.ownerId,
      role: input.role,
      label: input.label ?? null,
      title: input.title ?? titleOf(attachment),
      status: "queued",
    })
    .returning()
    .get();
  trackBackground(runUpload(job.id), "documents.upload_failed");
  return job;
}

const codeOf = (err: unknown): string => {
  if (err instanceof IntegrationError) return err.code;
  if (err instanceof ApiError) {
    const code = (err.details as { code?: unknown } | undefined)?.code;
    return typeof code === "string" ? code : err.code;
  }
  return "internal";
};

function update(jobId: string, patch: Partial<UploadRow>): UploadRow {
  return getDB()
    .update(documentUploads)
    .set(patch)
    .where(eq(documentUploads.id, jobId))
    .returning()
    .get();
}

function fail(jobId: string, err: unknown): void {
  const code = codeOf(err);
  // The short code only: messages can carry addresses, bodies never reach them.
  console.error(JSON.stringify({ event: "documents.upload_failed", code }));
  update(jobId, { status: "failed", errorCode: code });
}

/** Runs one job from wherever it stands (a fresh one, or one resumed at `processing` after a restart). */
export async function runUpload(jobId: string): Promise<void> {
  const job = getDB()
    .select()
    .from(documentUploads)
    .where(eq(documentUploads.id, jobId))
    .get();
  if (!job || job.status === "done" || job.status === "failed") return;
  const ctx = (): Now => ({ db: getDB(), now: Date.now() });
  try {
    const session = documentSession(ctx(), job.provider, job.userId);
    let taskId = job.taskId;
    if (!taskId) {
      update(job.id, { status: "uploading" });
      const attachment = getAttachment(ctx(), job.attachmentId);
      const file = await openAttachmentFile(attachment, "content");
      if (!file) {
        throw new IntegrationError("file_missing", "The file is gone.");
      }
      taskId = await viaProvider(async () =>
        session.provider.startUpload(session.connection, {
          bytes: new Uint8Array(await file.arrayBuffer()),
          filename: attachment.filename,
          contentType: attachment.mime,
          title: job.title,
        }),
      );
      update(job.id, { status: "processing", taskId });
    }
    const outcome = await viaProvider(() =>
      session.provider.awaitUpload(session.connection, taskId as string),
    );
    let externalId: number;
    let duplicate = false;
    let warning: string | null = null;
    if (outcome.status === "duplicate") {
      if (outcome.duplicateOf === null) {
        throw new IntegrationError("duplicate", "The file already exists.");
      }
      externalId = outcome.duplicateOf;
      duplicate = true;
    } else {
      externalId = outcome.externalId;
      update(job.id, { externalId });
      try {
        await viaProvider(() =>
          session.provider.shareUploaded(session.connection, externalId),
        );
      } catch (err) {
        console.error(
          JSON.stringify({
            event: "documents.share_failed",
            code: codeOf(err),
          }),
        );
        warning = "permissions_failed";
      }
    }
    const linkInput = {
      provider: job.provider,
      externalId,
      ownerType: job.ownerType,
      ownerId: job.ownerId,
      role: job.role,
      label: job.label,
    };
    let linkId: string;
    try {
      linkId = (await createLink(ctx(), job.userId, linkInput)).id;
    } catch (err) {
      const existing =
        err instanceof ApiError && err.code === "conflict"
          ? findLinkByKey(ctx(), linkInput)
          : undefined;
      if (existing) {
        // The same document is already linked there: nothing more to do.
        linkId = existing.id;
      } else if (
        duplicate &&
        err instanceof ApiError &&
        err.code === "not_found"
      ) {
        // A document the provider already held may be one this account cannot read.
        throw new IntegrationError("duplicate", "The file already exists.");
      } else {
        throw err;
      }
    }
    update(job.id, {
      status: "done",
      externalId,
      linkId,
      duplicate,
      warning,
    });
  } catch (err) {
    fail(job.id, err);
  }
}

/**
 * At startup: a job that was waiting for the provider's consumption task is picked up again; one
 * that had not handed its file over (or was interrupted while doing so) is failed as
 * `interrupted`, the person pushes again (the provider recognises a file it already holds).
 */
export function resumeUploads(): void {
  const db = getDB();
  for (const job of db
    .select()
    .from(documentUploads)
    .where(inArray(documentUploads.status, [...ACTIVE]))
    .all()) {
    if (job.status === "processing" && job.taskId) {
      trackBackground(runUpload(job.id), "documents.upload_failed");
    } else {
      update(job.id, { status: "failed", errorCode: "interrupted" });
    }
  }
}

const KEEP_FINISHED_MS = 30 * 24 * 60 * 60 * 1000;

/** Housekeeping: finished jobs are only kept for a month, so a person can still look up what became of a push. */
export function pruneFinishedUploads(ctx: Now): number {
  return ctx.db
    .delete(documentUploads)
    .where(
      and(
        inArray(documentUploads.status, ["done", "failed"]),
        lt(documentUploads.updatedAt, new Date(ctx.now - KEEP_FINISHED_MS)),
      ),
    )
    .returning({ id: documentUploads.id })
    .all().length;
}
