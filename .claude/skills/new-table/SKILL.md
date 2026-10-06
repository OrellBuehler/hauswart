---
name: new-table
description: Add or change a database table in hauswart — Drizzle schema, generated migration, useTestDB test. Use whenever data needs a new table or column. Never edit an existing migration.
---

1. Edit `src/lib/server/schema.ts`. Use the shared helpers: `id()` for the primary key,
   `...timestamps` for `created_at`/`updated_at`, `minor("column")` for money in integer minor
   units. Dates are `text` in `YYYY-MM-DD`; instants are `integer(..., { mode: "timestamp_ms" })`.
   Add foreign keys with `onDelete` behaviour stated explicitly, and an index for every column used
   in a `where` or join. Closed value sets are exported `as const` tuples used with
   `text(..., { enum })`.
2. Generate the migration: `bun run db:generate`. Review the SQL file and commit it together with
   the schema change.
3. **Never edit an existing migration and never use `drizzle-kit push`.** A mistake in a committed
   migration is fixed by a new migration. A migration that is generated but not yet committed may
   be deleted together with its `drizzle/meta` snapshot entry and regenerated.
4. Test with `useTestDB()` from `$lib/testing/db`: it opens an in-memory database with every
   migration applied. Cover defaults, uniqueness, and cascades. Put the test next to the service
   that owns the table.
5. hauswart is a single household: domain tables are shared by all users and need no scoping
   column. Data that belongs to one user (tokens, sessions, connections, preferences) gets a
   `user_id` foreign key (`onDelete: "cascade"`) and an index; the service filters by it and a
   test shows that user A cannot see or change user B's rows.
6. Run the `verify` skill.
