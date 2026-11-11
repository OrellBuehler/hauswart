---
paths:
  - "drizzle/**"
  - "drizzle.config.ts"
  - "src/lib/server/{schema,db,migrator,migration-copy,migrations.test}*.ts"
---

# Migrations

Edit `schema.ts`, run `bun run db:generate`, commit the generated file. Never edit an existing migration, never use
`drizzle-kit push`.

The migrator (`migrator.ts`) runs migrations with foreign
keys **off**, set before the transaction because the `PRAGMA foreign_keys=OFF` lines drizzle-kit writes around a table
rebuild do nothing inside it, so a rebuilt parent table keeps its children (no stash and restore needed), and it runs
`PRAGMA foreign_key_check` before committing and compares it with the same check taken before the migrations: references
that already dangled are logged by table and count (`migrations.dangling_references`, no row data) and left alone, but a
migration that adds to them (more rows for a pair of child and parent table) rolls back and the app refuses to start
(`MigrationIntegrityError`). Consecutive migrations that need the same foreign key setting form a **group**, applied
together or not at all: a failing group rolls back, the groups before it stay applied. Each group starts with
`BEGIN IMMEDIATE` and works the pending list out only then, so a second instance that looked before the first got in
does not run a migration that only changes data twice. **Safety copy**: before the first pending migration of a
database that already has applied migrations (not a fresh one, not `:memory:`) `takeSafetyCopy` (`migration-copy.ts`)
writes `<database>.pre-migrate-<UTC>.db` next to it with `VACUUM INTO` (through a `.partial` file; a second one in the
same second gets `-2`), keeps the newest three and logs `migrations.safety_copy` with the file name only. A copy that
cannot be written stops the start before anything is migrated; `HAUSWART_MIGRATION_BACKUP=false` turns it off (a value
that is neither true nor false throws, so a typo is not taken for off).
