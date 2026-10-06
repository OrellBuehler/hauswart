import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileError } from "./errors";
import {
  DEFAULT_MAX_BYTES,
  defaultFilesRoot,
  deleteIfUnreferenced,
  isValidStorePath,
  openFile,
  pathFor,
  putFile,
} from "./store";
import {
  jpegMarkers,
  plainJpeg,
  plainPng,
  plainWebp,
  pngWithMetadata,
  SECRET_MAKE,
  withExif,
} from "./test-images";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hauswart-files-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function listAll(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listAll(full)));
    else out.push(full);
  }
  return out.sort();
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(FileError);
    return (error as FileError).code;
  }
  throw new Error("expected rejection");
}

const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

describe("putFile: images", () => {
  it("stores a jpeg content-addressed and returns its metadata", async () => {
    const result = await putFile(root, plainJpeg(64, 32), {
      filename: "Küche.jpg",
    });
    expect(result.path).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{64}$/);
    expect(result.path).toBe(`${result.sha256.slice(0, 2)}/${result.sha256}`);
    expect(result.mime).toBe("image/jpeg");
    expect(result.ext).toBe("jpg");
    expect(result.filename).toBe("Küche.jpg");
    expect([result.width, result.height]).toEqual([64, 32]);

    const onDisk = await readFile(join(root, result.path));
    expect(onDisk.length).toBe(result.size);
    expect(sha(onDisk)).toBe(result.sha256);
    expect(isValidStorePath(result.path)).toBe(true);
  });

  it("strips exif/gps before hashing and storing", async () => {
    const source = withExif(plainJpeg(64, 32), 1);
    const result = await putFile(root, source, { filename: "IMG_0001.JPG" });
    const onDisk = await readFile(join(root, result.path));
    expect(onDisk.includes(Buffer.from(SECRET_MAKE))).toBe(false);
    expect(jpegMarkers(onDisk)).not.toContain(0xe1);
    expect(result.sha256).not.toBe(sha(source));
  });

  it("strips png metadata", async () => {
    const result = await putFile(root, pngWithMetadata(plainPng()), {
      filename: "a.png",
    });
    expect(result.mime).toBe("image/png");
    const onDisk = await readFile(join(root, result.path));
    expect(onDisk.includes(Buffer.from("eXIf"))).toBe(false);
    expect(onDisk.includes(Buffer.from("tEXt"))).toBe(false);
  });

  it("stores webp as webp", async () => {
    const result = await putFile(root, plainWebp(), { filename: "a.webp" });
    expect(result.mime).toBe("image/webp");
    expect(result.ext).toBe("webp");
  });

  it("writes a webp thumbnail next to the image", async () => {
    const result = await putFile(root, plainJpeg(1200, 800), {
      filename: "a.jpg",
    });
    expect(result.thumbPath).toBe(`${result.path}.thumb.webp`);
    expect(isValidStorePath(result.thumbPath!)).toBe(true);
    const thumb = await readFile(join(root, result.thumbPath!));
    expect(thumb.subarray(0, 4).toString("latin1")).toBe("RIFF");
    expect(thumb.subarray(8, 12).toString("latin1")).toBe("WEBP");
  });

  it("normalizes the filename extension to the detected type", async () => {
    expect(
      (await putFile(root, plainJpeg(), { filename: "plan.png" })).filename,
    ).toBe("plan.jpg");
    expect(
      (await putFile(root, plainPng(), { filename: "scan.jpeg" })).filename,
    ).toBe("scan.png");
    expect(
      (await putFile(root, plainJpeg(), { filename: "x.jpeg" })).filename,
    ).toBe("x.jpeg");
    expect(
      (await putFile(root, plainJpeg(), { filename: "noext" })).filename,
    ).toBe("noext.jpg");
  });

  it("sanitizes the returned filename", async () => {
    const result = await putFile(root, plainJpeg(), {
      filename: "../../etc/passwd\r\n.jpg",
    });
    expect(result.filename).toBe("passwd.jpg");
  });
});

describe("putFile: pdf", () => {
  it("stores pdfs unchanged without a thumbnail", async () => {
    const result = await putFile(root, pdf, { filename: "Handbuch.pdf" });
    expect(result.mime).toBe("application/pdf");
    expect(result.ext).toBe("pdf");
    expect(result.sha256).toBe(sha(pdf));
    expect(result.size).toBe(pdf.length);
    expect(result.thumbPath).toBeNull();
    expect(result.width).toBeNull();
    expect(Buffer.compare(await readFile(join(root, result.path)), pdf)).toBe(
      0,
    );
    expect(await listAll(root)).toEqual([join(root, result.path)]);
  });
});

describe("putFile: dedupe", () => {
  it("stores identical content once", async () => {
    const a = await putFile(root, pdf, { filename: "a.pdf" });
    const b = await putFile(root, pdf, { filename: "b.pdf" });
    expect(b.sha256).toBe(a.sha256);
    expect(b.path).toBe(a.path);
    expect(b.filename).toBe("b.pdf");
    expect(await listAll(root)).toHaveLength(1);
  });

  it("dedupes images that differ only in metadata", async () => {
    const a = await putFile(root, plainJpeg(48, 24), { filename: "a.jpg" });
    const b = await putFile(root, withExif(plainJpeg(48, 24), 1), {
      filename: "b.jpg",
    });
    expect(b.sha256).toBe(a.sha256);
    expect(await listAll(root)).toHaveLength(2);
  });

  it("does not rewrite an existing file but refreshes its modification time", async () => {
    const first = await putFile(root, pdf, { filename: "a.pdf" });
    const full = join(root, first.path);
    const old = new Date(Date.now() - 3_600_000);
    await utimes(full, old, old);
    await putFile(root, pdf, { filename: "a.pdf" });
    expect(Date.now() - (await stat(full)).mtimeMs).toBeLessThan(60_000);
  });

  it("restores a missing thumbnail on re-upload", async () => {
    const first = await putFile(root, plainJpeg(64, 32), { filename: "a.jpg" });
    await rm(join(root, first.thumbPath!));
    await putFile(root, plainJpeg(64, 32), { filename: "a.jpg" });
    expect((await stat(join(root, first.thumbPath!))).isFile()).toBe(true);
  });

  it("handles parallel uploads of the same content", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        putFile(root, plainJpeg(64, 32), { filename: `${i}.jpg` }),
      ),
    );
    expect(new Set(results.map((r) => r.sha256)).size).toBe(1);
    const files = await listAll(root);
    expect(files).toHaveLength(2);
    expect(files.some((file) => file.endsWith(".tmp"))).toBe(false);
  });

  it("stores different content separately", async () => {
    await putFile(root, pdf, { filename: "a.pdf" });
    await putFile(root, Buffer.concat([pdf, Buffer.from("x")]), {
      filename: "b.pdf",
    });
    expect(await listAll(root)).toHaveLength(2);
  });
});

describe("putFile: rejection leaves nothing behind", () => {
  const cases: [string, Uint8Array, string][] = [
    [
      "svg",
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
      ),
      "unsupported_type",
    ],
    [
      "html",
      Buffer.from("<html><script>alert(1)</script></html>"),
      "unsupported_type",
    ],
    [
      "gif",
      Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;"),
      "unsupported_type",
    ],
    ["text", Buffer.from("hello"), "unsupported_type"],
    ["empty", new Uint8Array(), "empty"],
    [
      "heic",
      Buffer.concat([
        Buffer.from([0, 0, 0, 24]),
        Buffer.from("ftypheic"),
        Buffer.alloc(12),
      ]),
      "unsupported_heic",
    ],
    ["truncated jpeg", plainJpeg().subarray(0, 100), "corrupt_image"],
    [
      "garbage png",
      Buffer.concat([plainPng().subarray(0, 33), Buffer.from("garbage")]),
      "corrupt_image",
    ],
  ];

  for (const [name, bytes, code] of cases) {
    it(`rejects ${name} with ${code}`, async () => {
      expect(await codeOf(putFile(root, bytes, { filename: "x" }))).toBe(code);
      expect(await listAll(root)).toEqual([]);
    });
  }

  it("rejects oversized uploads", async () => {
    expect(
      await codeOf(
        putFile(root, Buffer.alloc(1025, 1), {
          filename: "x.pdf",
          maxBytes: 1024,
        }),
      ),
    ).toBe("too_large");
    expect(DEFAULT_MAX_BYTES).toBe(25 * 1024 * 1024);
    expect(await listAll(root)).toEqual([]);
  });

  it("ignores the declared mime and filename extension when sniffing", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(
      await codeOf(
        putFile(root, svg, {
          filename: "photo.jpg",
          declaredMime: "image/jpeg",
        }),
      ),
    ).toBe("unsupported_type");
    const stored = await putFile(root, plainJpeg(), {
      filename: "evil.html",
      declaredMime: "text/html",
      log: () => {},
    });
    expect(stored.mime).toBe("image/jpeg");
  });

  it("logs a declared mime mismatch without the filename", async () => {
    const log = vi.fn();
    await putFile(root, plainJpeg(), {
      filename: "Geheim Name.jpg",
      declaredMime: "image/png",
      log,
    });
    expect(log).toHaveBeenCalledTimes(1);
    const [, meta] = log.mock.calls[0]!;
    expect(meta).toEqual({ declared: "image/png", detected: "image/jpeg" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("Geheim");
  });

  it("does not log when the declared mime matches or is missing", async () => {
    const log = vi.fn();
    await putFile(root, plainJpeg(), {
      filename: "a.jpg",
      declaredMime: "image/jpeg",
      log,
    });
    await putFile(root, plainJpeg(), {
      filename: "a.jpg",
      declaredMime: "IMAGE/JPEG",
      log,
    });
    await putFile(root, plainJpeg(), { filename: "a.jpg", log });
    expect(log).not.toHaveBeenCalled();
  });
});

describe("putFile: atomicity", () => {
  it("removes the temp file when the final rename fails", async () => {
    const sum = sha(pdf);
    await mkdir(join(root, sum.slice(0, 2), sum), { recursive: true });
    await writeFile(join(root, sum.slice(0, 2), sum, "blocker"), "x");
    await expect(putFile(root, pdf, { filename: "a.pdf" })).rejects.toThrow();
    const files = await listAll(root);
    expect(files).toEqual([join(root, sum.slice(0, 2), sum, "blocker")]);
    expect(files.some((file) => file.endsWith(".tmp"))).toBe(false);
  });

  it("never exposes a partially written file at the final path", async () => {
    const big = Buffer.concat([pdf, Buffer.alloc(2_000_000, 7)]);
    const sum = sha(big);
    const final = join(root, sum.slice(0, 2), sum);
    const pending = putFile(root, big, {
      filename: "big.pdf",
      maxBytes: 5_000_000,
    });
    let done = false;
    pending.finally(() => (done = true));
    while (!done) {
      try {
        const info = await stat(final);
        expect(info.size).toBe(big.length);
      } catch (error) {
        expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
      }
      await new Promise((r) => setTimeout(r, 0));
    }
    await pending;
    expect((await stat(final)).size).toBe(big.length);
  });

  it("fails cleanly when the root cannot be created", async () => {
    const file = join(root, "blocker");
    await writeFile(file, "x");
    await expect(
      putFile(join(file, "sub"), pdf, { filename: "a.pdf" }),
    ).rejects.toThrow();
    expect(await listAll(root)).toEqual([file]);
  });

  it("creates the root and shard directories on demand", async () => {
    const nested = join(root, "a", "b", "files");
    const result = await putFile(nested, pdf, { filename: "a.pdf" });
    expect((await stat(join(nested, result.path))).isFile()).toBe(true);
  });

  it("uses restrictive permissions", async () => {
    const result = await putFile(root, pdf, { filename: "a.pdf" });
    expect((await stat(join(root, result.path))).mode & 0o077).toBe(0);
  });
});

describe("openFile", () => {
  it("returns a Bun file with the stored bytes", async () => {
    const stored = await putFile(root, pdf, { filename: "a.pdf" });
    const file = await openFile(root, stored.path);
    expect(file).not.toBeNull();
    expect(file!.size).toBe(pdf.length);
    expect(Buffer.from(await file!.arrayBuffer()).equals(pdf)).toBe(true);
  });

  it("opens thumbnails", async () => {
    const stored = await putFile(root, plainJpeg(64, 32), {
      filename: "a.jpg",
    });
    const thumb = await openFile(root, stored.thumbPath!);
    expect(thumb).not.toBeNull();
    expect(thumb!.size).toBeGreaterThan(0);
  });

  it("returns null for well-formed paths that do not exist", async () => {
    expect(
      await openFile(
        root,
        `ab/${"a".repeat(64)}`.replace("ab/aaaa", "aa/aaaa"),
      ),
    ).toBeNull();
    expect(
      await openFile(root, `${"0".repeat(2)}/${"0".repeat(64)}`),
    ).toBeNull();
    expect(await openFile(root, `00/${"0".repeat(64)}.thumb.webp`)).toBeNull();
  });

  it("returns null for directories", async () => {
    const sum = "ab" + "c".repeat(62);
    await mkdir(join(root, "ab", sum), { recursive: true });
    expect(await openFile(root, `ab/${sum}`)).toBeNull();
  });

  it("does not follow symlinks out of the store", async () => {
    const secret = join(root, "outside.txt");
    await writeFile(secret, "top secret");
    const sum = "ab" + "d".repeat(62);
    await mkdir(join(root, "store", "ab"), { recursive: true });
    await symlink(secret, join(root, "store", "ab", sum));
    expect(await openFile(join(root, "store"), `ab/${sum}`)).toBeNull();
  });

  const sum = "ab" + "e".repeat(62);
  const hostile = [
    "../etc/passwd",
    "../../etc/passwd",
    "/etc/passwd",
    "ab/../../etc/passwd",
    `ab/../ab/${sum}`,
    `ab/${sum}/../${sum}`,
    `./ab/${sum}`,
    `ab//${sum}`,
    `/ab/${sum}`,
    `ab/${sum}/`,
    `ab\\${sum}`,
    `..\\ab\\${sum}`,
    `%2e%2e/ab/${sum}`,
    `ab/%2e%2e/${sum}`,
    `ab/${sum}%00`,
    `ab/${sum}\0`,
    `ab/${sum}\n`,
    `ab/${sum}.thumb.webp\n`,
    `AB/${sum.toUpperCase()}`,
    `ab/${sum.slice(1)}`,
    `ab/${sum}0`,
    `abc/${sum}`,
    `a/${sum}`,
    `cd/${sum}`,
    `ab/${sum}.tmp`,
    `ab/${sum}.thumb.webp.bak`,
    `ab/${sum}.thumb.jpg`,
    `ab/${sum}.png`,
    `ab/${sum}.`,
    "ab/",
    "ab",
    "",
    " ",
    `ab/${"g".repeat(64)}`,
    `ab/${sum} `,
    ` ab/${sum}`,
    `file:///etc/passwd`,
    `C:\\Windows\\win.ini`,
    `ab/${sum}?x=1`,
    `ab/${sum}#x`,
  ];

  for (const path of hostile) {
    it(`rejects ${JSON.stringify(path)}`, async () => {
      expect(isValidStorePath(path)).toBe(false);
      expect(await codeOf(openFile(root, path))).toBe("invalid_path");
    });
  }

  it("accepts exactly the documented shapes", () => {
    expect(isValidStorePath(`ab/${sum}`)).toBe(true);
    expect(isValidStorePath(`ab/${sum}.thumb.webp`)).toBe(true);
  });
});

describe("deleteIfUnreferenced", () => {
  it("keeps referenced files", async () => {
    const stored = await putFile(root, plainJpeg(64, 32), {
      filename: "a.jpg",
    });
    const deleted = await deleteIfUnreferenced(
      root,
      stored.sha256,
      () => true,
      { minAgeMs: 0 },
    );
    expect(deleted).toBe(false);
    expect(await listAll(root)).toHaveLength(2);
  });

  it("deletes unreferenced files and their thumbnail", async () => {
    const stored = await putFile(root, plainJpeg(64, 32), {
      filename: "a.jpg",
    });
    const predicate = vi.fn(() => false);
    expect(
      await deleteIfUnreferenced(root, stored.sha256, predicate, {
        minAgeMs: 0,
      }),
    ).toBe(true);
    expect(predicate).toHaveBeenCalledWith(stored.sha256);
    expect(await listAll(root)).toEqual([]);
  });

  it("supports async predicates", async () => {
    const stored = await putFile(root, pdf, { filename: "a.pdf" });
    expect(
      await deleteIfUnreferenced(root, stored.sha256, async () => true, {
        minAgeMs: 0,
      }),
    ).toBe(false);
    expect(
      await deleteIfUnreferenced(root, stored.sha256, async () => false, {
        minAgeMs: 0,
      }),
    ).toBe(true);
    expect(await listAll(root)).toEqual([]);
  });

  it("does not delete files younger than minAgeMs and does not ask the predicate", async () => {
    const stored = await putFile(root, pdf, { filename: "a.pdf" });
    const predicate = vi.fn(() => false);
    expect(await deleteIfUnreferenced(root, stored.sha256, predicate)).toBe(
      false,
    );
    expect(predicate).not.toHaveBeenCalled();
    expect(
      await deleteIfUnreferenced(root, stored.sha256, predicate, {
        now: Date.now() + 120_000,
      }),
    ).toBe(true);
  });

  it("a re-upload protects a file from a concurrent sweep", async () => {
    const stored = await putFile(root, pdf, { filename: "a.pdf" });
    const old = new Date(Date.now() - 3_600_000);
    await utimes(join(root, stored.path), old, old);
    await putFile(root, pdf, { filename: "again.pdf" });
    expect(await deleteIfUnreferenced(root, stored.sha256, () => false)).toBe(
      false,
    );
  });

  it("returns false for files that do not exist", async () => {
    expect(
      await deleteIfUnreferenced(root, "a".repeat(64), () => false, {
        minAgeMs: 0,
      }),
    ).toBe(false);
  });

  it("works for pdfs without thumbnails", async () => {
    const stored = await putFile(root, pdf, { filename: "a.pdf" });
    expect(
      await deleteIfUnreferenced(root, stored.sha256, () => false, {
        minAgeMs: 0,
      }),
    ).toBe(true);
  });

  it("rejects anything that is not a sha256", async () => {
    for (const bad of [
      "../x",
      "ab",
      "A".repeat(64),
      `${"a".repeat(63)}/`,
      "a".repeat(64) + "\n",
    ]) {
      expect(
        await codeOf(
          deleteIfUnreferenced(root, bad, () => false, { minAgeMs: 0 }),
        ),
      ).toBe("invalid_path");
    }
  });
});

describe("helpers", () => {
  it("pathFor builds shard paths and validates the hash", () => {
    const sum = "0f" + "a".repeat(62);
    expect(pathFor(sum)).toBe(`0f/${sum}`);
    expect(() => pathFor("nope")).toThrow(FileError);
  });

  it("defaultFilesRoot reads HAUSWART_FILES_DIR and defaults to ./data/files", () => {
    expect(defaultFilesRoot({ HAUSWART_FILES_DIR: "/srv/files" })).toBe(
      "/srv/files",
    );
    expect(defaultFilesRoot({})).toBe(join(process.cwd(), "data", "files"));
    expect(defaultFilesRoot({ HAUSWART_FILES_DIR: "" })).toBe(
      join(process.cwd(), "data", "files"),
    );
  });
});
