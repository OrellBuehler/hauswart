import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { afterEach, describe, expect, it } from "vitest";
import { migrateDatabase, openDatabase, type DB } from "./db";

const FOLDER = join(process.cwd(), "drizzle");

interface Journal {
  entries: { idx: number; tag: string }[];
}
const journal = (): Journal =>
  JSON.parse(readFileSync(join(FOLDER, "meta", "_journal.json"), "utf8"));

describe("migrations", () => {
  const cleanup: (() => void)[] = [];
  afterEach(() => cleanup.splice(0).forEach((fn) => fn()));

  it("are numbered without gaps, and every journal entry has its file and snapshot", () => {
    const { entries } = journal();
    expect(entries.map((e) => e.idx)).toEqual(entries.map((_, i) => i));
    for (const { idx, tag } of entries) {
      expect(tag.startsWith(String(idx).padStart(4, "0") + "_"), tag).toBe(
        true,
      );
    }
    const files = readdirSync(FOLDER)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.replace(/\.sql$/, ""))
      .sort();
    expect(files).toEqual(entries.map((e) => e.tag).sort());
    const snapshots = readdirSync(join(FOLDER, "meta"))
      .filter((f) => f.endsWith("_snapshot.json"))
      .map((f) => f.slice(0, 4))
      .sort();
    expect(snapshots).toEqual(
      entries.map((e) => String(e.idx).padStart(4, "0")).sort(),
    );
  });

  /** A database as an earlier version left it: only the migrations up to `lastTag` applied. */
  function databaseAt(lastTag: string): DB {
    const { entries } = journal();
    const last = entries.findIndex((e) => e.tag === lastTag);
    expect(last).toBeGreaterThan(0);
    const dir = mkdtempSync(join(tmpdir(), "hauswart-migrations-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, "meta"));
    for (const { tag } of entries.slice(0, last + 1)) {
      copyFileSync(join(FOLDER, `${tag}.sql`), join(dir, `${tag}.sql`));
    }
    writeFileSync(
      join(dir, "meta", "_journal.json"),
      JSON.stringify({ ...journal(), entries: entries.slice(0, last + 1) }),
    );
    const db = openDatabase(join(dir, "old.db"));
    cleanup.push(() => db.$client.close());
    migrate(db, { migrationsFolder: dir });
    return db;
  }

  const rows = (db: DB, sql: string, ...params: unknown[]) =>
    db.$client.query(sql).all(...(params as never[])) as Record<
      string,
      unknown
    >[];

  it("bring a database of the last release up to date and keep its data", () => {
    // 0014 is where version 0.3.1 stopped.
    const db = databaseAt("0014_cost_document_link_cleanup");
    expect(
      rows(db, "select name from sqlite_master where name = 'vehicle_details'"),
    ).toEqual([]);
    db.$client.exec(`
      insert into assets (id, kind, name, slug, qr_slug) values ('a1', 'device', 'Backofen', 'backofen', 'aaaaaaaaaa');
      insert into service_log (id, asset_id, date, kind, title) values ('s1', 'a1', '2026-01-02', 'maintenance', 'Entkalkt');
      insert into comments (id, entity_type, entity_id, body_md) values ('c1', 'asset', 'a1', 'Notiz');
    `);

    migrateDatabase(db);

    const tables = rows(
      db,
      "select name from sqlite_master where type = 'table'",
    ).map((r) => r.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "vehicle_details",
        "odometer_readings",
        "insurance_policies",
        "insurance_policy_assets",
        "asset_notes",
      ]),
    );
    expect(
      rows(db, "select count(*) as n from __drizzle_migrations")[0].n,
    ).toBe(journal().entries.length);
    expect(rows(db, "select title, odometer from service_log")).toEqual([
      { title: "Entkalkt", odometer: null },
    ]);
    expect(rows(db, "select name from assets")).toEqual([{ name: "Backofen" }]);
    expect(rows(db, "pragma foreign_key_check")).toEqual([]);

    // The search triggers of the old and the new migrations work side by side.
    const find = (q: string) =>
      rows(
        db,
        "select ref from search_fts where search_fts match ? and kind = 'asset'",
        q,
      ).map((r) => r.ref);
    expect(find('"backofen"*')).toEqual(["a1"]);
    db.$client.exec("update assets set name = 'Dampfgarer' where id = 'a1'");
    expect(find('"backofen"*')).toEqual([]);
    expect(find('"dampfgarer"*')).toEqual(["a1"]);
    db.$client.exec(
      "insert into assets (id, kind, name, slug, qr_slug) values ('v1', 'vehicle', 'Auto', 'auto', 'bbbbbbbbbb')",
    );
    db.$client.exec(
      "insert into vehicle_details (asset_id, plate) values ('v1', 'ZH 000000')",
    );
    expect(find('"zh000000"*')).toEqual(["v1"]);
    db.$client.exec("update assets set name = 'Zweitauto' where id = 'v1'");
    expect(find('"zh000000"*')).toEqual(["v1"]);
    db.$client.exec(
      "insert into insurance_policies (id, title, premium_minor, currency, start_date) values ('p1', 'Hausrat', 100, 'CHF', '2026-01-01')",
    );
    expect(
      rows(db, "select ref from search_fts where kind = 'insurance_policy'"),
    ).toEqual([{ ref: "p1" }]);
  });

  it("run again on a database that is up to date without changing it", () => {
    const db = databaseAt("0014_cost_document_link_cleanup");
    migrateDatabase(db);
    const before = rows(
      db,
      "select hash from __drizzle_migrations order by id",
    );
    migrateDatabase(db);
    expect(
      rows(db, "select hash from __drizzle_migrations order by id"),
    ).toEqual(before);
  });
});
