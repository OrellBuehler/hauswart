import {
  headingsOfSegments,
  plainTextOfSegments,
  renderSegments,
  type MarkdownJob,
  type MarkdownJobResult,
} from "./markdown-core";

/**
 * Worker entry: runs the marked pipeline for one job at a time. It only ever sees markdown that
 * has already been stripped of secret blocks by the main thread. Imports stay relative: the
 * worker is bundled on its own for the production build (scripts/build-markdown-worker.ts).
 */
const scope = globalThis as unknown as {
  onmessage: ((event: { data: MarkdownJob }) => void) | null;
  postMessage(message: MarkdownJobResult): void;
};

function run(job: MarkdownJob): unknown {
  switch (job.op) {
    case "render":
      return renderSegments(job.segments, job.nonce);
    case "text":
      return plainTextOfSegments(job.segments);
    case "headings":
      return headingsOfSegments(job.segments);
  }
}

scope.onmessage = (event) => {
  try {
    scope.postMessage({ ok: true, result: run(event.data) });
  } catch (error) {
    scope.postMessage({
      ok: false,
      error: error instanceof Error ? error.name : "Error",
    });
  }
};
