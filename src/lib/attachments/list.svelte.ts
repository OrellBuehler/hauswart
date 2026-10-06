import { api } from "$lib/api/browser";
import { fetchAll } from "$lib/api/fetch-all";
import type { AttachmentOwnerType } from "$lib/api/enums";
import { isApiError } from "$lib/api/errors";
import { endpoints } from "$lib/api/registry";
import type {
  Attachment,
  UpdateAttachmentRequest,
} from "$lib/api/schemas/attachments";
import { apiErrorMessage } from "$lib/error-message";
import { m } from "$lib/paraglide/messages";
import {
  DEFAULT_ACCEPT,
  MAX_ATTACHMENT_BYTES,
  isHeic,
  matchesAccept,
} from "./files";
import { uploadErrorMessage } from "./errors";
import { uploadAttachment } from "./upload";

export interface UploadJob {
  id: number;
  file: File;
  name: string;
  size: number;
  /** Object URL of an image while it uploads. */
  previewUrl: string | null;
  progress: number;
  status: "uploading" | "error";
  error?: string | undefined;
  /** An error that trying again can fix (network, server, rate limit) rather than a refused file. */
  retryable: boolean;
}

export interface UploadOptions {
  caption?: string | undefined;
  guestVisible?: boolean | undefined;
}

const PARALLEL_UPLOADS = 2;

/**
 * The attachments of one owner: the list, the uploads in flight and the edits. The attachments
 * component creates one itself; the page editor creates its own to upload pasted and dropped
 * images and hands it to the component to show them.
 */
export class AttachmentList {
  items = $state.raw<Attachment[]>([]);
  phase = $state<"idle" | "loading" | "ready" | "error">("idle");
  loadError = $state<string | undefined>();
  jobs = $state<UploadJob[]>([]);

  readonly ownerType: AttachmentOwnerType;
  readonly ownerId: string;
  private readonly accept: string;
  private readonly onchange: (() => void) | undefined;
  private nextJob = 1;
  private generation = 0;

  constructor(
    ownerType: AttachmentOwnerType,
    ownerId: string,
    options: { accept?: string; onchange?: () => void } = {},
  ) {
    this.ownerType = ownerType;
    this.ownerId = ownerId;
    this.accept = options.accept ?? DEFAULT_ACCEPT;
    this.onchange = options.onchange;
  }

  get uploading(): boolean {
    return this.jobs.some((job) => job.status === "uploading");
  }

  async load(): Promise<void> {
    const current = ++this.generation;
    this.phase = "loading";
    this.loadError = undefined;
    try {
      const items = await fetchAll((cursor) =>
        api.call(endpoints.attachmentsList, {
          query: {
            ownerType: this.ownerType,
            ownerId: this.ownerId,
            limit: 200,
            ...(cursor ? { cursor } : {}),
          },
        }),
      );
      if (current !== this.generation) return;
      this.items = items;
      this.phase = "ready";
    } catch (err) {
      if (current !== this.generation) return;
      this.loadError = apiErrorMessage(err);
      this.phase = "error";
    }
  }

  private check(file: File): string | undefined {
    if (isHeic(file)) return m.attach_error_heic();
    if (!matchesAccept(file, this.accept)) {
      return m.attach_error_unsupported_type();
    }
    if (file.size === 0) return m.attach_error_empty();
    if (file.size > MAX_ATTACHMENT_BYTES) return m.attach_error_too_large();
    return undefined;
  }

  private newJob(file: File): UploadJob {
    const problem = this.check(file);
    return {
      id: this.nextJob++,
      file,
      name: file.name,
      size: file.size,
      previewUrl:
        !problem && file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : null,
      progress: 0,
      status: problem ? "error" : "uploading",
      error: problem,
      retryable: false,
    };
  }

  private release(job: UploadJob) {
    if (job.previewUrl) URL.revokeObjectURL(job.previewUrl);
  }

  private patchJob(id: number, patch: Partial<UploadJob>) {
    this.jobs = this.jobs.map((job) =>
      job.id === id ? { ...job, ...patch } : job,
    );
  }

  private async run(
    job: UploadJob,
    options: UploadOptions,
  ): Promise<Attachment | undefined> {
    this.patchJob(job.id, {
      status: "uploading",
      progress: 0,
      error: undefined,
    });
    try {
      const attachment = await uploadAttachment(
        {
          file: job.file,
          ownerType: this.ownerType,
          ownerId: this.ownerId,
          caption: options.caption,
          guestVisible: options.guestVisible,
        },
        (progress) => this.patchJob(job.id, { progress }),
      );
      this.items = [...this.items, attachment];
      this.release(job);
      this.jobs = this.jobs.filter((j) => j.id !== job.id);
      this.onchange?.();
      return attachment;
    } catch (err) {
      this.patchJob(job.id, {
        status: "error",
        error: uploadErrorMessage(err),
        retryable:
          isApiError(err) &&
          (err.status === 0 || err.status === 429 || err.status >= 500),
      });
      return undefined;
    }
  }

  /** Uploads the files (two at a time) and resolves with the attachments that were stored, in order. */
  async upload(
    files: File[],
    options: UploadOptions = {},
  ): Promise<Attachment[]> {
    const jobs = files.map((file) => this.newJob(file));
    this.jobs = [...this.jobs, ...jobs];
    const results: (Attachment | undefined)[] = new Array(jobs.length);
    const queue = jobs.map((job, index) => ({ job, index }));
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        if (next.job.status === "error") continue;
        results[next.index] = await this.run(next.job, options);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(PARALLEL_UPLOADS, jobs.length) }, worker),
    );
    return results.filter((a): a is Attachment => a !== undefined);
  }

  async retry(id: number, options: UploadOptions = {}): Promise<void> {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return;
    const problem = this.check(job.file);
    if (problem) {
      this.patchJob(id, { error: problem });
      return;
    }
    await this.run(job, options);
  }

  dismiss(id: number) {
    const job = this.jobs.find((j) => j.id === id);
    if (job) this.release(job);
    this.jobs = this.jobs.filter((j) => j.id !== id);
  }

  async update(id: string, body: UpdateAttachmentRequest): Promise<Attachment> {
    const next = await api.call(endpoints.attachmentsUpdate, {
      params: { id },
      body,
    });
    this.items = this.items.map((item) => (item.id === id ? next : item));
    this.onchange?.();
    return next;
  }

  async remove(id: string): Promise<void> {
    await api.call(endpoints.attachmentsDelete, { params: { id } });
    this.items = this.items.filter((item) => item.id !== id);
    this.onchange?.();
  }

  destroy() {
    this.generation += 1;
    for (const job of this.jobs) this.release(job);
  }
}
