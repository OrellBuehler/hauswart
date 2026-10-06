import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  MarkdownError,
  type MarkdownJob,
  type MarkdownJobResult,
} from "./markdown-core";

/** A job that runs longer than this is abandoned and its worker terminated. */
export const RENDER_TIMEOUT_MS = 2000;
export const WORKER_POOL_SIZE = 2;
/** Jobs waiting for a free worker; beyond this callers get `MarkdownError('unavailable')`. */
export const MAX_QUEUED_JOBS = 32;

interface Pending {
  job: MarkdownJob;
  timeoutMs: number;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

interface Slot {
  worker: Worker | null;
  busy: boolean;
}

const slots: Slot[] = Array.from({ length: WORKER_POOL_SIZE }, () => ({
  worker: null,
  busy: false,
}));
const queue: Pending[] = [];

/**
 * Source checkout and tests run the TypeScript worker next to this file; the production build
 * ships a bundled copy (`bun run build` writes build/server/markdown.worker.js).
 */
const WORKER_CANDIDATES = [
  "./markdown.worker.ts",
  "../markdown.worker.js",
  "./markdown.worker.js",
];

let workerUrl: URL | null | undefined;

function locateWorker(): URL | null {
  if (workerUrl !== undefined) return workerUrl;
  workerUrl =
    WORKER_CANDIDATES.map((path) => new URL(path, import.meta.url)).find(
      (url) => existsSync(fileURLToPath(url)),
    ) ?? null;
  if (!workerUrl) {
    console.error(
      JSON.stringify({
        event: "markdown.worker_missing",
        candidates: WORKER_CANDIDATES,
      }),
    );
  }
  return workerUrl;
}

function spawn(): Worker | null {
  const url = locateWorker();
  if (!url) return null;
  const worker = new Worker(url);
  // Bun extension: an idle worker must not keep the process alive.
  (worker as unknown as { unref(): void }).unref();
  return worker;
}

function discard(slot: Slot): void {
  slot.worker?.terminate();
  slot.worker = null;
}

function dispatch(slot: Slot, pending: Pending): void {
  slot.busy = true;
  const worker = (slot.worker ??= spawn());
  if (!worker) {
    slot.busy = false;
    pending.reject(new MarkdownError("unavailable"));
    return;
  }
  let settled = false;
  const finish = (action: () => void, broken: boolean) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (broken) discard(slot);
    else {
      worker.onmessage = null;
      worker.onerror = null;
    }
    slot.busy = false;
    action();
    pump();
  };
  const timer = setTimeout(
    () => finish(() => pending.reject(new MarkdownError("too_complex")), true),
    pending.timeoutMs,
  );
  worker.onmessage = (event: MessageEvent<MarkdownJobResult>) => {
    const message = event.data;
    if (message.ok) finish(() => pending.resolve(message.result), false);
    else finish(() => pending.reject(new MarkdownError("unavailable")), false);
  };
  worker.onerror = (event: ErrorEvent) => {
    event.preventDefault?.();
    finish(() => pending.reject(new MarkdownError("unavailable")), true);
  };
  worker.postMessage(pending.job);
}

function pump(): void {
  for (const slot of slots) {
    if (queue.length === 0) return;
    if (!slot.busy) dispatch(slot, queue.shift()!);
  }
}

/**
 * Runs a job in a pooled worker thread. A job that exceeds `timeoutMs` is abandoned: its worker
 * is terminated (a fresh one is started for the next job) and the call rejects with
 * `MarkdownError('too_complex')`.
 */
export function runMarkdownJob<T>(
  job: MarkdownJob,
  timeoutMs: number = RENDER_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (queue.length >= MAX_QUEUED_JOBS) {
      reject(new MarkdownError("unavailable", "Markdown renderer is busy"));
      return;
    }
    queue.push({
      job,
      timeoutMs,
      resolve: resolve as (result: unknown) => void,
      reject,
    });
    pump();
  });
}

/** Test hook: stop all workers. */
export function shutdownMarkdownWorkers(): void {
  for (const slot of slots) discard(slot);
}
