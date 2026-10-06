# CLAUDE.md — hauswart

hauswart is a self-hosted apartment-management app for a household of two: recurring maintenance
tasks with completion tracking, documentation (markdown, uploads, Paperless-ngx links), device
inventory, defects, spare parts, contacts, costs, notifications, an iCal feed, a guest link and an
MCP server. Home Assistant, Paperless-ngx and Kept (finance) are optional adapters, never
requirements. Status: early development — the sections below describe the target architecture;
`(M0b)` marks pieces that do not exist yet.

## This repository is public

- **Never commit real data.** No real names, addresses, phone numbers, Home Assistant entity ids,
  Paperless document ids, hostnames, device serial numbers or amounts from real documents in code,
  fixtures, seeds, comments or commits. Use synthetic data and `example.org` hostnames. Real data
  lives only in gitignored `seed/local/` or is entered in the UI.
- The `leak-guard` hook blocks locally configured private terms (`.private-terms`, gitignored).
  If it fires, remove the data — never weaken the hook, the gitleaks config or add a term to a
  tracked file.
- Commit messages and PR texts follow the same rules. Never mention AI tools in them.

## Commands

```bash
bun dev                  # dev server
bun run verify           # format:check + lint + check + test — run before every commit
bun run format           # prettier --write
bun run lint:fix         # eslint --fix
bun run check            # paraglide compile + svelte-kit sync + svelte-check
bun run test             # vitest (unit)
bun run test:coverage
bun run build && bun run start
bun run db:generate      # after editing src/lib/server/schema.ts
bun run i18n             # recompile Paraglide messages (also runs on install and in check)
bun run leak-guard --all # scan the whole tree for private terms
bun run security         # semgrep, bun audit, trivy
```

Bun only — never npm, pnpm or yarn (`bunx` for one-off tools). Hooks run via prek:
`prek install` once per clone.

## Stack

Bun · SvelteKit (`svelte-adapter-bun`) · TypeScript strict · Svelte 5 runes · Tailwind CSS v4 ·
shadcn-svelte (`$lib/components/ui/`, add with `bunx shadcn-svelte@latest add <name>`) ·
`@lucide/svelte` · Drizzle ORM on SQLite via `bun:sqlite` · Zod · Paraglide JS (de base locale,
en) · Vitest.

## Architecture

REST-first: all domain logic sits behind a versioned JSON API under `/api/v1`. The Svelte frontend
consumes that API through a typed client — the same API a future native mobile app will use.

```
src/lib/api/schemas/             Zod request/response schemas — the contract, client-safe        (M0b)
src/lib/api/registry.ts          endpoint registry: method, path, schemas, authz                 (M0b)
src/lib/api/client.ts            typed fetch client generated from the registry                  (M0b)
src/lib/api/openapi.ts           registry → docs/openapi.json                                    (M0b)
src/lib/server/api/bind.ts       binds a registry entry to a service function + authz + Zod      (M0b)
src/lib/server/<domain>/         services: plain (ctx, input) functions, no HTTP types
src/lib/server/tasks/engine/     pure due-date engine: (rule, history, today) -> next due
src/lib/server/integrations/     optional adapters (homeassistant/, paperless/, kept/) — the core never imports these
src/lib/server/db.ts             SQLite connection (WAL, foreign keys); migrations run on startup
src/lib/server/schema.ts         Drizzle schema — one file, every table has created_at/updated_at
src/lib/server/crypto.ts         AES-256-GCM for stored secrets (HAUSWART_SECRET_KEY)
src/lib/money.ts                 minor-unit money type, parsing/formatting, ownership shares
src/lib/testing/                 useTestDB, createTestEvent, synthetic fixtures in fixtures/
src/routes/api/v1/**             one-liner route files: export the handler made by bind()        (M0b)
src/routes/api/health            liveness probe, no database
src/routes/(app)/                pages; they read and write through the typed client
messages/{de,en}.json            Paraglide messages (ICU); src/lib/paraglide is generated, gitignored
```

## Invariants

- **REST-first.** Domain logic lives in services and is reachable only through `/api/v1`. Pages
  call the typed client; no SvelteKit form actions for domain logic. A route file is a one-liner.
- **Zod at every boundary**: request bodies, query strings, env, integration payloads, imported
  files. Inside a boundary trust the types. One schema serves validation, types and OpenAPI.
- **Dates are `YYYY-MM-DD` strings in the household time zone** (`HAUSWART_TZ`); instants are
  `timestamp_ms` integers. Never derive a calendar date from `toISOString()` or the server zone.
- **Money is integer minor units** (`Minor`) plus an ISO 4217 code. Never floats. Cost splits use
  `shareOf` with `ownership_bps`.
- **Every query is scoped to the household/current user** and every endpoint has an entry in the
  authz matrix test. No endpoint returns data the caller may not see.
- **Integrations are adapters.** Nothing outside `integrations/<name>/` knows Home Assistant,
  Paperless or Kept; entities reference external ids opaquely and work without them. Adapters are
  tested against fake servers.
- **No swallowed errors.** No empty `catch`, no `catch { return null }` without logging and a
  user-visible outcome.
- **Never log PII**: names, addresses, contact details, document contents, tokens.
- **Every UI string goes through Paraglide**; add the key to `messages/de.json` and
  `messages/en.json` together (a test enforces identical key sets). German is the base locale.
- **Migrations**: edit `schema.ts`, run `bun run db:generate`, commit the generated file. Never
  edit an existing migration, never use `drizzle-kit push`.

## Svelte 5 and UI

Runes only: `$state`, `$derived`, `$effect`, `$props`, `{@render children()}`. No `export let`,
no `$:`, no `<slot />`, no stores for component state. Tailwind classes with `cn()` from
`$lib/utils`; no component CSS. Use shadcn-svelte components. Pages must work at 360 px width and
in dark mode. Every list has an empty state, every async action a pending and an error state.

## Testing

- Unit tests sit next to the code (`foo.ts` → `foo.test.ts`); database tests use `useTestDB()`.
- Engine tests are table-driven with an injected `today`/`now` — never read the clock inside the
  engine.
- Bug fixes start with a failing test.
- Fixtures are synthetic and live in `src/lib/testing/fixtures/`.

## Subagents (`.claude/agents/`)

| Agent         | Scope                                                                                 |
| ------------- | ------------------------------------------------------------------------------------- |
| `backend`     | schema, migrations, services, task engine, API schemas/registry/routes, authz tests   |
| `frontend`    | Svelte pages and components on top of the typed client, i18n strings, responsive UI   |
| `integration` | Home Assistant / Paperless / Kept adapters with fake servers; keeps the boundary rule |
| `reviewer`    | read-only review of a change against these invariants, leak, i18n and authz checks    |
| `researcher`  | read-only research on external systems and libraries, cited report                    |

Workflow: backend first (with tests and the API contract), then frontend against that contract,
integration work in parallel where it is independent, then `reviewer`. Skills in
`.claude/skills/`: `new-endpoint`, `new-table`, `new-trigger`, `verify`.

## Git

Conventional commits, lowercase (`feat: add task engine`, `fix: …`, `refactor:`, `chore:`,
`docs:`, `test:`, `ci:`). Run `bun run verify` before committing. Never commit `.private-terms`,
`.env`, `data/` or `seed/local/`.
