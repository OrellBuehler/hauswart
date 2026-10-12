import { existsSync, readdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { DB } from "./db";

/** The environment variable that turns the copy before migrating off (`false`, `0`, `off`, `no`). */
export const MIGRATION_BACKUP_SWITCH = "HAUSWART_MIGRATION_BACKUP";
/** How many of these copies stay next to the database. */
export const SAFETY_COPIES_KEPT = 3;

const ON = new Set(["true", "1", "on", "yes"]);
const OFF = new Set(["false", "0", "off", "no"]);

/**
 * On unless `HAUSWART_MIGRATION_BACKUP` says otherwise. An unknown value throws, so a typo is not mistaken for "off":
 * the copy is what a person has to go back to when a migration goes wrong.
 */
export function safetyCopyEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const value = env[MIGRATION_BACKUP_SWITCH]?.trim().toLowerCase();
  if (!value || ON.has(value)) return true;
  if (OFF.has(value)) return false;
  throw new Error(`Invalid ${MIGRATION_BACKUP_SWITCH} (use true or false)`);
}

/** The file of the main database; null for one in memory or a temporary one, which have nothing to copy next to. */
function databaseFile(client: DB["$client"]): string | null {
  const rows = client.query("PRAGMA database_list").all() as {
    name: string;
    file: string;
  }[];
  const main = rows.find((r) => r.name === "main");
  return main && main.file !== "" ? main.file : null;
}

/** `YYYYMMDD-HHMMSS` in UTC, so the names sort by time. */
function stamp(now: Date): string {
  return now.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
}

const nameOf = (base: string, at: string, attempt: number) =>
  `${base}.pre-migrate-${at}${attempt > 1 ? `-${attempt}` : ""}.db`;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The copies made for `base` in `dir`, newest first. Anything else in the directory is not ours to touch. */
function copiesOf(dir: string, base: string): string[] {
  const pattern = new RegExp(
    `^${escape(base)}\\.pre-migrate-(\\d{8}-\\d{6})(?:-(\\d+))?\\.db$`,
  );
  return readdirSync(dir)
    .flatMap((name) => {
      const match = pattern.exec(name);
      return match ? [{ name, at: match[1]!, attempt: +(match[2] ?? 1) }] : [];
    })
    .sort((a, b) =>
      a.at === b.at ? b.attempt - a.attempt : a.at < b.at ? 1 : -1,
    )
    .map((c) => c.name);
}

/**
 * Writes a consistent copy of the database next to it (`<database>.pre-migrate-<UTC>.db`, through a partial file so a
 * crash never leaves a broken copy; a second one in the same second gets `-2`, `-3`, ...) and keeps the newest `keep`.
 * Returns the name of the copy, or null for a database in memory.
 */
export function takeSafetyCopy(
  client: DB["$client"],
  now: Date,
  keep: number = SAFETY_COPIES_KEPT,
): string | null {
  const file = databaseFile(client);
  if (file === null) return null;
  const dir = dirname(file);
  const base = basename(file);
  const at = stamp(now);
  let attempt = 1;
  while (existsSync(join(dir, nameOf(base, at, attempt)))) attempt++;
  const name = nameOf(base, at, attempt);
  const partial = join(dir, `${name}.partial`);
  rmSync(partial, { force: true });
  try {
    client.run("VACUUM INTO ?", [partial]);
    renameSync(partial, join(dir, name));
  } catch (err) {
    rmSync(partial, { force: true });
    throw err;
  }
  for (const stale of copiesOf(dir, base).slice(Math.max(keep, 1))) {
    rmSync(join(dir, stale), { force: true });
  }
  return name;
}
