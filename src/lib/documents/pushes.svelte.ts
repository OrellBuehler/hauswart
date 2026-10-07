import { toast } from "svelte-sonner";
import { api } from "$lib/api/browser";
import type {
  DocumentLinkOwnerType,
  DocumentProviderKind,
} from "$lib/api/enums";
import { isApiError } from "$lib/api/errors";
import { endpoints } from "$lib/api/registry";
import type { DocumentUpload } from "$lib/api/schemas/documents";
import { integrationErrorMessage } from "$lib/connections/errors";
import { m } from "$lib/paraglide/messages";
import { documentLinksChanged } from "./changes.svelte";

/** `unknown`: the browser lost track of the job (the server keeps working on it). */
export interface PushJob {
  id: string;
  provider: DocumentProviderKind;
  attachmentId: string;
  ownerType: DocumentLinkOwnerType;
  ownerId: string;
  /** What the person calls it: the title of the new document. */
  name: string;
  status: DocumentUpload["status"] | "unknown";
  errorCode: string | null;
  warning: string | null;
  duplicate: boolean;
}

/** The pushes started in this tab. They live here, not in a component, so leaving the page does not lose them. */
export const pushes = $state<{ jobs: PushJob[] }>({ jobs: [] });

const FIRST_POLL_MS = 1500;
const MAX_POLL_MS = 4000;
/** The server waits 10 minutes for the document system; a little longer here. */
const GIVE_UP_MS = 12 * 60 * 1000;
const MAX_FAILED_POLLS = 5;
const DONE_VISIBLE_MS = 8000;

export function isActive(job: Pick<PushJob, "status">): boolean {
  return (
    job.status === "queued" ||
    job.status === "uploading" ||
    job.status === "processing"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function find(id: string): PushJob | undefined {
  return pushes.jobs.find((job) => job.id === id);
}

function apply(upload: DocumentUpload): PushJob | undefined {
  const job = find(upload.id);
  if (!job) return undefined;
  job.status = upload.status;
  job.errorCode = upload.errorCode;
  job.warning = upload.warning;
  job.duplicate = upload.duplicate;
  return job;
}

/** Why a push failed, in words: the document system's own codes plus a few of the job's. */
export function pushErrorMessage(
  code: string | null,
  provider: DocumentProviderKind,
): string {
  return integrationErrorMessage(code, provider);
}

function announce(job: PushJob): void {
  if (job.status === "done") {
    documentLinksChanged();
    toast.success(
      job.duplicate
        ? m.document_push_done_duplicate({ name: job.name })
        : m.document_push_done({ name: job.name }),
    );
    if (job.warning === "permissions_failed") {
      toast.warning(m.document_push_permissions_failed());
    }
    setTimeout(() => dismissPush(job.id), DONE_VISIBLE_MS);
  } else if (job.status === "failed") {
    toast.error(
      m.document_push_failed({
        name: job.name,
        reason: pushErrorMessage(job.errorCode, job.provider),
      }),
    );
  }
}

async function poll(id: string): Promise<void> {
  const started = Date.now();
  let delay = FIRST_POLL_MS;
  let failedPolls = 0;
  for (;;) {
    await sleep(delay);
    if (!find(id)) return;
    try {
      const upload = await api.call(endpoints.documentUploadsGet, {
        params: { jobId: id },
      });
      failedPolls = 0;
      const job = apply(upload);
      if (!job) return;
      if (!isActive(job)) {
        announce(job);
        return;
      }
    } catch (err) {
      failedPolls += 1;
      const gone = isApiError(err) && err.status === 404;
      if (gone || failedPolls >= MAX_FAILED_POLLS) {
        console.warn("push status unavailable", err);
        giveUp(id);
        return;
      }
    }
    if (Date.now() - started > GIVE_UP_MS) {
      giveUp(id);
      return;
    }
    delay = Math.min(Math.round(delay * 1.4), MAX_POLL_MS);
  }
}

function giveUp(id: string): void {
  const job = find(id);
  if (!job) return;
  job.status = "unknown";
  toast.warning(m.document_push_unknown({ name: job.name }));
}

/** Follows a push the server accepted until it is done or has failed, and tells the person. */
export function trackPush(upload: DocumentUpload, name: string): void {
  if (find(upload.id)) return;
  pushes.jobs.push({
    id: upload.id,
    provider: upload.provider,
    attachmentId: upload.attachmentId,
    ownerType: upload.ownerType,
    ownerId: upload.ownerId,
    name,
    status: upload.status,
    errorCode: upload.errorCode,
    warning: upload.warning,
    duplicate: upload.duplicate,
  });
  if (!isActive(upload)) {
    const job = find(upload.id);
    if (job) announce(job);
    return;
  }
  void poll(upload.id);
}

export function dismissPush(id: string): void {
  const index = pushes.jobs.findIndex((job) => job.id === id);
  if (index >= 0) pushes.jobs.splice(index, 1);
}
