import { Database } from "bun:sqlite";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import {
  DEFAULT_BACKUP_DIR,
  DEFAULT_KEEP,
  backupFileName,
  isBackupDue,
  listBackups,
  mirrorFiles,
  pruneBackups,
  readBackupConfig,
  runScheduledBackup,
  startBackupScheduler,
  writeBackup,
} from "./backup";

const ctx = useTestDB();
let dir: string;
let files: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hauswart-backup-test-"));
  files = mkdtempSync(join(tmpdir(), "hauswart-backup-files-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
  rmSync(files, { recursive: true, force: true });
});

const at = (iso: string) => new Date(iso);
const sha = (c: string) => c.repeat(64);

function store(name: string, content: string) {
  const shard = name.slice(0, 2);
  mkdirSync(join(files, shard), { recursive: true });
  writeFileSync(join(files, shard, name), content);
}

describe("backupFileName", () => {
  it("is a sortable UTC timestamp", () => {
    expect(backupFileName(at("2026-03-04T05:06:07Z"))).toBe(
      "hauswart-backup-20260304-050607.db",
    );
  });
});

describe("readBackupConfig", () => {
  it("is on by default with the documented defaults", () => {
    expect(readBackupConfig({})).toEqual({
      dir: DEFAULT_BACKUP_DIR,
      keep: DEFAULT_KEEP,
    });
    expect(DEFAULT_BACKUP_DIR).toBe("./data/backups");
    expect(DEFAULT_KEEP).toBe(14);
  });

  it("reads the directory and the count", () => {
    expect(
      readBackupConfig({
        HAUSWART_BACKUP_DIR: "/b",
        HAUSWART_BACKUP_KEEP: "3",
      }),
    ).toEqual({ dir: "/b", keep: 3 });
  });

  it("an explicitly empty directory turns backups off", () => {
    expect(readBackupConfig({ HAUSWART_BACKUP_DIR: "" })).toBeNull();
    expect(readBackupConfig({ HAUSWART_BACKUP_DIR: "  " })).toBeNull();
  });

  it("rejects invalid counts instead of guessing", () => {
    for (const keep of ["0", "-1", "abc", "1.5", "99999"]) {
      expect(
        () => readBackupConfig({ HAUSWART_BACKUP_KEEP: keep }),
        keep,
      ).toThrow(/Invalid backup configuration/);
    }
  });
});

describe("database backup", () => {
  it("writes a consistent, openable copy of the live database", async () => {
    const user = await createTestUser({ username: "alice" });
    const path = join(dir, "copy.db");
    writeBackup(ctx.db, path);
    const copy = new Database(path, { readonly: true });
    try {
      const row = copy
        .query("select username from users where id = ?")
        .get(user.id) as { username: string } | null;
      expect(row?.username).toBe("alice");
    } finally {
      copy.close();
    }
  });

  it("refuses to overwrite an existing target", () => {
    const path = join(dir, "copy.db");
    writeFileSync(path, "x");
    expect(() => writeBackup(ctx.db, path)).toThrow(/already exists/);
    expect(readFileSync(path, "utf8")).toBe("x");
  });

  it("lists backups newest first and ignores other files", () => {
    for (const name of [
      "hauswart-backup-20260101-000000.db",
      "hauswart-backup-20260301-120000.db",
      "hauswart-backup-20260201-000000.db",
      "other.db",
      "hauswart-backup-20260301-120000.db.partial",
    ]) {
      writeFileSync(join(dir, name), "x");
    }
    expect(listBackups(dir).map((f) => f.name)).toEqual([
      "hauswart-backup-20260301-120000.db",
      "hauswart-backup-20260201-000000.db",
      "hauswart-backup-20260101-000000.db",
    ]);
    expect(listBackups(join(dir, "missing"))).toEqual([]);
  });

  it("prunes to the newest N and always keeps one", () => {
    for (let day = 1; day <= 5; day++) {
      writeFileSync(join(dir, `hauswart-backup-2026010${day}-000000.db`), "x");
    }
    expect(pruneBackups(dir, 2)).toEqual([
      "hauswart-backup-20260103-000000.db",
      "hauswart-backup-20260102-000000.db",
      "hauswart-backup-20260101-000000.db",
    ]);
    expect(listBackups(dir)).toHaveLength(2);
    pruneBackups(dir, 0);
    expect(listBackups(dir)).toHaveLength(1);
  });

  it("runScheduledBackup creates the directory, leaves no partial file and prunes", () => {
    const target = join(dir, "nested", "backups");
    for (let day = 1; day <= 3; day++) {
      runScheduledBackup(
        ctx.db,
        { dir: target, keep: 2 },
        at(`2026-01-0${day}T00:00:00Z`),
      );
    }
    expect(readdirSync(target).sort()).toEqual([
      "hauswart-backup-20260102-000000.db",
      "hauswart-backup-20260103-000000.db",
    ]);
  });

  it("cleans up the partial file when writing fails", () => {
    const target = join(dir, "b");
    mkdirSync(target);
    const when = at("2026-01-01T00:00:00Z");
    writeFileSync(join(target, `${backupFileName(when)}`), "existing");
    // The final name exists: rename over it would hide the problem, so make the db write fail.
    vi.spyOn(ctx.db.$client, "run").mockImplementation(() => {
      throw new Error("disk full");
    });
    expect(() =>
      runScheduledBackup(ctx.db, { dir: target, keep: 5 }, when),
    ).toThrow("disk full");
    expect(readdirSync(target)).toEqual([backupFileName(when)]);
  });

  it("is due without a backup or when the newest is a day old", () => {
    const now = at("2026-02-10T12:00:00Z").getTime();
    expect(isBackupDue(dir, now)).toBe(true);
    writeFileSync(join(dir, "hauswart-backup-20260210-000000.db"), "x");
    expect(isBackupDue(dir, now)).toBe(false);
    expect(isBackupDue(dir, now + 12 * 3600_000)).toBe(true);
  });
});

describe("mirrorFiles", () => {
  it("copies stored files and thumbnails that are missing, keeping the layout", () => {
    store(`ab${sha("c").slice(2)}`, "one");
    store(`ab${sha("c").slice(2)}.thumb.webp`, "thumb");
    store(sha("d"), "two");
    const result = mirrorFiles(files, dir);
    expect(result).toEqual({ copied: 3, skipped: 0 });
    const root = join(dir, "files");
    expect(
      readFileSync(join(root, "ab", `ab${sha("c").slice(2)}`), "utf8"),
    ).toBe("one");
    expect(
      readFileSync(
        join(root, "ab", `ab${sha("c").slice(2)}.thumb.webp`),
        "utf8",
      ),
    ).toBe("thumb");
    expect(readFileSync(join(root, "dd", sha("d")), "utf8")).toBe("two");
  });

  it("is incremental: a second run copies nothing, new files are picked up", () => {
    store(sha("a"), "a");
    expect(mirrorFiles(files, dir)).toEqual({ copied: 1, skipped: 0 });
    expect(mirrorFiles(files, dir)).toEqual({ copied: 0, skipped: 1 });
    store(sha("b"), "b");
    expect(mirrorFiles(files, dir)).toEqual({ copied: 1, skipped: 1 });
  });

  it("never overwrites a mirrored file of the right size and never deletes from the mirror", () => {
    store(sha("a"), "AAA");
    mirrorFiles(files, dir);
    const mirrored = join(dir, "files", "aa", sha("a"));
    writeFileSync(mirrored, "XXX");
    expect(mirrorFiles(files, dir)).toEqual({ copied: 0, skipped: 1 });
    expect(readFileSync(mirrored, "utf8")).toBe("XXX");
    rmSync(join(files, "aa"), { recursive: true });
    mirrorFiles(files, dir);
    expect(existsSync(mirrored)).toBe(true);
  });

  it("repairs a truncated copy (different size)", () => {
    store(sha("a"), "complete");
    mirrorFiles(files, dir);
    const mirrored = join(dir, "files", "aa", sha("a"));
    writeFileSync(mirrored, "comp");
    expect(mirrorFiles(files, dir).copied).toBe(1);
    expect(readFileSync(mirrored, "utf8")).toBe("complete");
  });

  it("copies only store files: no temp files, odd names or mismatched shards", () => {
    store(sha("a"), "a");
    mkdirSync(join(files, "aa"), { recursive: true });
    writeFileSync(join(files, "aa", `${sha("a")}.123.tmp`), "tmp");
    writeFileSync(join(files, "aa", "notes.txt"), "x");
    mkdirSync(join(files, "zz"));
    writeFileSync(join(files, "zz", sha("a")), "x");
    mkdirSync(join(files, "bb"));
    writeFileSync(join(files, "bb", sha("a")), "wrong shard");
    expect(mirrorFiles(files, dir)).toEqual({ copied: 1, skipped: 0 });
    expect(readdirSync(join(dir, "files", "aa"))).toEqual([sha("a")]);
    expect(existsSync(join(dir, "files", "bb"))).toBe(false);
    expect(existsSync(join(dir, "files", "zz"))).toBe(false);
  });

  it("leaves no partial file behind and copes with a missing source", () => {
    expect(mirrorFiles(join(files, "missing"), dir)).toEqual({
      copied: 0,
      skipped: 0,
    });
    store(sha("a"), "a");
    mirrorFiles(files, dir);
    const leftovers = readdirSync(join(dir, "files", "aa")).filter((n) =>
      n.endsWith(".partial"),
    );
    expect(leftovers).toEqual([]);
    expect(statSync(join(dir, "files", "aa", sha("a"))).size).toBe(1);
  });
});

describe("startBackupScheduler", () => {
  it("backs up the database and mirrors files on the first check, then only mirrors until a day passed", async () => {
    vi.useFakeTimers();
    let now = at("2026-02-10T12:00:00Z").getTime();
    vi.setSystemTime(now);
    store(sha("a"), "a");
    vi.spyOn(console, "info").mockImplementation(() => {});
    const stop = startBackupScheduler(
      () => ctx.db,
      { dir, keep: 5 },
      {
        filesRoot: files,
        firstRunDelayMs: 10,
        intervalMs: 60 * 60 * 1000,
        clock: () => now,
      },
    );
    try {
      await vi.advanceTimersByTimeAsync(20);
      expect(listBackups(dir)).toHaveLength(1);
      expect(existsSync(join(dir, "files", "aa", sha("a")))).toBe(true);

      store(sha("b"), "b");
      now += 60 * 60 * 1000;
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(listBackups(dir)).toHaveLength(1);
      expect(existsSync(join(dir, "files", "bb", sha("b")))).toBe(true);

      now += 24 * 60 * 60 * 1000;
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(listBackups(dir)).toHaveLength(2);
    } finally {
      stop();
    }
  });

  it("logs a failing part by name only and keeps going", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(ctx.db.$client, "run").mockImplementation(() => {
      throw new Error("secret detail /private/path");
    });
    store(sha("a"), "a");
    const stop = startBackupScheduler(
      () => ctx.db,
      { dir, keep: 5 },
      {
        filesRoot: files,
        firstRunDelayMs: 10,
      },
    );
    try {
      await vi.advanceTimersByTimeAsync(20);
    } finally {
      stop();
    }
    const logged = error.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("backup.database_failed");
    expect(logged).not.toContain("secret detail");
    expect(logged).not.toContain("/private/path");
    expect(existsSync(join(dir, "files", "aa", sha("a")))).toBe(true);
  });
});
