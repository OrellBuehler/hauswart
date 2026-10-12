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

  /** A folder of migrations of our own, `files` being tag -> SQL, in the order given. */
  function folderOf(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "hauswart-synthetic-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, "meta"));
    const entries = Object.keys(files).map((tag, idx) => ({
      idx,
      version: "6",
      when: 1_700_000_000_000 + idx * 1000,
      tag,
      breakpoints: true,
    }));
    for (const [tag, text] of Object.entries(files)) {
      writeFileSync(join(dir, `${tag}.sql`), text);
    }
    writeFileSync(
      join(dir, "meta", "_journal.json"),
      JSON.stringify({ version: "7", dialect: "sqlite", entries }),
    );
    return dir;
  }

  /** A fresh database, opened as the app opens it (foreign keys on). */
  function emptyDatabase(): DB {
    const dir = mkdtempSync(join(tmpdir(), "hauswart-migrations-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const db = openDatabase(join(dir, "empty.db"));
    cleanup.push(() => db.$client.close());
    return db;
  }

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
      insert into users (id, username, password_hash) values ('u1', 'anna', 'x'), ('u2', 'ben', 'x');
      insert into cost_entries (id, date, title, amount_minor, currency, category, paid_by_user_id, split_mode, created_by)
        values ('k1', '2026-01-05', 'Dachrinne', 10001, 'CHF', 'maintenance', 'u1', 'ownership', 'u1');
      insert into cost_entry_shares (entry_id, user_id, share_bps) values ('k1', 'u1', 7000), ('k1', 'u2', 3000);
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

    // The cost entry of the old database is in the book "Wohnung", with its shares as they were.
    expect(
      rows(
        db,
        "select e.title, e.amount_minor, b.name, b.tax_relevant from cost_entries e join cost_books b on b.id = e.book_id",
      ),
    ).toEqual([
      {
        title: "Dachrinne",
        amount_minor: 10001,
        name: "Wohnung",
        tax_relevant: 1,
      },
    ]);
    expect(
      rows(
        db,
        "select user_id, share_bps from cost_entry_shares order by user_id",
      ),
    ).toEqual([
      { user_id: "u1", share_bps: 7000 },
      { user_id: "u2", share_bps: 3000 },
    ]);

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

  it("put every cost entry into the book Wohnung and keep what hangs off the entries", () => {
    const db = databaseAt("0025_calendar_target_remote_name");
    db.$client.exec(`
      insert into users (id, username, password_hash) values ('u1', 'anna', 'x'), ('u2', 'ben', 'x'), ('u3', 'carl', 'x');
      insert into assets (id, kind, name, slug, qr_slug) values ('v1', 'vehicle', 'Auto', 'auto', 'cccccccccc');
      insert into cost_entries (id, date, title, amount_minor, currency, category, paid_by_user_id, split_mode, counts_as_expense, deductible, source, payee, notes, created_by, created_at, updated_at, asset_id)
        values ('k1', '2026-01-05', 'Dachrinne', 10001, 'CHF', 'maintenance', 'u1', 'ownership', 1, 'maintenance', 'manual', 'Beispiel AG', 'Notiz', 'u1', 1767600000000, 1767600001000, null),
               ('k2', '2026-02-01', 'Tanken', 7050, 'CHF', 'fuel', 'u2', 'equal', 1, 'unknown', 'manual', null, null, 'u2', 1769900000000, 1769900001000, 'v1'),
               ('k3', '2026-03-01', 'Hypothek', 200000, 'EUR', 'mortgage_principal', null, 'none', 0, 'unknown', 'finance_transaction', null, null, null, 1772300000000, 1772300001000, null);
      update cost_entries set provider_ref = 'tx-1', provider_url = 'https://finance.example.org/t/1', provider_link_id = 'l-1', link_synced_at = 1772300002000 where id = 'k3';
      insert into cost_entry_shares (entry_id, user_id, share_bps) values ('k1', 'u1', 7000), ('k1', 'u2', 3000), ('k2', 'u2', 3334), ('k2', 'u1', 3333), ('k2', 'u3', 3333);
      insert into fuel_logs (id, asset_id, date, odometer, quantity, amount_minor, currency, cost_entry_id)
        values ('f1', 'v1', '2026-02-01', 1000, 40, 7050, 'CHF', 'k2'), ('f2', 'v1', '2026-02-02', 1500, 5, 0, 'CHF', null);
      insert into comments (id, entity_type, entity_id, body_md) values ('m1', 'cost', 'k1', 'Rechnung da'), ('m2', 'cost', 'k2', 'Quittung');
      insert into document_links (id, provider, external_id, owner_type, owner_id, role) values ('d1', 'paperless', 7, 'cost', 'k1', 'receipt'), ('d2', 'paperless', 8, 'cost', 'k2', 'receipt');
    `);
    const before = rows(db, "select * from cost_entries order by id");

    migrateDatabase(db);

    // The default books, editable like any other.
    expect(
      rows(
        db,
        "select name, slug, icon, default_split_mode, tax_relevant, archived_at, sort_order from cost_books order by sort_order",
      ),
    ).toEqual([
      {
        name: "Wohnung",
        slug: "wohnung",
        icon: "house",
        default_split_mode: "ownership",
        tax_relevant: 1,
        archived_at: null,
        sort_order: 0,
      },
      {
        name: "Haushalt",
        slug: "haushalt",
        icon: "shopping-basket",
        default_split_mode: "equal",
        tax_relevant: 0,
        archived_at: null,
        sort_order: 1,
      },
      {
        name: "Auto",
        slug: "auto",
        icon: "car",
        default_split_mode: "equal",
        tax_relevant: 0,
        archived_at: null,
        sort_order: 2,
      },
    ]);
    const ids = rows(db, "select id from cost_books").map(
      (r) => r.id as string,
    );
    for (const id of ids) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
    expect(new Set(ids).size).toBe(3);

    // Every entry is in Wohnung and nothing else about it changed.
    const wohnung = rows(
      db,
      "select id from cost_books where slug = 'wohnung'",
    )[0].id;
    const after = rows(db, "select * from cost_entries order by id");
    expect(after.map((r) => r.book_id)).toEqual([wohnung, wohnung, wohnung]);
    expect(after.map(({ book_id: _book, ...rest }) => rest)).toEqual(before);

    // The frozen shares, the fuel log links, the comments and the document links are all still there.
    expect(
      rows(
        db,
        "select entry_id, user_id, share_bps from cost_entry_shares order by entry_id, user_id",
      ),
    ).toEqual([
      { entry_id: "k1", user_id: "u1", share_bps: 7000 },
      { entry_id: "k1", user_id: "u2", share_bps: 3000 },
      { entry_id: "k2", user_id: "u1", share_bps: 3333 },
      { entry_id: "k2", user_id: "u2", share_bps: 3334 },
      { entry_id: "k2", user_id: "u3", share_bps: 3333 },
    ]);
    expect(
      rows(db, "select id, cost_entry_id from fuel_logs order by id"),
    ).toEqual([
      { id: "f1", cost_entry_id: "k2" },
      { id: "f2", cost_entry_id: null },
    ]);
    expect(rows(db, "select id from comments order by id")).toHaveLength(2);
    expect(rows(db, "select id from document_links order by id")).toHaveLength(
      2,
    );
    expect(rows(db, "pragma foreign_key_check")).toEqual([]);
    expect(
      rows(
        db,
        "select name from sqlite_master where name in ('__stash_cost_entry_shares', '__stash_fuel_log_costs', '__new_cost_entries')",
      ).map((r) => r.name),
    ).toEqual([]);

    // The table is as a fresh one: its indexes and delete triggers work, the foreign keys act as before.
    expect(
      rows(
        db,
        "select name from sqlite_master where type = 'index' and tbl_name = 'cost_entries' and name like 'cost_entries_%' order by name",
      ).map((r) => r.name),
    ).toEqual([
      "cost_entries_asset_id_idx",
      "cost_entries_book_id_idx",
      "cost_entries_category_idx",
      "cost_entries_date_idx",
      "cost_entries_defect_id_idx",
      "cost_entries_paid_by_idx",
      "cost_entries_provider_idx",
      "cost_entries_room_id_idx",
      "cost_entries_service_log_id_idx",
    ]);
    expect(() =>
      db.$client.exec(
        "insert into cost_entries (id, book_id, date, title, amount_minor, currency, category, provider_connection_id, provider_ref) values ('k9', '" +
          wohnung +
          "', '2026-03-02', 'x', 1, 'CHF', 'other', null, null)",
      ),
    ).not.toThrow();
    db.$client.exec("delete from cost_entries where id = 'k9'");
    db.$client.exec("delete from cost_entries where id = 'k2'");
    expect(rows(db, "select id from comments")).toEqual([{ id: "m1" }]);
    expect(rows(db, "select id from document_links")).toEqual([{ id: "d1" }]);
    expect(
      rows(db, "select entry_id from cost_entry_shares where entry_id = 'k2'"),
    ).toEqual([]);
    expect(
      rows(db, "select cost_entry_id from fuel_logs where id = 'f1'"),
    ).toEqual([{ cost_entry_id: null }]);

    // An entry needs a book, and a book with entries cannot be deleted.
    expect(() =>
      db.$client.exec(
        "insert into cost_entries (id, book_id, date, title, amount_minor, currency, category) values ('k8', 'missing', '2026-03-02', 'x', 1, 'CHF', 'other')",
      ),
    ).toThrow(/FOREIGN KEY/);
    expect(() =>
      db.$client.exec(
        "insert into cost_entries (id, date, title, amount_minor, currency, category) values ('k8', '2026-03-02', 'x', 1, 'CHF', 'other')",
      ),
    ).toThrow(/NOT NULL/);
    expect(() =>
      db.$client.exec("delete from cost_books where slug = 'wohnung'"),
    ).toThrow(/FOREIGN KEY/);
    expect(() =>
      db.$client.exec("delete from cost_books where slug = 'auto'"),
    ).not.toThrow();
  });

  it("add the settlements: positive amounts between two people, a book or none, tied to the people and books", () => {
    const db = databaseAt("0025_calendar_target_remote_name");
    migrateDatabase(db);
    db.$client.exec(
      "insert into users (id, username, password_hash) values ('u1', 'anna', 'x'), ('u2', 'ben', 'x')",
    );
    const book = rows(
      db,
      "select id from cost_books where slug = 'haushalt'",
    )[0].id;
    const insert = (
      id: string,
      bookId: string | null,
      from: string,
      to: string,
      amount: number,
    ) =>
      db.$client
        .query(
          "insert into settlements (id, book_id, from_user_id, to_user_id, amount_minor, currency, date) values (?, ?, ?, ?, ?, 'CHF', '2026-04-01')",
        )
        .run(id, bookId as never, from, to, amount);
    insert("s1", null, "u2", "u1", 5000);
    insert("s2", book as string, "u2", "u1", 1);
    expect(() => insert("s3", null, "u2", "u1", 0)).toThrow(/CHECK/);
    expect(() => insert("s3", null, "u2", "u1", -5)).toThrow(/CHECK/);
    expect(() => insert("s3", null, "u1", "u1", 5)).toThrow(/CHECK/);
    expect(() => insert("s3", "missing", "u2", "u1", 5)).toThrow(/FOREIGN KEY/);
    expect(() => insert("s3", null, "u2", "missing", 5)).toThrow(/FOREIGN KEY/);
    expect(() =>
      db.$client.exec("delete from cost_books where slug = 'haushalt'"),
    ).toThrow(/FOREIGN KEY/);
    expect(() => db.$client.exec("delete from users where id = 'u2'")).toThrow(
      /FOREIGN KEY/,
    );
    db.$client.exec("delete from settlements where id = 's2'");
    db.$client.exec("delete from cost_books where slug = 'haushalt'");
    expect(rows(db, "select id, book_id from settlements")).toEqual([
      { id: "s1", book_id: null },
    ]);
    expect(rows(db, "pragma foreign_key_check")).toEqual([]);
  });

  it("keep book names and slugs unique, whatever the case", () => {
    const db = databaseAt("0025_calendar_target_remote_name");
    migrateDatabase(db);
    expect(() =>
      db.$client.exec(
        "insert into cost_books (id, name, slug) values ('b1', 'WOHNUNG', 'other')",
      ),
    ).toThrow(/UNIQUE/);
    expect(() =>
      db.$client.exec(
        "insert into cost_books (id, name, slug) values ('b1', 'Ferien', 'wohnung')",
      ),
    ).toThrow(/UNIQUE/);
    db.$client.exec(
      "insert into cost_books (id, name, slug) values ('b1', 'Ferien', 'ferien')",
    );
    expect(
      rows(
        db,
        "select default_split_mode, tax_relevant, sort_order, archived_at from cost_books where id = 'b1'",
      ),
    ).toEqual([
      {
        default_split_mode: "ownership",
        tax_relevant: 0,
        sort_order: 0,
        archived_at: null,
      },
    ]);
  });

  /**
   * What drizzle-kit writes to change a column of a table: a copy, a drop, a rename. Its PRAGMA lines do nothing inside
   * the migrator's transaction, so the migrator itself has to keep foreign keys off while a migration runs.
   */
  const REBUILD_PARENT = `PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE \`__new_parent\` (\`id\` text PRIMARY KEY NOT NULL, \`name\` text NOT NULL, \`extra\` text DEFAULT 'x' NOT NULL);--> statement-breakpoint
INSERT INTO \`__new_parent\`(\`id\`, \`name\`) SELECT \`id\`, \`name\` FROM \`parent\`;--> statement-breakpoint
DROP TABLE \`parent\`;--> statement-breakpoint
ALTER TABLE \`__new_parent\` RENAME TO \`parent\`;--> statement-breakpoint
PRAGMA foreign_keys=ON;`;

  const PARENT_AND_CHILDREN = `CREATE TABLE \`parent\` (\`id\` text PRIMARY KEY NOT NULL, \`name\` text NOT NULL);--> statement-breakpoint
CREATE TABLE \`owned\` (\`id\` text PRIMARY KEY NOT NULL, \`parent_id\` text NOT NULL, FOREIGN KEY (\`parent_id\`) REFERENCES \`parent\`(\`id\`) ON UPDATE no action ON DELETE cascade);--> statement-breakpoint
CREATE TABLE \`linked\` (\`id\` text PRIMARY KEY NOT NULL, \`parent_id\` text, FOREIGN KEY (\`parent_id\`) REFERENCES \`parent\`(\`id\`) ON UPDATE no action ON DELETE set null);`;

  const foreignKeys = (db: DB) =>
    rows(db, "pragma foreign_keys")[0].foreign_keys;

  it("keep the rows that reference a table a migration rebuilds, and switch foreign keys on again", () => {
    const db = emptyDatabase();
    const files: Record<string, string> = { "0000_start": PARENT_AND_CHILDREN };
    migrateDatabase(db, folderOf(files));
    db.$client.exec(`
      insert into parent (id, name) values ('p1', 'eins'), ('p2', 'zwei');
      insert into owned (id, parent_id) values ('o1', 'p1'), ('o2', 'p1'), ('o3', 'p2');
      insert into linked (id, parent_id) values ('l1', 'p1'), ('l2', null);
    `);

    files["0001_rebuild"] = REBUILD_PARENT;
    migrateDatabase(db, folderOf(files));

    expect(rows(db, "select id, name, extra from parent order by id")).toEqual([
      { id: "p1", name: "eins", extra: "x" },
      { id: "p2", name: "zwei", extra: "x" },
    ]);
    expect(rows(db, "select id, parent_id from owned order by id")).toEqual([
      { id: "o1", parent_id: "p1" },
      { id: "o2", parent_id: "p1" },
      { id: "o3", parent_id: "p2" },
    ]);
    expect(rows(db, "select id, parent_id from linked order by id")).toEqual([
      { id: "l1", parent_id: "p1" },
      { id: "l2", parent_id: null },
    ]);
    expect(foreignKeys(db)).toBe(1);

    // The rebuilt table is the parent again: the foreign keys act as before.
    db.$client.exec("delete from parent where id = 'p2'");
    expect(rows(db, "select id from owned order by id")).toEqual([
      { id: "o1" },
      { id: "o2" },
    ]);
    expect(() =>
      db.$client.exec(
        "insert into owned (id, parent_id) values ('o9', 'nobody')",
      ),
    ).toThrow(/FOREIGN KEY/);
  });

  it("refuse a migration that leaves a row pointing at nothing, and leave the database as it was", () => {
    const db = emptyDatabase();
    const files: Record<string, string> = { "0000_start": PARENT_AND_CHILDREN };
    migrateDatabase(db, folderOf(files));
    db.$client.exec(`
      insert into parent (id, name) values ('p1', 'eins');
      insert into owned (id, parent_id) values ('o1', 'p1');
    `);

    // With foreign keys off, deleting a parent removes nothing from its children: a migration has to do that itself.
    files["0001_forgot_the_children"] =
      "ALTER TABLE `parent` ADD `later` text;--> statement-breakpoint\nDELETE FROM `parent`;";
    const folder = folderOf(files);
    expect(() => migrateDatabase(db, folder)).toThrow(/owned.*parent/s);

    // Nothing of it stays: not the column, not the row, not the entry in the list of applied migrations.
    expect(rows(db, "select name from pragma_table_info('parent')")).toEqual([
      { name: "id" },
      { name: "name" },
    ]);
    expect(rows(db, "select id from parent")).toEqual([{ id: "p1" }]);
    expect(
      rows(db, "select count(*) as n from __drizzle_migrations")[0].n,
    ).toBe(1);
    expect(foreignKeys(db)).toBe(1);
    // It is refused again at the next start, not forgotten.
    expect(() => migrateDatabase(db, folder)).toThrow();
  });

  it("apply what is pending together or not at all", () => {
    const db = emptyDatabase();
    const files: Record<string, string> = { "0000_start": PARENT_AND_CHILDREN };
    migrateDatabase(db, folderOf(files));

    files["0001_fine"] = "ALTER TABLE `parent` ADD `a` text;";
    files["0002_dangling"] =
      "INSERT INTO `owned` (`id`, `parent_id`) VALUES ('o1', 'nobody');";
    expect(() => migrateDatabase(db, folderOf(files))).toThrow();

    expect(rows(db, "select name from pragma_table_info('parent')")).toEqual([
      { name: "id" },
      { name: "name" },
    ]);
    expect(
      rows(db, "select count(*) as n from __drizzle_migrations")[0].n,
    ).toBe(1);

    // Without the dangling row both go in.
    files["0002_dangling"] = "ALTER TABLE `parent` ADD `b` text;";
    migrateDatabase(db, folderOf(files));
    expect(
      rows(db, "select count(*) as n from __drizzle_migrations")[0].n,
    ).toBe(3);
    expect(foreignKeys(db)).toBe(1);
  });

  it("switch foreign keys on again when a migration fails for another reason", () => {
    const db = emptyDatabase();
    const files = {
      "0000_broken":
        "CREATE TABLE `a` (`id` text);--> statement-breakpoint\nSELECT * FROM `missing`;",
    };
    expect(() => migrateDatabase(db, folderOf(files))).toThrow(/missing/);
    expect(foreignKeys(db)).toBe(1);
    expect(rows(db, "select name from sqlite_master where name = 'a'")).toEqual(
      [],
    );
  });

  it("refuse to run inside a transaction, where the foreign keys pragma would silently do nothing", () => {
    const db = emptyDatabase();
    db.$client.exec("BEGIN");
    expect(() =>
      migrateDatabase(db, folderOf({ "0000_start": PARENT_AND_CHILDREN })),
    ).toThrow(/transaction/);
    db.$client.exec("ROLLBACK");
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
