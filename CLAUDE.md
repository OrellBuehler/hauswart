# CLAUDE.md — hauswart

hauswart is a self-hosted apartment-management app for a single household with a few users:
recurring maintenance tasks with completion tracking, documentation (markdown, uploads,
Paperless-ngx links), device inventory, defects, spare parts, contacts, costs, notifications, an
iCal feed, a guest link and an MCP server. Home Assistant, Paperless-ngx and Kept (finance) are
optional adapters, never requirements. Status: early development — authentication, the API spine
and the task core (rooms, assets, tasks, completions, notifications, dashboard) exist, as do contacts,
spare parts, the service log, care hints, defects (with a PDF export), the warranty overview and
generic comments; documents, costs, the iCal feed, the guest link and the MCP server are still to come.

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
consumes that API through a typed client — the same API the native mobile app, Home Assistant and
the MCP server use.

```
src/lib/api/enums.ts             roles, locales, token kinds — client-safe constants
src/lib/api/scopes.ts            scope enum (read, write, docs:write, costs:write, ha:action, admin)
src/lib/api/errors.ts            stable error codes + ApiError
src/lib/api/schemas/             Zod request/response schemas per domain — the contract, client-safe
src/lib/api/registry.ts          defineEndpoint() + `endpoints`: method, path, schemas, auth, scopes
src/lib/api/client.ts            createApiClient(fetch, baseUrl?, {token?}) -> api.call(endpoint, input)
src/lib/api/browser.ts           `api`: the client for event handlers in the browser
src/lib/api/openapi.ts           registry -> OpenAPI 3.1; `bun run openapi` writes docs/openapi.json
src/lib/server/api/bind.ts       bind(endpoint, handler): authn/authz, scopes, CSRF, Zod, errors
src/lib/server/api/handlers/     handlers: ({ ctx, params, query, body, event }) -> response body
src/lib/server/auth/             sessions, passwords, login + rate limits, API tokens, guards, routing
src/lib/server/users/            user service (create, first admin, update, profile)
src/lib/server/<domain>/         services: plain functions, no HTTP types
src/lib/server/docs/markdown*.ts markdown -> sanitized html; async variants run marked in a worker (see below)
src/lib/dates.ts                 YYYY-MM-DD date math + time-zone helpers (client-safe)
src/lib/tasks/engine/            pure due-date engine (client-safe): evaluateTask, estimates, rotation, upcoming
src/lib/server/service.ts        ServiceContext {db, now}, notFound/conflict/invalidField, isUniqueViolation
src/lib/server/pagination.ts     opaque cursors: paginateArray (offset) and pageOf (keyset)
src/lib/server/household/        the singleton household row: name, time zone (follows HAUSWART_TZ), settings
src/lib/server/rooms/            rooms CRUD, slugs
src/lib/server/assets/           assets (devices, plants, fixtures), slugs, QR slugs, archive
src/lib/server/tasks/            tasks CRUD, previewTrigger, evaluator (task_state cache), signals (provider seam),
                                 completions (complete/skip/undo/snooze), preparations, dashboard, stats, scheduler
src/lib/server/notifications/    in-app notifications, generateNotifications, channel registry for outward delivery
src/lib/server/events.ts         typed in-process domain events (completionRecorded/Revoked), emitted inside the writer's transaction
src/lib/server/domain-events.ts  registerDomainEventHandlers(): wires reactions (parts stock) at startup and in useTestDB()
src/lib/server/contacts/         contacts CRUD + search, links to assets (role per link)
src/lib/server/parts/            spare parts: CRUD, stock movements, "ordered" state, links to assets/tasks, order-now, completion events
src/lib/server/service-log/      per-asset work log (also written with a task completion by the complete handler)
src/lib/server/hints/            per-asset care hints (tip/rule/warning), pinned, ordered, optional signal reaction (stored only)
src/lib/server/defects/          defects (Mängel): status machine, events, handover deadline, reminder task, timeline, PDF export
src/lib/server/warranties/       warranty overview + status (valid / expiring ≤ 90 days / expired); feeds the dashboard
src/lib/server/comments/         generic comments on any entity: commentable registry, soft delete, notifications, counts
src/lib/server/pdf/render.ts     shared pdfmake wrapper (A4, Roboto from node_modules, no network or file access)
src/lib/server/seed/import.ts    seed importer (through the REST API); CLI in scripts/seed.ts, data in seed/
src/lib/server/integrations/     optional adapters (homeassistant/, paperless/, kept/) — the core never imports these
src/lib/server/db.ts             SQLite connection (WAL, foreign keys); migrations run on startup
src/lib/server/schema.ts         Drizzle schema — one file, every table has created_at/updated_at
src/lib/server/crypto.ts         AES-256-GCM for stored secrets (HAUSWART_SECRET_KEY)
src/lib/money.ts                 minor-unit money type, parsing/formatting, ownership shares
src/lib/testing/                 useTestDB, createTestUser/Token, createTestEvent, callRoute, fixtures/
src/hooks.server.ts              init (secret key, time zone, migrations) + auth gate + Paraglide locale
src/routes/api/v1/**             one-liner route files: export const GET = bind(endpoints.x, handler)
src/routes/api/health            liveness probe, no database
src/routes/{login,setup}         the only pages that exist outside the app shell; they call the API
src/routes/(app)/                pages; they read and write through the typed client
docs/openapi.json                generated; commit it with every contract change
messages/{de,en}.json            Paraglide messages (ICU); src/lib/paraglide is generated, gitignored
```

### Tasks, evaluation and notifications

- **The engine decides, the database remembers.** `task_state` holds the engine's last verdict per
  task (status, due date, occurrence key, estimate, current assignee). It is a cache: `evaluateAll`
  rebuilds it from `tasks` and the non-revoked `task_completions`. A task is re-evaluated when it is
  created, edited, completed, skipped, undone or snoozed (synchronously, before the response) and
  every five minutes by the scheduler (`registerEvaluator()` in the startup hook; it also runs
  `generateNotifications`). Lists, the dashboard and notifications read the cache.
- **Live readings come through a seam.** `setSignalProvider()` (`tasks/signals.ts`) is how an
  adapter supplies entity states, history and calendar dates; without one, signal-based triggers
  report `unknown`. A failing provider is logged by name and treated as "no signals".
- **A completion settles the occurrence the task shows** (`occurrenceKey` defaults to the cached
  one; `dueDateAtCompletion` is stored with it). Sources: a session is `manual` (or `qr` /
  `notification` when it says so); a token is attributed by its kind (`mcp`, `ha`, otherwise
  `api`) and its own `source` field is ignored. `idempotencyKey` makes retries return the first
  completion (200 instead of 201). Undo is a soft revoke within 7 days of recording, by any member.
- **Rotation** is computed in the evaluator (`nextAssignee`); the "fair" strategy weighs minutes of
  work (task effort, 15 if unset) of the last 90 days.
- **Notifications** are rows per person with a Paraglide `titleKey` plus `params` (rendered by the
  reader). `dedupeKey` = `<taskId>:<occurrence>:<stage>[:n]:<userId>`; stages are a preparation
  becoming relevant, due soon, due, overdue (when it becomes overdue, then weekly, four in all) and
  one digest per person per day after the household's digest time (skipped when empty). Snoozed and
  archived tasks are silent. `userId` null means household-wide (shared read state). Outward
  delivery is a `NotificationChannel` registered with `registerNotificationChannel`; the in-app
  list needs none.
- **Seed files** (`seedSchema`, `seed/*.json`; real data in gitignored `seed/local/`) are imported
  by `scripts/seed.ts` through the REST API and matched by `key`, so repeating it changes nothing:
  rooms and assets by slug, tasks by `externalSource: "seed"` + `externalRef`, preparations by title.
  Existing entries are left alone unless `--update`. Changing the household needs the admin scope.

### Parts, defects, comments and other M3 domains

- **Events keep domains apart.** `completeTask`/`undoCompletion` emit `completionRecorded` /
  `completionRevoked` (`events.ts`) inside the same SQLite transaction as the change; the parts
  service subscribes (`parts/events.ts`) and the tasks service knows nothing about parts. A
  listener that throws rolls the completion back. Register new reactions in `domain-events.ts`.
- **Stock** only changes through movements (`part_movements`, with `completionId` for task usage).
  Completing a `done` task takes `task_parts.qty` out (never below zero, the movement records the
  actual amount); undo books the net back as a `correction`. Manual `used` needs a negative delta,
  `bought` a positive one and ends a pending order. `orderNow` = engine `orderNowItems` over
  active tasks with linked parts, counting what is on order as stock. An `order_part` preparation is
  `in_stock_skip` while the part's stock covers its qty.
- **Defects**: transitions in `DEFECT_TRANSITIONS` (active statuses reach any other; fixed/rejected
  only reopen); every status change writes a `defect_events` row; remarks are generic comments and
  `GET /defects/{id}/timeline` merges both. The deadline defaults to household handover date +
  `defectDeadlineMonths` (`deadlineSource` handover) and is recomputed when the household changes.
  A deadline keeps one `one_off` reminder task (`externalSource: "defect"`, category `defect`, system
  text in the base language) that is archived when the defect is fixed/rejected or has no deadline.
- **Comments** (`comments` table, `entityType` + `entityId`): a kind of entity is commentable once
  it is in `comments/registry.ts` (`exists`, `title`, `url`, optional `audience`); `doc_page` waits
  for the docs milestone (`registerCommentable`). Deleting an entity removes its comments through
  `AFTER DELETE` triggers (migration `0004`): add one per new commentable table. Delete is soft
  (empty body, `deleted: true`), edit is author-only (403 otherwise), delete is author or admin. A new
  comment notifies the other involved members (`notification_comment`). Tasks, assets and defects
  carry `commentCount`.
- **PDF endpoints** declare `responseType: "pdf"` in the registry; the handler returns a `Response`
  (checked for `application/pdf` outside production), OpenAPI documents `application/pdf`, the typed
  client returns the `Response` and `endpointUrl()` builds a plain download link. pdfmake is
  external to the bundle (`vite.config.ts`) and read from `node_modules` at runtime.
- **Hint reactions** (`signalReactionSchema`, type `signal_change`) are stored with the hint and
  executed by an adapter later; the core only validates and lists them (`GET /hints?reactive=true`).

### Authentication and the API spine

- **Principals.** The hook resolves the caller into `event.locals` (`user`, `session`, `token`): the
  `hauswart_session` cookie (sha256-hashed 32-byte token, 30 days, sliding refresh), or
  `Authorization: Bearer hw_…` — bearer tokens are honoured on `/api/v1/` paths only and never fall
  back to the cookie. `resolvePrincipal` turns locals into `{auth: 'session'|'token', user, scopes}`.
  Sessions hold every scope their role allows; a token holds its scopes capped by its owner's
  current role (`admin` only for administrators).
- **Endpoint auth modes**: `session` (cookie only), `bearer` (token only), `both`, `public`.
  `scopes` lists what the caller needs (all of them; `[]` = any authenticated caller). The hook only
  turns anonymous callers away (redirect to `/login?redirectTo=…`, `/setup` while there are no
  users, a 401 envelope for `/api/*`); `bind` is the real gate and enforces mode and scopes.
- **CSRF** (in `bind`): a state-changing request authenticated by cookie — and every endpoint with
  `setsSession` (login, setup) — needs `Origin` equal to the app origin and `Content-Type:
application/json` (`multipart/form-data` for multipart endpoints), else 403 `csrf_failed`. Bearer
  requests skip it. Set `ORIGIN` behind a reverse proxy.
- **Errors** are always `{error: {code, message, details?}}` with the codes in
  `src/lib/api/errors.ts`; services throw `AuthError`-style domain errors or `ApiError`, `bind`
  maps them. Unknown errors become 500 `internal` and are logged by name and code only.
- **Rate limits**: failed password attempts (login and device-token login share one budget, per
  user + client address, per address, per user); 300 requests/min per bearer token; 30
  state-changing requests/min per client address on public endpoints (whatever the caller sends
  as credentials). Client addresses are keyed as IPv4, or the /64 for IPv6 (IPv4-mapped IPv6 is
  IPv4). In-memory, so behind a proxy set `ADDRESS_HEADER`/`XFF_DEPTH`. 429 carries `Retry-After`.
- **Hardening**: every response carries `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy` and `Permissions-Policy` (hook); pages get a nonce-based CSP from `kit.csp`
  (svelte.config.js), so inline scripts need `%sveltekit.nonce%` (the theme script lives in
  `app.html` for that reason). Unexpected errors on `/api/*` become the 500 envelope. Sessions end
  180 days after login at the latest; a scheduler (`auth/purge.ts`) deletes sessions that expired
  over 7 days ago and tokens that were revoked or expired over 30 days ago. `HAUSWART_SETUP_TOKEN`,
  if set, guards first-run setup. A password reset revokes all of the user's API tokens; demoting
  an administrator revokes the tokens with the `admin` scope; `POST /users/{id}/revoke-tokens`
  does it on demand.
- **Markdown** (`server/docs/markdown.ts`): marked is quadratic on some input and recursive on
  nesting, so documents go through `renderMarkdownAsync` / `extractPlainTextAsync` /
  `extractHeadingsAsync` (cap 200 KB, worker thread with a 2 s timeout -> `MarkdownError`
  `too_complex`; sanitising and secret stripping stay on the main thread). The sync functions only
  take up to 2 KB. `bun run build` also bundles the worker to `build/server/markdown.worker.js`.
  Secret blocks fail closed for guests: any `:::secret…` line (any indentation, fence or html
  state) hides the rest of its block.
- **Response validation** against the endpoint's schema runs outside production only.
- **Public paths** (`src/lib/server/auth/routing.ts`): `/login`, `/setup`, `/api/health`,
  `/api/v1/health`, `/api/v1/openapi.json`, `/api/v1/setup`, `/api/v1/auth/login`,
  `/api/v1/auth/token`, `/api/public/*`, `/g/*`. A new `public` endpoint must be added there (a
  test fails otherwise).
- Not built yet, structure kept: TOTP, passkeys and recovery codes (extend `AUTH_EVENT_TYPES`, add
  a step after `verifyCredentials` in `auth/login.ts`), self-service password change.

## Invariants

- **REST-first.** Domain logic lives in services and is reachable only through `/api/v1`. Pages
  call the typed client; no SvelteKit form actions for domain logic. A route file is a one-liner
  and the registry guard test (`src/routes/api/registry.test.ts`) enforces it.
- **Zod at every boundary**: request bodies, query strings, env, integration payloads, imported
  files. Inside a boundary trust the types. One schema serves validation, types and OpenAPI.
- **Dates are `YYYY-MM-DD` strings in the household time zone** (`HAUSWART_TZ`); instants are
  `timestamp_ms` integers in the database and UTC ISO strings on the wire (`toIso`). Never derive a
  calendar date from `toISOString()` or the server zone; handlers get `ctx.today`.
- **Money is integer minor units** (`Minor`) plus an ISO 4217 code. Never floats. Cost splits use
  `shareOf` with `ownership_bps`.
- **One household, several users.** Domain data is shared by all users and needs no per-user
  scoping. Per-user resources (sessions, API tokens, integration connections, preferences) are
  filtered by the caller's id in the service and invisible to other users (404, never 403). Every
  endpoint is covered by the authz matrix (`src/routes/authz.test.ts`, generated from the registry):
  anonymous, wrong credential kind, missing scope, member vs administrator, cross-origin cookie
  request. No endpoint returns data the caller may not see.
- **Integrations are adapters.** Nothing outside `integrations/<name>/` knows Home Assistant,
  Paperless or Kept; entities reference external ids opaquely and work without them. Adapters are
  tested against fake servers. `src/lib/server/integrations/boundary.test.ts` fails when anything
  but `integrations/**`, `hooks.server.ts` or an allow-listed route imports from `integrations/`.
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
- Route tests call the real handler through the real hook with `callRoute(GET, { session | bearer,
json, origin, … })` from `$lib/testing/route`; users and tokens come from `createTestUser`,
  `loginTestUser` and `createTestToken`. Rate limiters are reset before every test.
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
