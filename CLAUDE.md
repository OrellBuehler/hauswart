# CLAUDE.md — hauswart

hauswart is a self-hosted apartment-management app for a single household with a few users:
recurring maintenance tasks with completion tracking, documentation, device inventory, vehicles,
defects, spare parts, contacts, costs (books, splits, balances, budgets, recurring costs, a receipt
queue), insurance policies, appointments, notifications, iCal feeds, guest links, an installable web
app (PWA) and an MCP server served at `/api/v1/mcp`. Home Assistant, Paperless-ngx and Kept (finance)
are optional adapters, never requirements. Status: early development, all of the above exists.

There is one household, not many: all domain data is shared by every user. Only sessions, API
tokens, integration connections and preferences belong to a single user.

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
bun run openapi          # regenerate docs/openapi.json from the registry (a test fails if stale)
bun run i18n             # recompile Paraglide messages (also runs on install and in check)
bun run leak-guard --all # scan the whole tree for private terms
bun scripts/seed.ts --file seed/example.de.json --token hw_… [--url http://localhost:3000] [--update]
bun scripts/generate-pwa-icons.ts  # re-render static/icons from the logo (commit the PNGs)
bun run mcp              # stdio MCP server from source, for development (HAUSWART_URL, HAUSWART_TOKEN); the app serves MCP at /api/v1/mcp
bun run security         # semgrep, bun audit, trivy
```

Bun only — never npm, pnpm or yarn (`bunx` for one-off tools). Hooks run via prek:
`prek install` once per clone.

After `bun run check` or `bun run i18n` restart a running `bun dev`: regenerated route nodes and
message modules leave the dev client with a stale manifest.

## Stack

Bun · SvelteKit (`svelte-adapter-bun`) · TypeScript strict · Svelte 5 runes · Tailwind CSS v4 ·
shadcn-svelte (`$lib/components/ui/`, add with `bunx shadcn-svelte@latest add <name>`) ·
`@lucide/svelte` · Drizzle ORM on SQLite via `bun:sqlite` · Zod · Paraglide JS (de base locale,
en) · Vitest.

## Architecture

REST-first: all domain logic sits behind a versioned JSON API under `/api/v1`. The Svelte frontend
consumes that API through a typed client — the same API the native mobile app, Home Assistant and
the MCP server use.

```
src/lib/api/                  the contract, client-safe: enums.ts, scopes.ts, errors.ts, schemas/ (Zod per domain),
                              registry.ts (defineEndpoint + `endpoints`), client.ts (createApiClient -> api.call),
                              browser.ts (`api` for event handlers), openapi.ts (-> docs/openapi.json)
src/lib/server/api/           bind.ts (authn/authz, scopes, CSRF, Zod, errors), handlers/ (({ctx, params, query, body, event}) -> body)
src/lib/server/auth/          sessions, passwords, login + rate limits, API tokens, guards, routing, origin check
src/lib/server/<domain>/      services: plain functions, no HTTP types (tasks, costs, vehicles, documents, ...)
src/lib/<domain>/             client-safe pure logic and UI helpers of a domain (tasks/engine, costs, vehicles, ...)
src/lib/server/integrations/  optional adapters (homeassistant/, paperless/, kept/); the core never imports these
src/lib/server/service.ts     ServiceContext {db, now}, notFound/conflict/invalidField, isUniqueViolation
src/lib/server/pagination.ts  opaque cursors: paginateArray (offset) and pageOf (keyset)
src/lib/server/events.ts      typed in-process domain events, emitted inside the writer's transaction;
                              domain-events.ts wires reactions and attachment owners at startup and in useTestDB()
src/lib/server/schema.ts      Drizzle schema — one file, every table has created_at/updated_at
src/lib/server/db.ts          SQLite connection (WAL, foreign keys); migrator.ts runs migrations on startup
src/lib/server/crypto.ts      AES-256-GCM for stored secrets (HAUSWART_SECRET_KEY)
src/lib/dates.ts              YYYY-MM-DD date math + time-zone helpers (client-safe)
src/lib/money.ts              minor-unit money type, parsing/formatting, ownership shares
src/lib/testing/              useTestDB, createTestUser/Token, createTestEvent, callRoute, fixtures/
src/lib/components/           ui/ (shadcn-svelte), app/ (shell), one folder per domain
src/hooks.server.ts           init (secret key, time zone, migrations, schedulers, adapters) + auth gate + Paraglide locale
src/routes/api/v1/**          one-liner route files: export const GET = bind(endpoints.x, handler)
src/routes/api/health         liveness probe, no database
src/routes/{login,setup}      the only pages that exist outside the app shell; they call the API
src/routes/(app)/             pages; they read and write through the typed client
src/routes/g/, api/public/    public guest pages and the iCal feed, outside the registry
mcp/src/                      MCP server, a REST client like the others (client-safe imports only); mcp/README.md
docs/openapi.json             generated; commit it with every contract change
messages/{de,en}.json         Paraglide messages (ICU); src/lib/paraglide is generated, gitignored
```

The file-by-file map is `.claude/reference/source-map.md`.

## Domain rules (`.claude/rules/`)

How each domain behaves (tables, endpoints, status codes, edge cases, what is deliberately not built)
is written down per domain. The files are path-scoped: Claude Code loads one by itself when a file it
covers is read or edited. Read the file yourself before planning work in a domain, when a question
is about its behaviour, or when your tool does not load rules. Where a rule file says `see "Vehicles"`,
it means the file about that subject.

- `tasks.md`: the due-date engine and `task_state`, `counter_delta.orEvery`, completions, rotation, notifications, seed files
- `signals-integrations.md`: signal ingest, watch list, auto-complete, hint reactions, delivery and the "done" tap, connections, the SSRF host policy, the Home Assistant adapter, areas as rooms
- `costs.md`: cost entries, split math, cost books, currency, summary, settlements and balances, CSV, the finance inbox, the provider seam, back-links, bill tasks
- `costs-tags-budgets-recurring.md`: cost tags, budgets and their status, recurring costs and their booking
- `finance-matching.md`: matching bank transactions with entries made by hand (`link` suggestions, `GET /finance/matches`)
- `kept.md`: the Kept adapter: connection settings, sync, books, back-links
- `costs-ui.md`: the costs pages: books in the address, balances, moving entries, quick entry, receipts page, review flag, tags, budgets, recurring costs, bank matching
- `receipt-queue.md`: `ai_tasks`: upload, booking for a task, complete, dismiss, idempotency, the lease, the preview, its MCP tools
- `documents.md`: the per-person document provider (Paperless-ngx): seam, cache and sync, links, files, warranty dates, suggestions, pushing, note write-back
- `docs-attachments-search-backup.md`: documentation pages and renderings, attachments and the file store, binary and multipart endpoints, the FTS5 search index, backup
- `parts-defects-comments.md`: domain events, stock movements, the defect status machine, the comments registry
- `vehicles.md`: vehicle details, the vehicle-only rule, odometer readings and their signal, tire sets, fuel log, statistics, task templates, and the vehicle UI
- `insurance-asset-notes.md`: insurance policies and the cancellation reminder, asset notes (to a defect, resolved through the service log), and their UI
- `appointments.md`: appointments (timed and all-day), completing with a task's occurrence, `nextAppointment`, the iCal part, and their UI
- `sharing.md`: share tokens, iCal feeds, the emergency page and PDF, guest links and the public `/g` pages
- `calendar-sync.md`: pushing items into a connected calendar: provider seam, reconcile engine, runs, scheduler, the Home Assistant calendar provider, and the settings UI
- `mcp.md`: the MCP server: the stateless HTTP endpoint, tool conventions, name resolution, tool groups, tests
- `pwa.md`: the service worker and its caching rule, serving `/sw.js`, the update flow, the manifest
- `auth-api.md`: principals, endpoint auth modes, CSRF and the origin check, errors, rate limits, hardening, the markdown worker, public paths, password change
- `migrations.md`: how the migrator runs migrations: foreign keys off, integrity check, groups, safety copy
- `ui.md`: phones and the installed app: shell and bottom bar, touch sizes, overflow, dialogs and the back gesture, refreshing after a dialog

Keep them current: a change in behaviour updates the rule file of its domain in the same commit, and
a new domain gets its own file with `paths`. This file stays for what every session needs. A rule
file over 40,000 characters is cut off when it loads, so split one that grows past that.

## Invariants

- **REST-first.** Domain logic lives in services and is reachable only through `/api/v1`. Pages
  call the typed client; no SvelteKit form actions for domain logic. A route file is a one-liner
  and the registry guard test (`src/routes/api/registry.test.ts`) enforces it.
- **Zod at every boundary**: request bodies, query strings, env, integration payloads, imported
  files. Inside a boundary trust the types. One schema serves validation, types and OpenAPI.
- **Dates are `YYYY-MM-DD` strings in the household time zone** (`HAUSWART_TZ`); instants are
  `timestamp_ms` integers in the database and UTC ISO strings on the wire (`toIso`). Never derive a
  calendar date from `toISOString()` or the server zone; handlers get `ctx.today`.
- **Money is integer minor units** (`Minor`) plus an ISO 4217 code. Never floats. Cost splits are
  largest-remainder (`allocate`, parts add up exactly) over frozen shares taken from `ownership_bps`.
- **One household, several users.** Domain data is shared by all users and needs no per-user
  scoping. Per-user resources (sessions, API tokens, integration connections - Paperless and Kept included, with their
  document cache and finance suggestions - preferences) are
  filtered by the caller's id in the service and invisible to other users (404, never 403). Every
  endpoint is covered by the authz matrix (`src/routes/authz.test.ts`, generated from the registry):
  anonymous, wrong credential kind, missing scope, member vs administrator, cross-origin cookie
  request. No endpoint returns data the caller may not see.
- **Integrations are adapters.** Nothing outside `integrations/<name>/` knows Home Assistant,
  Paperless or Kept (the core says "finance provider"; the boundary test also fails on the name Kept); entities reference external ids opaquely and work without them. Adapters are
  tested against fake servers. `src/lib/server/integrations/boundary.test.ts` fails when anything
  but `integrations/**`, `hooks.server.ts` or an allow-listed route imports from `integrations/`.
- **No swallowed errors.** No empty `catch`, no `catch { return null }` without logging and a
  user-visible outcome.
- **Never log PII**: names, addresses, contact details, document contents, tokens.
- **Every UI string goes through Paraglide**; add the key to `messages/de.json` and
  `messages/en.json` together (a test enforces identical key sets). German is the base locale.
- **Migrations**: edit `schema.ts`, run `bun run db:generate`, commit the generated file. Never
  edit an existing migration, never use `drizzle-kit push`. How the migrator runs them (foreign keys
  off, integrity check, groups, safety copy) is in `.claude/rules/migrations.md`.

## Svelte 5 and UI

Runes only: `$state`, `$derived`, `$effect`, `$props`, `{@render children()}`. No `export let`,
no `$:`, no `<slot />`, no stores for component state. Tailwind classes with `cn()` from
`$lib/utils`; no component CSS. Use shadcn-svelte components. Pages must work at 360 px width and
in dark mode. Every list has an empty state, every async action a pending and an error state.

The rules for phones (bottom bar and `--bottom-nav`, touch sizes from the `ui/*` primitives, overflow,
dialogs and the back gesture, `invalidateAfterOverlay` / `gotoFromOverlay`) are in
`.claude/rules/ui.md`; what each domain's pages do is in that domain's rule file.

## Testing

- Unit tests sit next to the code (`foo.ts` → `foo.test.ts`); database tests use `useTestDB()`.
- Route tests call the real handler through the real hook with `callRoute(GET, { session | bearer,
json, origin, … })` from `$lib/testing/route`; users and tokens come from `createTestUser`,
  `loginTestUser` and `createTestToken`. Rate limiters are reset before every test.
- Engine tests are table-driven with an injected `today`/`now` — never read the clock inside the
  engine.
- Bug fixes start with a failing test.
- Fixtures are synthetic and live in `src/lib/testing/fixtures/`.
- File tests call `useTestFilesDir()` (`$lib/testing/files`: temp `HAUSWART_FILES_DIR`, sample pdf/svg/
  html/heic bytes); `callRoute` returns file bodies as `Uint8Array`.

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

## Releasing

Version numbers follow `package.json` (`APP_VERSION` and the MCP server read it; the image takes it from
the build argument). To release: bump `version` in `package.json`, add a `## <version>` section to
`CHANGELOG.md`, merge, then publish a GitHub release for the tag `v<version>`. `docker.yml` refuses a tag
that differs from `package.json`, runs the checks, builds the image, runs `scripts/docker-smoke.sh` against
it (setup, Markdown worker, image upload, PDFs, MCP over HTTP, iCal, guest page) and pushes
`ghcr.io/<owner>/<repo>` with `<version>`, `<major>.<minor>` and `latest`. Run the same smoke test locally: start the image with `ORIGIN` and `HAUSWART_COOKIE_SECURE=false` and an empty
volume, then `scripts/docker-smoke.sh <url> <version>`.

## Git

Conventional commits, lowercase (`feat: add task engine`, `fix: …`, `refactor:`, `chore:`,
`docs:`, `test:`, `ci:`). Run `bun run verify` before committing. Never commit `.private-terms`,
`.env`, `data/` or `seed/local/`.
