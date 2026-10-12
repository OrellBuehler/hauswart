import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { DB } from "./db";
import {
  MIGRATION_BACKUP_SWITCH,
  safetyCopyEnabled,
  takeSafetyCopy,
} from "./migration-copy";

const TABLE = "__drizzle_migrations";

/**
 * The migrations written for a migrator that ran with foreign keys on, which still run that way. Migration 0026 rebuilds
 * `cost_entries` and sets aside the rows its `DROP TABLE` was going to cascade-delete in order to put them back; with
 * foreign keys off nothing is deleted and putting them back would be a second copy. Every other migration, and every
 * one from now on, runs with foreign keys off (see `migrateDatabase`).
 */
export const MIGRATIONS_WITH_FOREIGN_KEYS = new Set([
  "0026_cost_books_settlements",
]);

/** A migration that created rows referring to rows that do not exist; `violations` are `child -> parent (n new)`. */
export class MigrationIntegrityError extends Error {
  constructor(readonly violations: readonly string[]) {
    super(
      `A migration created rows that refer to rows that do not exist (${violations.join(", ")}); its changes were rolled back`,
    );
    this.name = "MigrationIntegrityError";
  }
}

interface Step {
  tag: string;
  statements: string[];
  hash: string;
  folderMillis: number;
  foreignKeys: boolean;
}

function foreignKeysOf(client: DB["$client"]): boolean {
  const row = client.query("PRAGMA foreign_keys").get() as {
    foreign_keys: number;
  };
  return row.foreign_keys === 1;
}

/**
 * `PRAGMA foreign_keys` does nothing inside a transaction, so it is set before one begins and read back: a caller that
 * is already in one would otherwise run the migrations with the wrong setting and never know.
 */
function setForeignKeys(client: DB["$client"], on: boolean): void {
  client.exec(`PRAGMA foreign_keys = ${on ? "ON" : "OFF"}`);
  if (foreignKeysOf(client) !== on) {
    throw new Error(
      "Foreign keys could not be switched for the migrations; they must not run inside a transaction",
    );
  }
}

interface Dangling {
  table: string;
  parent: string;
  count: number;
}

/** How many rows point at nothing per pair of tables, keyed `child -> parent`; row ids stay out of it. */
function danglingReferences(client: DB["$client"]): Map<string, Dangling> {
  const rows = client.query("PRAGMA foreign_key_check").all() as {
    table: string;
    parent: string;
  }[];
  const found = new Map<string, Dangling>();
  for (const { table, parent } of rows) {
    const key = `${table} -> ${parent}`;
    const entry = found.get(key) ?? { table, parent, count: 0 };
    entry.count += 1;
    found.set(key, entry);
  }
  return found;
}

/** The pairs of tables with more rows pointing at nothing than `before` had, as `child -> parent (n new)`. */
function createdReferences(
  before: ReadonlyMap<string, Dangling>,
  after: ReadonlyMap<string, Dangling>,
): string[] {
  return [...after].flatMap(([pair, { count }]) => {
    const created = count - (before.get(pair)?.count ?? 0);
    return created > 0 ? [`${pair} (${created} new)`] : [];
  });
}

/** Says by table and count, never by row, which references already pointed at nothing before the migrations came. */
function logKnownReferences(known: ReadonlyMap<string, Dangling>): void {
  if (known.size === 0) return;
  console.warn(
    JSON.stringify({
      event: "migrations.dangling_references",
      references: [...known.values()],
    }),
  );
}

function tagsOf(folder: string): string[] {
  const journal = JSON.parse(
    readFileSync(join(folder, "meta", "_journal.json"), "utf8"),
  ) as { entries: { tag: string }[] };
  return journal.entries.map((e) => e.tag);
}

/** Every migration of the folder, in order, each step knowing how it runs. */
function stepsOf(folder: string): Step[] {
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  // `readMigrationFiles` returns the journal's entries in order, so the tags line up with them.
  const tags = tagsOf(folder);
  return migrations.map((m, i) => ({
    tag: tags[i]!,
    statements: m.sql.filter((s) => s.trim() !== ""),
    hash: m.hash,
    folderMillis: m.folderMillis,
    foreignKeys: MIGRATIONS_WITH_FOREIGN_KEYS.has(tags[i]!),
  }));
}

/** The same text drizzle's own migrator writes, so a database looks alike whichever migrator created it. */
function createLedger(target: DB): void {
  target.run(
    sql.raw(`CREATE TABLE IF NOT EXISTS "${TABLE}" (
\t\t\t\tid SERIAL PRIMARY KEY,
\t\t\t\thash text NOT NULL,
\t\t\t\tcreated_at numeric
\t\t\t)`),
  );
}

/** What is not applied yet, in order: everything newer than the newest applied migration. */
function pendingOf(client: DB["$client"], steps: readonly Step[]): Step[] {
  const row = client
    .query(`SELECT max(created_at) AS last FROM "${TABLE}"`)
    .get() as { last: number | string | null };
  if (row.last === null) return [...steps];
  const last = Number(row.last);
  return steps.filter((s) => s.folderMillis > last);
}

function appliedCount(client: DB["$client"]): number {
  const row = client.query(`SELECT count(*) AS n FROM "${TABLE}"`).get() as {
    n: number;
  };
  return row.n;
}

export interface MigrateOptions {
  /** Whether to write a copy of the database before the first migration; `HAUSWART_MIGRATION_BACKUP` decides when omitted. */
  safetyCopy?: boolean;
  /** The clock that names the copy. */
  now?: () => Date;
}

/**
 * Before a database that has data is migrated, a copy of it is written next to it: a migration cannot be undone, and
 * the daily backup may be a day old or off. A fresh database (nothing applied yet) has nothing to lose.
 */
function copyBeforeMigrating(target: DB, options: MigrateOptions): void {
  if (!(options.safetyCopy ?? safetyCopyEnabled())) return;
  if (appliedCount(target.$client) === 0) return;
  let name: string | null;
  try {
    name = takeSafetyCopy(
      target.$client,
      (options.now ?? (() => new Date()))(),
    );
  } catch (cause) {
    throw new Error(
      `The copy of the database that is written before migrating failed, so nothing was migrated; free some disk space, or set ${MIGRATION_BACKUP_SWITCH}=false to migrate without it`,
      { cause },
    );
  }
  if (name) {
    console.info(
      JSON.stringify({ event: "migrations.safety_copy", file: name }),
    );
  }
}

/**
 * Runs, in one transaction, the steps at the head of what is pending that share the setting `foreignKeys`. The write
 * lock is taken first (`BEGIN IMMEDIATE`) and the pending list worked out only then, so an instance that looked at it
 * before another one got in does not run what has been applied meanwhile, which for a migration that only changes
 * data would do it twice. Nothing to run any more (or a head that needs the other setting) leaves the caller to look
 * again.
 */
function runGroup(
  target: DB,
  steps: readonly Step[],
  foreignKeys: boolean,
): void {
  const client = target.$client;
  const before = foreignKeysOf(client);
  setForeignKeys(client, foreignKeys);
  try {
    target.run(sql`BEGIN IMMEDIATE`);
    try {
      const pending = pendingOf(client, steps);
      let end = 0;
      while (end < pending.length && pending[end]!.foreignKeys === foreignKeys)
        end++;
      if (end === 0) {
        target.run(sql`ROLLBACK`);
        return;
      }
      // A database can already hold rows that point at nothing (a restore, an old bug): only what a migration adds is its fault.
      const known = foreignKeys ? null : danglingReferences(client);
      if (known) logKnownReferences(known);
      for (const step of pending.slice(0, end)) {
        for (const statement of step.statements) {
          target.run(sql.raw(statement));
        }
        target.run(
          sql`INSERT INTO ${sql.identifier(TABLE)} ("hash", "created_at") VALUES (${step.hash}, ${step.folderMillis})`,
        );
      }
      // With foreign keys off nothing stopped a migration from leaving a row that points at nothing; look before committing.
      if (known) {
        const created = createdReferences(known, danglingReferences(client));
        if (created.length > 0) throw new MigrationIntegrityError(created);
      }
      target.run(sql`COMMIT`);
    } catch (err) {
      if (client.inTransaction) target.run(sql`ROLLBACK`);
      throw err;
    }
  } finally {
    setForeignKeys(client, before);
  }
}

/**
 * Applies the migrations that are not applied yet, with foreign keys **off** (set before the transaction, where the
 * pragma works) so that a table rebuild, which is how SQLite changes a column and which drizzle-kit generates with
 * `PRAGMA foreign_keys=OFF` lines that do nothing inside a transaction, does not cascade-delete or null the rows that
 * refer to the table it drops. Before committing it runs `PRAGMA foreign_key_check` and compares with what it found
 * before the migrations: rows that already pointed at nothing are logged by table and count and left alone, but a
 * migration that adds to them (per pair of tables) fails with `MigrationIntegrityError`. Consecutive migrations that
 * need the same foreign key setting form a group, and a group is applied together or not at all: when one fails the
 * group is rolled back, groups before it stay applied, and the app does not start.
 * Foreign keys are back on afterwards, whatever happened. Migrations in `MIGRATIONS_WITH_FOREIGN_KEYS` run in a
 * transaction of their own with foreign keys on, as they were written.
 * A database that already has data is copied first, next to itself (see `migration-copy.ts`).
 */
export function migrateDatabase(
  target: DB,
  folder: string,
  options: MigrateOptions = {},
): void {
  const client = target.$client;
  const steps = stepsOf(folder);
  createLedger(target);
  let copied = false;
  for (
    let pending = pendingOf(client, steps);
    pending.length > 0;
    pending = pendingOf(client, steps)
  ) {
    if (client.inTransaction) {
      throw new Error(
        "Migrations must not run inside a transaction, where the foreign keys pragma does nothing",
      );
    }
    if (!copied) {
      copied = true;
      copyBeforeMigrating(target, options);
    }
    runGroup(target, steps, pending[0]!.foreignKeys);
  }
}
