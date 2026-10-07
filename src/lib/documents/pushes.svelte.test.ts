import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentUpload } from "$lib/api/schemas/documents";
import { documentLinkChanges } from "./changes.svelte";
import { dismissPush, isActive, pushes, trackPush } from "./pushes.svelte";

const NOW = "2026-10-07T10:00:00.000Z";

function upload(patch: Partial<DocumentUpload> = {}): DocumentUpload {
  return {
    id: "job-1",
    provider: "paperless",
    status: "queued",
    attachmentId: "att-1",
    ownerType: "asset",
    ownerId: "asset-1",
    role: "manual",
    title: "Waschmaschine Anleitung",
    externalId: null,
    linkId: null,
    duplicate: false,
    errorCode: null,
    warning: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
}

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function error(status: number, code: string): Response {
  return answer({ error: { code, message: "x" } }, status);
}

let replies: Array<() => Response>;
let calls: string[];

beforeEach(() => {
  vi.useFakeTimers();
  replies = [];
  calls = [];
  pushes.jobs.splice(0);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      calls.push(input);
      const next = replies.length > 1 ? replies.shift() : replies[0];
      if (!next) throw new Error("no reply prepared");
      return next();
    }),
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("trackPush", () => {
  it("follows a push until it is done and tells the lists of links", async () => {
    replies = [
      () => answer(upload({ status: "processing" })),
      () => answer(upload({ status: "done", externalId: 900, linkId: "l-1" })),
    ];
    const before = documentLinkChanges.version;
    trackPush(upload(), "Waschmaschine Anleitung");
    expect(pushes.jobs).toHaveLength(1);
    expect(isActive(pushes.jobs[0]!)).toBe(true);

    await vi.advanceTimersByTimeAsync(1600);
    expect(pushes.jobs[0]?.status).toBe("processing");
    expect(documentLinkChanges.version).toBe(before);

    await vi.advanceTimersByTimeAsync(3000);
    expect(pushes.jobs[0]?.status).toBe("done");
    expect(documentLinkChanges.version).toBe(before + 1);
    expect(calls.every((url) => url.endsWith("/documents/uploads/job-1"))).toBe(
      true,
    );

    await vi.advanceTimersByTimeAsync(9000);
    expect(pushes.jobs).toHaveLength(0);
  });

  it("keeps a failed push on the list until the person dismisses it", async () => {
    replies = [
      () => answer(upload({ status: "failed", errorCode: "duplicate" })),
    ];
    trackPush(upload(), "Garantieschein");
    await vi.advanceTimersByTimeAsync(1600);
    const job = pushes.jobs[0];
    expect(job?.status).toBe("failed");
    expect(job?.errorCode).toBe("duplicate");

    await vi.advanceTimersByTimeAsync(60_000);
    expect(pushes.jobs).toHaveLength(1);
    dismissPush("job-1");
    expect(pushes.jobs).toHaveLength(0);
  });

  it("stops asking when the server no longer knows the job", async () => {
    replies = [() => error(404, "not_found")];
    trackPush(upload(), "Garantieschein");
    await vi.advanceTimersByTimeAsync(1600);
    expect(pushes.jobs[0]?.status).toBe("unknown");
    const asked = calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toHaveLength(asked);
  });

  it("survives a few failed polls and gives up after too many", async () => {
    replies = [() => error(502, "upstream_error")];
    trackPush(upload(), "Garantieschein");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pushes.jobs[0]?.status).toBe("unknown");
    expect(calls).toHaveLength(5);
  });

  it("does not track the same job twice", () => {
    replies = [() => answer(upload({ status: "processing" }))];
    trackPush(upload(), "A");
    trackPush(upload(), "B");
    expect(pushes.jobs).toHaveLength(1);
    expect(pushes.jobs[0]?.name).toBe("A");
  });
});
