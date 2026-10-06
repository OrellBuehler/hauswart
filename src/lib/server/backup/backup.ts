import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { DB } from "$lib/server/db";

const FILE_PATTERN = /^hauswart-backup-(\d{8}-\d{6})\.db$/;
const SHARD = /^[0-9a-f]{2}$/;
const STORED_FILE = /^[0-9a-f]{64}(\.thumb\.webp)?$/;

export const DEFAULT_BACKUP_DIR = "./data/backups";
export const DEFAULT_KEEP = 14;
/** Name of the directory inside the backup directory that mirrors the uploaded files. */
export const FILES_MIRROR_DIR = "files";

const configSchema = z.object({
  HAUSWART_BACKUP_DIR: z.string().trim().min(1).default(DEFAULT_BACKUP_DIR),
  HAUSWART_BACKUP_KEEP: z.coerce
    .number()
    .int()
    .min(1)
    .max(3650)
    .default(DEFAULT_KEEP),
});

export interface BackupConfig {
  dir: string;
  keep: number;
}

/**
 * Backups are on by default (`./data/backups`, 14 kept). Setting `HAUSWART_BACKUP_DIR` to an
 * empty value turns them off. Invalid values throw, so a typo is not mistaken for "off".
 */
export function readBackupConfig(
  env: Record<string, string | undefined> = process.env,
): BackupConfig | null {
  if (
    env.HAUSWART_BACKUP_DIR !== undefined &&
    env.HAUSWART_BACKUP_DIR.trim() === ""
  ) {
    return null;
  }
  const parsed = configSchema.safeParse({
    HAUSWART_BACKUP_DIR: env.HAUSWART_BACKUP_DIR,
    HAUSWART_BACKUP_KEEP: env.HAUSWART_BACKUP_KEEP || undefined,
  });
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid backup configuration (${problems})`);
  }
  return {
    dir: parsed.data.HAUSWART_BACKUP_DIR,
    keep: parsed.data.HAUSWART_BACKUP_KEEP,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `hauswart-backup-YYYYMMDD-HHMMSS.db`, in UTC so names sort chronologically. */
export function backupFileName(date: Date = new Date()): string {
  const day = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
  const time = `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
  return `hauswart-backup-${day}-${time}.db`;
}

/** Writes a consistent, defragmented copy of the live database. `path` must not exist. */
export function writeBackup(db: DB, path: string): void {
  if (existsSync(path)) throw new Error("Backup target already exists");
  db.$client.run("VACUUM INTO ?", [path]);
}

export interface BackupFile {
  name: string;
  size: number;
  /** Instant encoded in the file name. */
  createdAt: number;
}

/** Backups in `dir`, newest first. Unrelated files are ignored. */
export function listBackups(dir: string): BackupFile[] {
  if (!existsSync(dir)) return [];
  const files: BackupFile[] = [];
  for (const name of readdirSync(dir)) {
    const match = FILE_PATTERN.exec(name);
    if (!match) continue;
    const s = match[1]!;
    const createdAt = Date.UTC(
      +s.slice(0, 4),
      +s.slice(4, 6) - 1,
      +s.slice(6, 8),
      +s.slice(9, 11),
      +s.slice(11, 13),
      +s.slice(13, 15),
    );
    files.push({ name, size: statSync(join(dir, name)).size, createdAt });
  }
  return files.sort((a, b) => b.createdAt - a.createdAt);
}

/** Deletes all but the newest `keep` backups (at least one is always kept); returns the deleted names. */
export function pruneBackups(dir: string, keep: number): string[] {
  const stale = listBackups(dir).slice(Math.max(keep, 1));
  for (const f of stale) rmSync(join(dir, f.name), { force: true });
  return stale.map((f) => f.name);
}

/** Writes a backup into `dir` (via a partial file, so a crash never leaves a broken backup) and prunes. */
export function runScheduledBackup(
  db: DB,
  config: BackupConfig,
  now: Date = new Date(),
): string {
  mkdirSync(config.dir, { recursive: true });
  const name = backupFileName(now);
  const partial = join(config.dir, `${name}.partial`);
  rmSync(partial, { force: true });
  try {
    writeBackup(db, partial);
    renameSync(partial, join(config.dir, name));
  } catch (err) {
    rmSync(partial, { force: true });
    throw err;
  }
  pruneBackups(config.dir, config.keep);
  return name;
}

export interface MirrorResult {
  copied: number;
  skipped: number;
}

/**
 * Copies the stored files (and thumbnails) that are missing in `<backupDir>/files`. Stored files
 * are content addressed: a name always means the same bytes, so a file that is already there
 * with the same size is never touched. Copies go through a `.partial` file, so an interrupted
 * run leaves nothing half written. Nothing is ever deleted from the mirror (it may keep files
 * that were deleted from the live store since).
 */
export function mirrorFiles(
  filesRoot: string,
  backupDir: string,
): MirrorResult {
  const result: MirrorResult = { copied: 0, skipped: 0 };
  if (!existsSync(filesRoot)) return result;
  const target = join(backupDir, FILES_MIRROR_DIR);
  for (const shard of readdirSync(filesRoot)) {
    if (!SHARD.test(shard)) continue;
    const sourceDir = join(filesRoot, shard);
    if (!statSync(sourceDir).isDirectory()) continue;
    for (const name of readdirSync(sourceDir)) {
      if (!STORED_FILE.test(name) || !name.startsWith(shard)) continue;
      const source = join(sourceDir, name);
      const info = statSync(source);
      if (!info.isFile()) continue;
      const destination = join(target, shard, name);
      if (existsSync(destination) && statSync(destination).size === info.size) {
        result.skipped += 1;
        continue;
      }
      mkdirSync(join(target, shard), { recursive: true });
      const partial = `${destination}.partial`;
      try {
        copyFileSync(source, partial);
        renameSync(partial, destination);
      } catch (err) {
        rmSync(partial, { force: true });
        throw err;
      }
      result.copied += 1;
    }
  }
  return result;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 60_000;

/** A database backup is due when the newest one is a day old (or none exists). */
export function isBackupDue(dir: string, now: number = Date.now()): boolean {
  const [latest] = listBackups(dir);
  return !latest || now - latest.createdAt >= DAY_MS;
}

const errorName = (err: unknown) =>
  err instanceof Error ? err.name : "NonError";

export interface SchedulerOptions {
  intervalMs?: number;
  firstRunDelayMs?: number;
  /** Where the uploaded files live; they are mirrored on every check. */
  filesRoot?: string;
  clock?: () => number;
}

/**
 * Every hour: writes a database backup when the newest is a day old, then mirrors the files that
 * are missing in the backup (the database first, so every file its rows reference is mirrored
 * right after). Each part fails on its own and is logged by error name only. Returns a stop
 * function.
 */
export function startBackupScheduler(
  getDb: () => DB,
  config: BackupConfig,
  options: SchedulerOptions = {},
): () => void {
  let running = false;
  const clock = options.clock ?? Date.now;
  const tick = () => {
    if (running) return;
    running = true;
    try {
      if (isBackupDue(config.dir, clock())) {
        try {
          const name = runScheduledBackup(getDb(), config, new Date(clock()));
          console.info(JSON.stringify({ event: "backup.database", name }));
        } catch (err) {
          console.error(
            JSON.stringify({
              event: "backup.database_failed",
              name: errorName(err),
            }),
          );
        }
      }
      if (options.filesRoot) {
        try {
          const mirrored = mirrorFiles(options.filesRoot, config.dir);
          if (mirrored.copied > 0) {
            console.info(
              JSON.stringify({ event: "backup.files", ...mirrored }),
            );
          }
        } catch (err) {
          console.error(
            JSON.stringify({
              event: "backup.files_failed",
              name: errorName(err),
            }),
          );
        }
      }
    } finally {
      running = false;
    }
  };
  const first = setTimeout(tick, options.firstRunDelayMs ?? FIRST_RUN_DELAY_MS);
  const timer = setInterval(tick, options.intervalMs ?? CHECK_INTERVAL_MS);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
