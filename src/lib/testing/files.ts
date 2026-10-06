import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { settleBackgroundWork } from "$lib/server/attachments/attachments";

/**
 * Call once at the top level of a test file: every test gets an empty temporary directory as
 * `HAUSWART_FILES_DIR` (the default of every file service), removed afterwards. Pending sweeps and
 * re-renders are awaited first so they never touch the next test's directory.
 */
export function useTestFilesDir(): { readonly dir: string } {
  let current: string | null = null;
  let previous: string | undefined;
  beforeEach(async () => {
    previous = process.env.HAUSWART_FILES_DIR;
    current = await mkdtemp(join(tmpdir(), "hauswart-test-files-"));
    process.env.HAUSWART_FILES_DIR = current;
  });
  afterEach(async () => {
    await settleBackgroundWork();
    if (previous === undefined) delete process.env.HAUSWART_FILES_DIR;
    else process.env.HAUSWART_FILES_DIR = previous;
    if (current) await rm(current, { recursive: true, force: true });
    current = null;
  });
  return {
    get dir() {
      if (!current)
        throw new Error("useTestFilesDir: no directory outside a test");
      return current;
    },
  };
}

/** Small synthetic files for upload tests. */
export const samplePdf = (): Buffer =>
  Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
export const sampleSvg = (): Buffer =>
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
export const sampleHtml = (): Buffer =>
  Buffer.from("<!doctype html><script>alert(1)</script>");
/** An ISO base media `ftyp` box with the `heic` brand: enough for the type sniffer. */
export const sampleHeic = (): Buffer =>
  Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from("ftypheic"),
    Buffer.alloc(4),
    Buffer.from("mif1heic"),
  ]);
