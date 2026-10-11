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
        "tire_sets",
        "tire_set_events",
        "fuel_logs",
        "appointments",
        "calendar_targets",
        "calendar_links",
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
    db.$client.exec(
      "insert into appointments (id, title, location, all_day, start_date, end_date) values ('ap1', 'Kaminfeger', 'Keller', 1, '2026-01-02', '2026-01-02')",
    );
    db.$client.exec(
      "insert into comments (id, entity_type, entity_id, body_md) values ('c2', 'appointment', 'ap1', 'Schlüssel')",
    );
    expect(
      rows(db, "select ref from search_fts where kind = 'appointment'"),
    ).toEqual([{ ref: "ap1" }]);
    db.$client.exec("delete from appointments where id = 'ap1'");
    expect(
      rows(db, "select ref from search_fts where kind = 'appointment'"),
    ).toEqual([]);
    expect(
      rows(db, "select id from comments where entity_type = 'appointment'"),
    ).toEqual([]);
    expect(rows(db, "select id from comments")).toEqual([{ id: "c1" }]);
  });

  it("add the calendar targets: one target per calendar, one link per item, links gone with their target, and the name of the calendar", () => {
    const db = databaseAt("0014_cost_document_link_cleanup");
    migrateDatabase(db);
    db.$client.exec(`
      insert into connections (id, kind, base_url, token_enc) values ('k1', 'homeassistant', 'https://ha.example.org', 'x');
      insert into calendar_targets (id, connection_id, provider, remote_calendar_id, name, level, config_json)
        values ('t1', 'k1', 'homeassistant', 'calendar.example_one', 'Eins', 'household', '{}');
      insert into calendar_links (id, target_id, kind, item_id, instance_key, ref, content_hash)
        values ('l1', 't1', 'appointments', 'ap1', '', 'appointment-ap1', 'h1');
    `);
    expect(
      rows(db, "select remote_name from calendar_targets where id = 't1'"),
    ).toEqual([{ remote_name: null }]);
    db.$client.exec(
      "update calendar_targets set remote_name = 'Haushalt' where id = 't1'",
    );
    expect(rows(db, "select remote_name from calendar_targets")).toEqual([
      { remote_name: "Haushalt" },
    ]);

    // A calendar has one target, whoever's connection reaches it.
    expect(() =>
      db.$client.exec(
        "insert into calendar_targets (id, connection_id, provider, remote_calendar_id, name, level, config_json) values ('t2', 'k1', 'homeassistant', 'calendar.example_one', 'Zwei', 'household', '{}')",
      ),
    ).toThrow(/UNIQUE/);
    // An item has one link per target, and the same item may be linked in another target.
    expect(() =>
      db.$client.exec(
        "insert into calendar_links (id, target_id, kind, item_id, instance_key, ref, content_hash) values ('l2', 't1', 'appointments', 'ap1', '', 'appointment-ap1', 'h2')",
      ),
    ).toThrow(/UNIQUE/);
    db.$client.exec(`
      insert into calendar_targets (id, connection_id, provider, remote_calendar_id, name, level, config_json)
        values ('t3', 'k1', 'homeassistant', 'calendar.example_two', 'Drei', 'household', '{}');
      insert into calendar_links (id, target_id, kind, item_id, instance_key, ref, content_hash)
        values ('l3', 't3', 'appointments', 'ap1', '', 'appointment-ap1', 'h3');
    `);
    // A household target has no owner, a personal one has.
    db.$client.exec(
      "insert into users (id, username, password_hash) values ('u1', 'anna', 'x')",
    );
    expect(() =>
      db.$client.exec(
        "insert into calendar_targets (id, connection_id, provider, remote_calendar_id, name, level, user_id, config_json) values ('t4', 'k1', 'homeassistant', 'calendar.example_three', 'Vier', 'household', 'u1', '{}')",
      ),
    ).toThrow(/CHECK/);
    expect(() =>
      db.$client.exec(
        "insert into calendar_targets (id, connection_id, provider, remote_calendar_id, name, level, config_json) values ('t5', 'k1', 'homeassistant', 'calendar.example_four', 'Fünf', 'user', '{}')",
      ),
    ).toThrow(/CHECK/);

    db.$client.exec("delete from calendar_targets where id = 't1'");
    expect(rows(db, "select id from calendar_links")).toEqual([{ id: "l3" }]);
    db.$client.exec("delete from connections where id = 'k1'");
    expect(rows(db, "select id from calendar_targets")).toEqual([]);
    expect(rows(db, "select id from calendar_links")).toEqual([]);
    expect(rows(db, "pragma foreign_key_check")).toEqual([]);
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
