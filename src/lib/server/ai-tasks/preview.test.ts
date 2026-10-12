import { rm } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { attachments } from "$lib/server/db";
import { plainJpeg, plainPng } from "$lib/server/files/test-images";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt } from "$lib/testing/domain";
import { samplePdf, useTestFilesDir } from "$lib/testing/files";
import { failure } from "$lib/testing/vehicles";
import { createAiTask } from "./ai-tasks";
import { taskPreview } from "./preview";

describe("the file of a task, sized for an assistant", () => {
  const test = useTestDB();
  const files = useTestFilesDir();
  const ctx = () => ctxAt(test.db);

  async function queue(bytes: Uint8Array, filename: string, mime: string) {
    const anna = await createTestUser();
    return createAiTask(
      ctx(),
      { kind: "receipt", bytes, filename, declaredMime: mime },
      anna.id,
    );
  }

  it("returns an image that is small enough exactly as stored", async () => {
    const task = await queue(plainPng(64, 48), "beleg.png", "image/png");
    const out = await taskPreview(ctx(), task.id);
    expect(out).toMatchObject({
      mime: "image/png",
      filename: "beleg.png",
      scaled: false,
      etag: `"${task.attachment!.sha256}"`,
    });
    const stored = await Bun.file(
      join(files.dir, task.attachment!.path),
    ).bytes();
    expect(Buffer.from(out.bytes).equals(Buffer.from(stored))).toBe(true);
  });

  it("scales a large image down to JPEG, renames it and gives the copy its own etag", async () => {
    const task = await queue(plainJpeg(3200, 2400), "foto.jpeg", "image/jpeg");
    const out = await taskPreview(ctx(), task.id);
    expect(out).toMatchObject({
      mime: "image/jpeg",
      filename: "foto.jpeg",
      scaled: true,
      etag: `"${task.attachment!.sha256}-preview"`,
    });
    expect(out.bytes.byteLength).toBeLessThan(task.attachment!.size);
  });

  it("gives a scaled copy of a PNG a .jpg name", async () => {
    const task = await queue(plainPng(3200, 2400), "foto.png", "image/png");
    expect((await taskPreview(ctx(), task.id)).filename).toBe("foto.jpg");
  });

  it("returns a PDF as stored", async () => {
    const task = await queue(samplePdf(), "rechnung.pdf", "application/pdf");
    const out = await taskPreview(ctx(), task.id);
    expect(out).toMatchObject({ mime: "application/pdf", scaled: false });
    expect(Buffer.from(out.bytes).equals(samplePdf())).toBe(true);
  });

  it("is a 404 when the task has no file, or the stored file is gone (logged by id only)", async () => {
    const task = await queue(plainPng(), "beleg.png", "image/png");
    await rm(join(files.dir, task.attachment!.path));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await failure(() => taskPreview(ctx(), task.id))).code).toBe(
      "not_found",
    );
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toBe(
      JSON.stringify({ event: "ai_tasks.file_missing", id: task.attachmentId }),
    );
    error.mockRestore();
    test.db
      .delete(attachments)
      .where(eq(attachments.id, task.attachmentId!))
      .run();
    expect((await failure(() => taskPreview(ctx(), task.id))).code).toBe(
      "not_found",
    );
    expect((await failure(() => taskPreview(ctx(), "missing"))).code).toBe(
      "not_found",
    );
  });
});
