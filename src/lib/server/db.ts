import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  migrateDatabase as applyMigrations,
  type MigrateOptions,
} from "./migrator";
import * as schema from "./schema";

export type DB = ReturnType<typeof drizzle<typeof schema>>;

let db: DB | null = null;

export function openDatabase(path: string): DB {
  const memory = path === ":memory:";
  if (!memory) mkdirSync(dirname(path), { recursive: true });
  const client = new Database(path, { create: true, strict: true });
  if (!memory) client.exec("PRAGMA journal_mode = WAL;");
  client.exec("PRAGMA foreign_keys = ON;");
  client.exec("PRAGMA busy_timeout = 5000;");
  return drizzle({ client, schema });
}

/** Applies the pending migrations; see `migrator.ts` for how foreign keys are handled while they run. */
export function migrateDatabase(
  target: DB,
  folder = join(process.cwd(), "drizzle"),
  options?: MigrateOptions,
): void {
  applyMigrations(target, folder, options);
}

export function getDB(): DB {
  if (!db) db = openDatabase(process.env.DATABASE_PATH ?? "./data/hauswart.db");
  return db;
}

/** Replace the process-wide database. Tests only; pass null to reset. */
export function setDB(next: DB | null): void {
  db = next;
}

export function runMigrations(): void {
  migrateDatabase(getDB());
}

export * from "./schema";
