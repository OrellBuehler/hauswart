# CLAUDE.md — hauswart

hauswart is a self-hosted apartment-management app for a single household with a few users:
recurring maintenance tasks with completion tracking, documentation (markdown, uploads,
Paperless-ngx links), device inventory, defects, spare parts, contacts, costs, notifications, an
iCal feed, a guest link and an MCP server. Home Assistant, Paperless-ngx and Kept (finance) are
optional adapters, never requirements. Status: early development — authentication, the API spine,
the task core (rooms, assets, tasks, completions, notifications, dashboard), documentation (pages,
attachments, search, file backup), contacts, spare parts, the service log, care hints, defects (with
a PDF export), the warranty overview, generic comments, iCal feeds, the emergency page data and guest
links, costs (with the settlement between the people and a CSV export) and the per-person finance
connection (Kept) exist; Home Assistant is wired end to end (readings, auto-complete, hint reactions,
push notifications with a "done" button, areas taken over as rooms; see "Signals, integrations and delivery"); Paperless-ngx is wired as
a per-person document provider (links, previews, warranty dates, pushing attachments; see "Documents and the
document provider"); the MCP server covers the task core, documentation, defects, parts, contacts,
comments, hints, service log, warranties and costs (see `mcp/README.md`).

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
bun run mcp              # MCP server from source (HAUSWART_URL, HAUSWART_TOKEN)
bun run mcp:build        # compile it to dist/hauswart-mcp (gitignored)
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
src/lib/server/auth/             sessions, passwords (+ change-password.ts), login + rate limits, API tokens, guards, routing,
                                 origin.ts (cross-site write check for everything outside /api/v1)
src/lib/server/users/            user service (create, first admin, update, profile)
src/lib/server/<domain>/         services: plain functions, no HTTP types
src/lib/server/docs/markdown*.ts markdown -> sanitized html; async variants run marked in a worker (see below)
src/lib/server/docs/pages.ts     documentation pages: CRUD, rev concurrency, revisions, backlinks, cached renderings
src/lib/server/docs/render.ts    page rendering for members/guests, link resolution, `{token}` placeholder
src/lib/server/files/            content-addressed file store, image pipeline, sniffing, serving headers (see below)
src/lib/server/attachments/      attachment rows, owner registry, orphan sweeper (see "Documentation" below)
src/lib/server/search/           GET /search over the FTS5 index (`search_fts`, kept by triggers)
src/lib/server/backup/           daily VACUUM INTO backup + incremental mirror of the files directory
src/lib/dates.ts                 YYYY-MM-DD date math + time-zone helpers (client-safe)
src/lib/tasks/engine/            pure due-date engine (client-safe): evaluateTask, estimates, rotation, upcoming
src/lib/server/service.ts        ServiceContext {db, now}, notFound/conflict/invalidField, isUniqueViolation
src/lib/server/pagination.ts     opaque cursors: paginateArray (offset) and pageOf (keyset)
src/lib/server/household/        the singleton household row: name, time zone (follows HAUSWART_TZ), settings
src/lib/server/rooms/            rooms CRUD, slugs; areas.ts takes the areas of a connected system over as rooms (see "Signals,
                                 integrations and delivery")
src/lib/server/assets/           assets (devices, plants, fixtures), slugs, QR slugs, archive
src/lib/server/tasks/            tasks CRUD, previewTrigger, evaluator (task_state cache), signals (provider seam),
                                 completions (complete/skip/undo/snooze), preparations, dashboard, stats, scheduler
src/lib/server/notifications/    in-app notifications, generateNotifications, channel registry, deliveries (preferences, quiet hours,
                                 one-time action tokens, retries), the "done" action, per-person targets and preferences
src/lib/server/signals/          readings the adapters store (`signals`, `signal_samples`, `external_dates`), watch list,
                                 ingest (auto-complete, hint reactions, re-evaluation), worker for the time-driven parts
src/lib/server/connections/      generic connections to outside systems (encrypted token, health), adapter registry
src/lib/server/net/host-policy.ts  which addresses the server may connect to (link-local, metadata, loopback), DNS check
src/lib/hosts.ts                 host allow-list entries: normalisation + exact matching (client-safe)
src/lib/server/documents/        documents of an outside document system: provider seam (`provider.ts`), per-person cache, links,
                                 warranty from documents, suggestions, uploads, search (see "Documents and the document provider")
src/lib/server/events.ts         typed in-process domain events (completionRecorded/Revoked), emitted inside the writer's transaction
src/lib/server/domain-events.ts  registerDomainEventHandlers(): wires reactions (parts stock) and the domain attachment owners at startup and in useTestDB()
src/lib/server/contacts/         contacts CRUD + search, links to assets (role per link)
src/lib/server/parts/            spare parts: CRUD, stock movements, "ordered" state, links to assets/tasks, order-now, completion events
src/lib/server/service-log/      per-asset work log (also written with a task completion by the complete handler)
src/lib/server/costs/            cost entries: split.ts (frozen shares), costs.ts (CRUD, list), summary.ts (year totals, settlement),
                                 csv.ts, totals.ts (cost sums on defects and service log entries)
src/lib/server/finance/          generic finance-provider seam: providers.ts (registry), suggestions.ts (the private inbox, accept,
                                 dismiss), bill-tasks.ts (tasks that follow bills)
src/lib/server/hints/            per-asset care hints (tip/rule/warning), pinned, ordered, optional signal reaction (stored only)
src/lib/server/defects/          defects (Mängel): status machine, events, handover deadline, reminder task, timeline, PDF export
src/lib/server/warranties/       warranty overview + status (valid / expiring ≤ 90 days / expired); feeds the dashboard
src/lib/server/comments/         generic comments on any entity: commentable registry, soft delete, notifications, counts
src/lib/server/calendar/         ical.ts (pure RFC 5545 builder), feeds.ts (ical_feeds CRUD, token), feed.ts (events of a feed),
                                 public.ts (the public .ics response: limits, ETag/304)
src/lib/server/share/            guest links: tokens.ts, guest-links.ts (CRUD, window, PIN counter), guest-access.ts (token ->
                                 state, PIN attempts, signed unlock cookie), guest-view.ts (what a link shows), guest-http.ts
                                 (gate + PIN action for the /g routes, response headers), purge.ts
src/lib/server/emergency/        emergency page data (members) and the "Notfall- & Vertretungsblatt" PDF
src/lib/server/pdf/render.ts     shared pdfmake wrapper (A4, Roboto from node_modules, no network or file access)
src/lib/server/seed/import.ts    seed importer (through the REST API); CLI in scripts/seed.ts, data in seed/
mcp/src/                         stdio MCP server (client-safe imports only): index.ts entry, server.ts (whoami handshake,
                                 scope-based registration), tool.ts (defineTool), context.ts (client + name resolvers),
                                 tools/ (registry in tools/index.ts, one file per domain); mcp/README.md is the setup guide
src/lib/server/integrations/     optional adapters (homeassistant/, paperless/, kept/) — the core never imports these;
                                 homeassistant/ has client, ws, helpers, fake-server plus adapter (settings, pickers), channel
                                 (`ha_notify`), sync (polling, calendars) and scheduler, wired by `registerHomeAssistant()`;
                                 paperless/ has client, fake-server plus adapter (settings, pickers), provider, sync, scheduler,
                                 wired by `registerPaperless()`; kept/ has client, mappers, fake-server plus config, adapter
                                 (settings, pickers), sync and scheduler, wired by `registerKept()` (see "Costs and finance providers")
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
- **Live readings come from the database.** The evaluator reads `signals`, `signal_samples` and
  `external_dates` (`tasks/signals.ts`, `loadSignalsFromDb`); `setSignalProvider()` replaces that
  (tests). Without readings, signal-based triggers report `unknown`. A failing provider is logged by
  name and treated as "no signals". The evaluator also keeps `task_state.counterBaseline` (the first
  fresh reading of a counter task, until a completion snapshots one) and `activeSince` (since when a
  state condition holds; forgotten when it stops holding).
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

### Signals, integrations and delivery

- **Adapters only fetch; the core decides.** An adapter turns what it read into `SignalReading`s and
  calls `ingestSignals(ctx, readings, source)` (`signals/ingest.ts`): `upsertSignals` stores them (a
  reading without a value is skipped, so the last known value stays and the evaluator marks it stale
  after 24 h; numeric samples are written on change and every 6 h, pruned after a year), then
  auto-complete rules, hint reactions, re-evaluation of the tasks that read a changed signal, due
  reactions and `generateNotifications` run. Calendar dates go through `replaceExternalDates` and
  `afterCalendarSync`. The first sight of a signal is never a "change".
- **Watch list**: `watchedEntities(ctx)` (`signals/watch.ts`) = entity ids of active tasks' counter /
  state / calendar triggers (+ `estimateFrom`), auto-complete rules, preparation `leadValue`s and hint
  reactions, plus the calendar subscriptions (`haCalendarKey`). Saving a task, preparation or hint
  reaction emits `signalNeedsChanged` (`events.ts`) so an adapter reads soon, not at the next tick.
- **Auto-complete** (`autoComplete` on every recurring trigger, plus `autoCompleteOnReset` on counters):
  `{type: "counter_reset", entityId, minDrop}` (drop detected with the engine's `detectCounterReset`)
  or `{type: "state_change", entityId, to, from?}`. The task is completed by the system (source `ha`,
  no user, counter snapshot = new value) with `idempotencyKey` `auto:<taskId>:<entityId>:<changedAt>`,
  so replaying a change completes nothing twice. A completion of a counter task without an explicit
  `counterValue` snapshots the counter (`completeTask`), so the next period starts there.
- **Hint reactions**: a matching transition (`toState`, optional `fromState`) inserts a
  `pending_reactions` row (unique per hint and transition) due after `delayMinutes`; it is cancelled
  when the signal leaves `toState` first. `processDueReactions` (run by the core worker every 30 s and
  after each ingest) creates a `hint` notification (`notification_hint`: asset, title) per recipient
  (`all`, `assignee` of the linked task, or a list) and hands it to the channels. Restart-safe: rows only.
- **Worker** (`registerSignalWorker()`, started in `init()`): due reactions, `retryDeliveries`, and
  housekeeping (samples, unused calendar dates, delivery records older than 90 days).
- **Delivery** (`notifications/deliveries.ts`): `NotificationChannel.deliver(notification, recipient,
{actions, targets?})` returns one outcome per target (`sent|failed|skipped`). Before calling a channel
  the core applies the person's `notification_prefs` (push on/off, `pushStages`, quiet hours in the
  household zone; held-back deliveries are `deferred` rows and sent by `retryDeliveries` afterwards) and
  mints a one-time token (24 random bytes, base64url, sha256 stored, valid 7 days) for the task stages
  prep / due_soon / due / overdue, passed as `actions: [{id: token, kind: "complete"}]`. Every outcome
  is a `notification_deliveries` row (status, error code, attempts, token hash, occurrence key).
  Failed targets are retried twice (2, 4 min); stale ones (read, settled occurrence, older than a day)
  are dropped. In-app notifications never depend on any of this.
- **The "done" tap**: `POST /api/v1/ha/action {"action": "HW_DONE_<token>"}`, bearer token of kind `ha`
  with scope `ha:action` (another kind is 403). The token resolves to the notification's task
  occurrence and person; the completion is attributed to that person (source `notification`), not to
  the calling token. Unknown or malformed action 404; expired token, deleted/archived task, an occurrence
  settled otherwise, or an undone completion 410 `gone`. A repeated tap answers 200 with the first
  completion (`replayed: true`) - chosen over 410 so a retried request after a lost response is safe.
- **Per-person targets**: `GET/PUT /api/v1/me/notification-settings` (own only; replace-all of
  preferences and up to 10 targets; `ha_notify` target = notify service name `^[a-z0-9_]+$`).
- **Connections** (`connections` table, `connections/connections.ts`): one household row per kind
  (`userId` null; partial unique index) or one per person (`INTEGRATION_LEVELS` in `enums.ts`).
  `GET /integrations` (never the token; the address of a household connection only for administrators),
  `PUT|DELETE /integrations/{kind}` and `POST .../test` (household kinds need an administrator; a
  changed address needs the token again), pickers `GET /integrations/{kind}/{entities,notify-services,
calendars,devices,areas}` (any member; 404 not connected, 502 `upstream_error` with `details.code`). An
  adapter registers `registerIntegration({kind, validate?, test, describe, operations})`; it throws
  `IntegrationError(code, message)`. Health (`status`, `lastError` code, `consecutiveFailures`) is
  recorded by the adapter; `dueForAttempt`/`backoffMs` give the 1, 2, 4 ... 15 minute backoff.
- **Where a connection may point** (`connections.ts` `vetConnectionTarget`, `net/host-policy.ts`, `integrations/http.ts`
  `guardHost`): the server fetches what a person enters, and Paperless and Kept are per person, so this is an SSRF
  surface. The household setting `integrationHostAllowlist` (hosts as `host` or `host:port`, normalised by
  `normalizeHostEntry`: lower case, IDN as punycode; exact match, no wildcards; an entry without a port allows every
  port; max 50; `PATCH /household`, shown in `GET /household` only with the `admin` scope) applies when a **non-admin
  saves a user-level connection**: the host must be listed, else 403 `forbidden` with a message that names the host.
  Administrators may save any host and saving never adds to the list (keep it explicit); an empty list means members
  cannot connect. For everybody: link-local (169.254.0.0/16, fe80::/10), the metadata endpoints (100.100.100.200,
  fd00:ec2::254, `metadata.google.internal`) and IPv4-mapped / NAT64 spellings of them are refused after name resolution
  (every answered address is checked) at save time (400 field error on `baseUrl`) and before **every** request in
  `fetchOnce` and the Home Assistant WebSocket (`blocked_host`, shown as the connection's `lastError`). Loopback
  (127.0.0.0/8, ::1, 0.0.0.0) only for administrators and household-wide connections: `ResolvedConnection.allowLoopback`
  is computed from the owner's current role on every `resolveConnection`, so a demotion applies at once (403 at save,
  `blocked_host` at request time). A name that does not resolve is left to the request. DNS rebinding between the check
  and `fetch` is not closed (no pinning of the connect address); that is why the check repeats per request and a
  connection's responses only ever go to its owner. Tests run with `setLenientHostPolicy(true)` (vitest setup: loopback
  allowed, names not resolved, metadata still blocked); tests of the policy switch it off and stub `setHostResolver`.
  Members saving in tests need `allowIntegrationHosts(db, host)` (`$lib/testing/integrations`).
- **Home Assistant adapter** (`registerHomeAssistant()` in `init()`): scheduler (overlap guard, unref,
  injectable intervals) reads the watched entities every 60 s and the calendars (next 60 days, per
  subscription key, household zone) every 6 h and at once for a new calendar; saving a connection reads
  immediately. `ha_notify` channel: `notify/<target>` with title and text rendered in the recipient's
  language, a link built from `config.appUrl` (else `ORIGIN`, else the bare path), tag `hw-task-<id>`,
  button "Erledigt"/"Done" = `HW_DONE_<token>`. Entity ids that are not valid are never requested; an
  entity HA does not know is only counted. Assets can carry `externalSource`/`externalRef`; the devices
  picker lists registry devices matching no asset (reference, name, or model with overlapping name).
  Entity names in code and tests stay synthetic (`sensor.example_*`).
- **Areas as rooms** (`rooms/areas.ts`, `connections/areas.ts` client-safe): the adapter operation `areas` answers
  `{id, name, floor}` (floor names from `config/floor_registry/list`, which an older Home Assistant refuses: then no
  floors, logged by code; ordered by floor level, then name) and knows nothing about rooms; the core says "areas of
  a connected system" and stores the id in `rooms.haAreaId` (a name kept for the column, no provider is recorded).
  `GET /integrations/{kind}/areas` adds `roomId` (the room that stores that id, compared without case and punctuation).
  `POST /rooms/import-areas {kind, areaIds}` (scope `write`) re-reads the areas, so names come from the system and
  never from the caller, then in one transaction, per area in the order given: a room that stores the id is
  `unchanged`; else an unlinked room of the same name (case, accents and `ue`/`ü` spellings ignored) takes the id
  (`linked`; a stored id that no listed area has counts as unlinked, one that belongs to another listed area does not);
  else a room is `created` (name cut to 100 characters, sort order at the end, slug as for any room); an id the system
  does not list is `not_found`. Repeating changes nothing, and a later rename in Home Assistant never touches the room.
  There is no unique index on `haAreaId`: the room form's area picker (`components/connections/area-picker.svelte`,
  a plain field without a usable connection) disables areas another room already stores. `matchAreaToRoom` is shared by
  the service and the import dialog (`area-import-dialog.svelte`, "Aus Home Assistant übernehmen" on the rooms page)
  so the preview and the result agree. Device suggestions carry `areaId` so `roomForArea` matches by id first.

### Costs and finance providers

- **Cost entries** (`cost_entries`, domain data shared by the household): `date`, `title`,
  `amountMinor` (positive = expense, negative = refund, never 0) + `currency`, `category`
  (`repair|utilities|renewal_fund|purchase|mortgage_interest|mortgage_principal|insurance|renovation|maintenance|taxes_fees|other`),
  optional asset, room, defect and service log entry (a service log entry or defect fills in
  asset/room when none is given; deleting the target only unlinks), `payee`, `notes`,
  `paidByUserId`, `splitMode`, `countsAsExpense`, `deductible` (`unknown|maintenance|investment|no`: the
  Swiss tax distinction between value-preserving and value-increasing work), `source`
  (`manual|finance_transaction|finance_bill`). `countsAsExpense` defaults to false for
  `mortgage_principal` (equity, not a cost) and follows a category change unless the person overrode it.
  Entries can be commented on and carry receipts (attachments, owner `cost`).
- **Split math** (`money.ts` `allocate`, `costs/split.ts`): shares are frozen per entry in
  `cost_entry_shares` (basis points, sum exactly 10000), so a later ownership change never rewrites
  history. `ownership` weighs people by `users.ownership_bps` (normalised, 0% pays nothing, all zero
  falls back to equal), `equal` weighs everybody the same, `custom` takes explicit shares (sum 10000),
  `none` is not shared. A person's part of an amount is the largest-remainder split of its absolute
  value (parts add up to the amount exactly; a refund splits exactly like the expense it reverses);
  ties go to the earlier user id. PATCH with `splitMode` ownership/equal splits again by today's shares;
  changing only the amount keeps the frozen shares.
- **Currency**: entries may be in any currency, but every total, the settlement and the dashboard
  count the household currency only; `otherCurrencyCount` says how many entries were left out (the CSV
  has them all).
- **Summary** (`GET /costs/summary?year=`): `expenseTotalMinor` and the per category / month (always 12) /
  asset (top 10) / tax class breakdowns count entries with `countsAsExpense`; `equityTotalMinor` is the rest.
  **Settlement** covers every split entry with a payer, equity included (it is about who paid cash):
  `balanceMinor` = paid - share (positive = the others owe this person), `settlement` = greedy payments
  from the largest debtor to the largest creditor ("A owes B CHF x"). Split entries without a payer are
  counted in `unassignedPayerCount`, never guessed. The dashboard carries `costsYearToDate`.
- **CSV** (`GET /costs/export.csv?year=`, binary `text/csv`): UTF-8 with BOM, `;` separated, CRLF,
  fixed English column names (`costs/csv.ts` `CSV_COLUMNS`), amounts as plain decimals with a point, no
  thousands separator and the currency's own precision (`-12.50`, `1500` for JPY) so they parse the same
  everywhere; text cells that start with `= + - @` tab or CR get an apostrophe (formula injection).
- **Defects and service log entries** carry `costs: {totalMinor, count}` (correlated subqueries in the
  list select, household currency, refunds netted); their legacy `costEntryId` column is unused.
- **The inbox** (`finance_suggestions`): what a finance provider offers one person - `cost`, `asset` or
  `bill_task` - with the status `pending|accepted|dismissed` and a payload shaped like the API's. It is
  **private to its owner**: the list, accept and dismiss only ever select `user_id = caller`, another
  person's id is a 404 exactly like a missing one, and the finance address of an entry
  (`providerUrl`) is shown only to the person who booked it. `(connection, kind, ref)` is unique: a
  seen item keeps its status (a dismissed one stays dismissed, an accepted one never changes, only a
  pending one takes a fresher payload). Accepting books the cost (paid by the owner, split by ownership
  unless the body overrides category, title, asset/room/defect/service log, payer, split, expense flag,
  deductible), creates the asset (with `externalSource: finance_transaction`; the cost of the same
  transaction gets the asset, in either order) or the bill task, in one transaction. A cost booked from a
  provider item remembers it (`providerConnectionId` + `providerRef`, unique) so it is never booked twice,
  even after the entry is deleted.
- **Provider seam**: an adapter calls `registerFinanceProvider({kind, sync})`; `POST /finance/sync` runs
  the caller's own connection now (404 without one, a provider failure is a normal `ok: false` answer).
  `GET /integrations/{kind}/categories|accounts` are pickers for the caller's own connection.
- **Back-links** are the provider's business but the bookkeeping is generic: a provider entry has
  `providerLinkId` and `linkSyncedAt` (null = to write; set again to null when title or asset change); a
  deleted entry with a written link queues a `cost_link_removals` row in the same transaction; the core
  emits `financeLinksPending`. Failures stay queued and are retried by the next sync.
- **Bill tasks** (`finance/bill-tasks.ts`): a task with `externalSource: finance_bill`, `externalRef:
<connectionId>:<billId>` (the connection in the reference keeps two people's bills apart), category
  `payment`, assigned to the connection's owner (fixed, notify the assignee), trigger `kept_bill`
  (`status` open/overdue/paid/cancelled). A paid bill completes it with a system completion
  (`source` = the provider's name, no user), a bill that becomes payable again revokes that, a cancelled bill
  settles it without a completion, archived tasks are never touched again, bills without a due date are
  skipped. The task is **visible to the whole household** with creditor, invoice number, amount and due
  date: that is what the person consents to by switching `billTasks` on. Housekeeping archives tasks
  settled for 90 days and those of a deleted connection.

#### Kept adapter (`integrations/kept/`)

- **Connection** per person (`kept`, `INTEGRATION_LEVELS` user): `PUT /integrations/kept` with `config`
  `{categoryMap: {keptCategoryId: costCategory}, purchaseCategoryIds, autoAcceptCategoryIds (subset of the
map), billTasks, billCreditorFilter (case-insensitive exact creditor names; applies to bill tasks and to paid-bill cost offers), billCostCategory, assignBillTasksTo:
"owner", syncFrom}`; unknown keys are dropped. Everything is opt-in: no category, nothing read. `test` calls
  `me()` and reports `info.missingScopes` (of `transactions:read, bills:read, links:write, categories:read`).
- **Sync** (`syncConnection`, scheduler every 30 min, backoff 1, 2, 4 ... 15 min via the connection's
  health, immediately when a connection is saved, overlap guard per connection and in the scheduler; each
  part runs on its own and the first failure becomes the connection's `lastError` code):
  - transactions of every mapped or purchase category since the cursor (`finance_sync_state`, per scope:
    a different category set or `syncFrom` starts over; first run from `syncFrom` or 1 January) become `cost`
    suggestions via `transactionToCostSeed`, or cost entries at once for automatic categories; outgoing payments
    from purchase categories also `asset` suggestions. A failed item keeps the cursor where it was.
  - with `billTasks`: open and overdue bills (creditor filter) become bill tasks; tasks of bills that left the
    list are read individually (paid/cancelled/open again, 404 = archived).
  - with `billCostCategory`: paid invoices become `finance_bill` cost suggestions - **unless a transaction
    covers the bill**: a pending bill offer is withdrawn when its transaction arrives, a decided one (accepted or
    dismissed) makes the transaction arrive as dismissed, so a payment is booked once.
  - back-links: a booked entry gets `upsertLink` on its transaction or bill (`source: hauswart`, label title
    (+ asset), url `ORIGIN/costs/<id>`; skipped without `ORIGIN`), a deleted one gets `deleteLink`; a failing
    call is logged by code and retried next sync, an item Kept does not know (404, 409, 400) is given up on. A
    links-only round also runs shortly after a cost from Kept is booked, edited or deleted.
- Logs carry codes only (`kept.transaction_failed {code}`), never titles, amounts, creditors or tokens.

### Documents and the document provider

- **Per person, never shared.** A document system (Paperless-ngx) is connected by every person with their own token
  (`INTEGRATION_LEVELS.paperless = "user"`, `connections.userId`), so everybody reads exactly what their own account
  may. Every document call (list, meta, preview, thumb, download, link creation, push) goes through the caller's own
  connection: no connection or a disabled one is 404, and another person's token is never used. A document the account
  cannot see is 404 whatever other accounts see; an upstream refusal is 502 `upstream_error` with `details.code`
  (`unauthorized`, `forbidden`, `too_large`, `timeout`, ...). Nothing about a document is logged.
- **The seam** (`documents/provider.ts`): the core knows a `DocumentProvider` (`search`, `get` -> null when not visible,
  `openFile`, `webUrl`, `startUpload`, `awaitUpload`, `shareUploaded`, `addNote`), registered by the adapter
  (`registerDocumentProvider`) and named only by `DOCUMENT_PROVIDERS` in `enums.ts`. The core also reads the connection
  settings (`documentProviderConfigSchema` in `api/schemas/documents.ts`: `sharedTagIds`, `warrantyFieldId`,
  `warrantyExtendedFieldId`, `uploadTagIds`, `uploadStoragePathId`, `uploadCorrespondentId`, `shareGroupIds`,
  `receiptTagIds`, `manualTagIds`, `writeBackNotes`, `appUrl`); every id is the person's choice, picked from
  `GET /integrations/{kind}/{tags,correspondents,custom-fields,groups,storage-paths}` (own connection; `q` narrows).
- **Tables** (migrations `0010_documents` and, for the triggers, `0011_document_link_cleanup`): `external_documents` (cache per connection: title, date, correspondent, tags,
  mime, pages, notes count, the two warranty dates, `ownerVisible`; unique per connection and external id; a row with
  `ownerVisible = false` keeps no content, it only says "asked, not shown"), `external_document_sync` (address and
  scope the cache was built for, newest modification seen, last full read), `document_links` (provider, external id,
  generic owner `asset|room|page|task|defect|service_log|part|contact` + id, `role`, `label`, the maker's connection;
  unique per document, owner and role), `document_uploads` (push jobs). `AFTER DELETE` triggers on the eight owner
  tables remove the links of a deleted owner (cascades included); a new link owner type needs its trigger and an entry
  in `documents/owners.ts` (it reuses the comments registry for title and url).
- **Sync** (`registerPaperless()` in `init()`, `integrations/paperless/sync.ts`, scheduler every 30 minutes, soon after
  a connection is saved - backoff ignored - and after a link was made so other people's caches catch up): per
  connection, the documents with a tag of `sharedTagIds` + `receiptTagIds` + `manualTagIds`, incremental by `modified`
  (a second of overlap), and every run every document a link points at (links made at another address are skipped; a
  linked document the account cannot see becomes `ownerVisible = false` without content). A full read (first run, other
  address or scope or warranty fields, once a day) also drops rows nothing needs. Outcome and backoff (1, 2, 4 ... 15
  min) are recorded on the connection like for Home Assistant.
- **Links** (`GET|POST /document-links`, `DELETE /document-links/{id}`): creating one needs the caller's account to read
  the document (404 otherwise) and caches what it saw; 409 for the same document, owner and role. The link DTO has
  `available` (the caller's own cache row is visible and from the same instance): another person's private document
  shows as not shared, with no title, no `document`, no file urls. A page owner needs `docs:write` (like attachments).
  `GET /documents` lists the caller's synced documents (filters `tag`, `correspondent`, `linked`) or, with `q`, searches
  live (title and text, at most 100 hits); every item has `linkedTo`. `GET /documents/{provider}/{id}` is asked live.
- **Files** (`preview`, `thumb`, `download[?original=1]`): binary endpoints that stream through the caller's connection
  (25 MB cap, redirects refused, `too_large` before any byte when declared, a stream error beyond it). Only PDF, raster
  images and plain text are inline; everything else is `application/octet-stream` + `attachment`. `nosniff`, a CSP,
  `Cache-Control: private, max-age=300`.
- **Warranty from documents** (`documents/warranty.ts`, `assets.warrantySource` `manual|document`): after a link (role
  `receipt` or `warranty` on an asset) and after every sync, an asset whose dates are empty or `document` takes the
  latest date of each field of its documents; a manual edit that changes a date switches to `manual` and is never
  overwritten; a document without a date changes nothing.
- **Suggestions** (`GET /documents/suggestions?kind=asset|contact`, from the caller's own cache only): receipts (a
  `receiptTagIds` tag) with a warranty date and no linked asset; correspondents of the synced documents that no contact
  stands for. A contact made from a correspondent carries `externalSource = "document_correspondent"`, `externalRef =
"<provider>:<correspondentId>"` (provider-scoped, not connection-scoped: contacts are the household's, the household
  is assumed to use one instance per provider).
- **Pushing** (`POST /attachments/{id}/push-to-documents` -> 202 + job, poll `GET /documents/uploads/{jobId}`, own jobs
  only): uploads with the configured tags, storage path and correspondent, waits for the consumption task (10 minutes,
  polled every 2 s), sets owner = the account and view/change groups = `shareGroupIds` (skipped without groups; a
  failure is job `warning = permissions_failed`, the document and link stay), links the document to the attachment's
  owner with the given role (hint attachments are refused), writes the note. A file the provider already holds is
  linked as it is when the account can read it (`duplicate: true`), else the job fails `duplicate`. Jobs are rows
  (`queued|uploading|processing|done|failed`, `errorCode` a short code): at startup a `processing` job resumes, the
  others fail `interrupted`; a second push of a file still being handled returns the same job.
- **Note write-back** (`writeBackNotes`): after a link, in the background, a note `Verknüpft in hauswart: <app url><path
of the owner>` is added to the document unless an identical note exists (writes per document are serialised); a
  failure is logged by name and never fails the link. The app address is `appUrl`, else `ORIGIN`, else the bare path.
- **Search**: linked documents appear as hits of type `document` (id `<provider>:<externalId>`, url = the first thing
  they are linked to), matched by title only, only from the caller's own cache (so never somebody's private document).
- **Tests** live in `integrations/paperless/` (a core test must not import an adapter): `useFakePaperless()` gives a
  fake with several accounts (`addAccount`) and `strictPermissions` (visibility by owner, view users and groups), the
  harness registers the adapter and speeds up polling; `documents.api.test.ts`, `uploads.api.test.ts`, `sync.test.ts`,
  `scheduler.test.ts` cover isolation, sync, links, files, suggestions, search, pushes and notes.

### Documentation, attachments, search and backup

- **Pages** (`doc_pages`, `doc_page_revisions`; `docs/pages.ts`): `bodyMd` is the source; the
  renderings are caches written on save through the worker-backed async markdown functions
  (`renderedHtmlMember` with secret blocks, `renderedHtmlGuest` without, `plainText` WITHOUT secrets,
  `headingsJson` = `{member, guest}`). `MarkdownError` becomes 400 `invalid_request` with
  `details.code` `too_large` / `too_complex` (`unavailable` is 503), `FileError` 400/413/415 with
  `details.code` (see `api/errors.ts`). `PATCH` needs `rev` (409 `conflict`, `details.currentRev`; the
  update itself is guarded by `rev`); every successful save bumps `rev` and writes a revision (50
  kept). Restoring saves the old title/body as a new revision. Backlinks are computed on read from
  `[[slug]]` references in other pages. `preview` is a reserved slug (static route). Pages are
  written with the `docs:write` scope; `read` sees everything including secret blocks (members and
  tokens alike; only the guest rendering strips them).
- **Link resolution at render time**: `attachment:<id>` resolves only to attachments that exist
  (member: `/api/v1/attachments/<id>/content`; guest: only guest-visible ones, as
  `/g/{token}/files/<id>`), `[[slug]]` to `/docs/<slug>` (guest: `/g/{token}/docs/<slug>`; slug as
  `slugify` writes it). The guest HTML keeps the literal `{token}`; the future guest route must call
  `fillGuestToken(html, token)` (`docs/render.ts`) when it serves a page. Deleting an attachment or
  flipping `guestVisible` re-renders the pages that embed it (`onAttachmentsChanged` listener,
  started in `init()` by `startAttachmentRerender`; only the two HTML caches change, guarded by `rev`).
- **Attachments** (`attachments`): one row per upload, generic owner `ownerType` + `ownerId` without
  foreign keys (`asset|room|page|task|defect|service_log|part|asset_hint|contact|cost`), files stored
  once by sha256 in `HAUSWART_FILES_DIR` (`files/store.ts`: images re-encoded, metadata stripped,
  thumbnail; PDFs as uploaded; HEIC/SVG/HTML/GIF refused). Owner existence is checked through the
  registry in `attachments/owners.ts`: asset, room, page and task are built in; defect, service_log,
  part, asset_hint and contact are registered by `registerDomainAttachmentOwners()`
  (`attachments/domain-owners.ts`, called from `registerDomainEventHandlers()`, so from `init()` and
  `useTestDB()`). A new owner type registers with `registerAttachmentOwner(type, existsFn)` **from
  `init()`** (never from a module that is only loaded with its routes) and calls
  `removeOwnedAttachments(ctx, type, id)` from its delete service (done for all ten; deleting an
  asset also removes the attachments of its service log entries and hints, whose rows go by cascade
  without a foreign key to follow). A type nobody registered is a 400 field error on `ownerType`. Uploading, patching or deleting an attachment of a page needs `docs:write`,
  others `write`. `deleteIfUnreferenced` keeps files younger than a minute, so a daily orphan sweep
  (`startFileSweeper`) removes what deletions left behind. `assets.photoAttachmentId` must be an
  image attachment owned by that asset (set it with an update; it cannot be set on create); the asset
  also carries `photoUrl`, the thumbnail URL for `<img src>`.
- **Binary endpoints** (file content, PDF exports): `responseType: "binary"` + `contentTypes` in the
  registry, `response: binaryResponseSchema` as placeholder. The handler returns a finished
  `Response` (`bind` authenticates, parses and passes it through, outside production it checks the
  status and that the content type is one of `contentTypes`, and adds `Cache-Control: no-store` when
  the handler set none). OpenAPI documents `string/binary` per content type. `createApiClient().call`
  returns the raw `Response` (for downloads with a token); use `endpointUrl(endpoint, {params, query})`
  for `<img src>` and plain download links. Stored files are served with `files/serve.ts` (nosniff,
  CSP, ETag = sha256, `private, immutable`); the PDF export is `application/pdf`, `no-store`. pdfmake
  is external to the bundle (`vite.config.ts`) and read from `node_modules` at runtime.
- **Multipart bodies** are passed to `api.call` as a plain object (files as `File`, the rest
  strings); the client builds the `FormData`. In route tests use `callRoute(..., { form })`.
- **Search** (`search_fts`, FTS5, created in custom migration `0006_search_index`): triggers on pages,
  assets, rooms, tasks, defects (title, description, location), contacts (name, company, notes; never
  phone, e-mail or address), parts (name, part number, supplier, notes) and asset hints (title, body)
  keep it current (archived assets, tasks, pages and parts are dropped). No secret text enters the
  index: pages index `plain_text`; every other free text is cut off at the first `:::` when it
  mentions "secret" anywhere. Hit `url`s are the UI routes (`/docs/<slug>`, `/assets/<id>` also for
  plants and hints, `/rooms/<id>`, `/tasks/<id>`, `/defects/<id>`, `/parts/<id>`, `/contacts/<id>`).
  New searchable entities need their own triggers in a new migration and an entry in `URLS`
  (`search/search.ts`). Queries become quoted prefix terms (`ftsExpression`), so no FTS syntax reaches SQLite.
- **Backup** (`backup/`): on by default (`HAUSWART_BACKUP_DIR` default `./data/backups`, set it empty
  to turn off; `HAUSWART_BACKUP_KEEP` default 14). Hourly check: a `VACUUM INTO` copy
  (`hauswart-backup-<UTC>.db`) when the newest is a day old, then `mirrorFiles` copies the stored
  files missing in `<dir>/files` (never overwrites, never deletes).

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
  it is in `comments/registry.ts` (`exists`, `title`, `url`, optional `audience`; the urls are the UI
  routes, `/docs/<slug>` for pages). Deleting an entity removes its comments through
  `AFTER DELETE` triggers (migrations `0004` and `0007` for pages): add one per new commentable table. Delete is soft
  (empty body, `deleted: true`), edit is author-only (403 otherwise), delete is author or admin. A new
  comment notifies the other involved members (`notification_comment`). Tasks, assets, defects, hints,
  service log entries, pages and cost entries carry `commentCount`; cost entries are commentable too
  (trigger in migration `0013`).
- **Hint reactions** (`signalReactionSchema`, type `signal_change`) are stored with the hint
  (`GET /hints?reactive=true`) and executed by `signals/reactions.ts`, see below.

### iCal feeds, emergency page and guest links

- **Tokens** (`share/tokens.ts`): 32 random bytes base64url; only the sha256 is stored and looked up
  (indexed by hash, then `timingSafeEqual`). A malformed token is rejected before the database.
  Feeds also keep `tokenEnc` (AES-GCM, `crypto.ts`) so the owner can see the address again (`url` in
  the DTO, only for the owner); guest links store no plaintext: the address is returned once on
  create and rotate. Rotating replaces the hash (old address dead at once); revoking keeps the row
  (hash stays, feed `tokenEnc` is wiped) until `purgeDeadShareLinks` deletes rows revoked or expired
  over 30 days ago (runs with the credential purge).
- **Calendar feeds** (`ical_feeds`; `/api/v1/calendar-feeds`, session only, own feeds only, 10 per
  user): the public address is `/api/public/cal/<token>.ics` (`routes/api/public/cal/[token].ics`,
  outside the registry and OpenAPI, listed as public in the authz inventory). Failures are all the same
  404; limits: 240 requests/min per address, 120/min per feed, and an address that presents 20
  unknown tokens in 15 minutes is blocked (`shareMissLimiter`, peeked before the lookup). Answers with
  `text/calendar`, strong ETag (sha256 of the body) with 304, `private, max-age=900`, `noindex`,
  `no-referrer`. Content (`calendar/feed.ts`): next occurrence of every active, not snoozed task
  with a date (scope `mine` = current assignee is the owner or `assignMode` none; `all` = every
  task); a `min_per_period` window is a multi-day span; estimates only with `includeEstimated`
  (TENTATIVE, `~` prefix, medium confidence, within 45 days, no alarm); preparations as "Vorbereiten:
  ..." on due date minus `leadDays` (not done, not skipped by stock); defect deadlines of open defects
  (a defect's reminder task is skipped: the defect event stands for it); warranty ends within 365
  days. Only titles, places and dates: never task descriptions, notes, comments, secrets. UID
  `task-<id>-<occurrenceKey>@hauswart` (`prep-`, `defect-`, `warranty-` alike), LAST-MODIFIED/DTSTAMP/
  SEQUENCE from the row's `updatedAt` (never from `task_state`, which the evaluator rewrites every
  five minutes), events sorted, so the bytes only change with the content. Alarm = `alarmTime` in the
  household zone, `alarmDaysBefore` days ahead (1 = evening before). Texts are Paraglide messages
  with the feed's locale (`m.key(params, {locale})`).
- **Emergency page**: `GET /api/v1/emergency` (read scope) = emergency + rules pages (member HTML,
  secrets included), emergency contacts (full), `showOnEmergency` assets with pinned hints.
  `GET /api/v1/emergency/export.pdf` is the A4 sheet; secrets only with `?includeSecrets=1|true`
  (then a red confidentiality box on top and "Vertraulich" in the footer). The text of pages and
  hints comes from the markdown renderer's HTML (guest audience = secrets stripped, fail closed),
  turned into paragraphs by `htmlToBlocks`. `emergencyDocument` returns the pdfmake content so tests
  can read what is on the sheet.
- **Guest links** (`guest_links`; `/api/v1/guest-links`, session only, any member manages all):
  `expiresAt` required and at most 90 days away (also on update), `startsAt` optional, `pin` 4 to 8
  digits (argon2id), `includeSecrets`, `sections` (`emergency|rules|contacts|devices|howto`) and
  explicit `pageIds`; `DELETE` revokes. Content is shared only when **both** the flag on the item and
  the link agree: pages need `guestVisible` and a selected page section (emergency, rules, howto) or
  their id in `pageIds`; contacts need `guestVisible` (section `emergency` shows those marked
  emergency, `contacts` all of them, never notes or address); devices (section `devices`) are assets
  with `showOnEmergency` or a guest-visible hint, with only their guest-visible hints; secret blocks
  only with `includeSecrets`. Files (`/g/<token>/files/<id>`) need the attachment's own `guestVisible`
  and an owner the link shows (a shared page, or a guest-visible hint of a listed device); anything
  else is a 404 like a missing file.
- **Public pages** `/g/[token]` (+ `docs/[slug]`, `files/[id]`) are SSR only (`csr = false`, no JS)
  and use `+page.server.ts` loads, not the API (inventory: public). Every request passes
  `guestGate` (address and link limits, token lookup). Unknown, revoked, expired, not-yet-valid and
  PIN-locked links answer the same 404 page (German and English text, no detail); only unknown
  tokens count as guesses. The PIN gate is the form action `default` on the home and docs pages:
  5 wrong PINs per link and address, 10 per link and 20 per address in 15 minutes, 30 wrong PINs in
  a row close the link until a member sets a PIN again (`pinFailures`); a correct PIN sets the
  cookie `hauswart_guest` (path `/g/<token>`, HttpOnly, 12 h at most and never past the expiry), an
  HMAC over link id, PIN-hash fingerprint and expiry (`signValue`), so changing the PIN ends all
  unlocks. The hook adds `Cache-Control: no-store`, `X-Robots-Tag: noindex`, `Referrer-Policy:
same-origin` to everything under `/g/` (the token in the path never leaves the site; browsers still send the
  real `Origin` on the PIN form, and `Origin: null` with `Sec-Fetch-Site: same-origin` is accepted as a fallback, see CSRF). Language
  is the link's `locale` (explicit `{locale}` option, not the visitor's). A visit counts (`viewCount`, `lastViewedAt`) at most every 10 minutes.
  Guest HTML is `renderedHtmlGuest` with `fillGuestToken`; with `includeSecrets` it is rendered live
  (60 s in-memory cache). Rendered HTML is the only `{@html}` (`components/guest/guest-html.svelte`).

### MCP server

`mcp/` is a stdio server for Claude (Claude Code, Desktop) built on `@modelcontextprotocol/sdk` with
Zod 4 input shapes. It is a REST client like the others: `createApiClient(fetch, HAUSWART_URL,
{token})` from `src/lib/api`, so endpoint and schema changes break its build. It imports only
client-safe modules (`src/lib/api/**`, `src/lib/tasks/engine/types`, `src/lib/dates`; a test bundles
the entry and fails on any `src/lib/server`, `src/routes` or `src/lib/testing` input). `$lib` aliases
inside those modules resolve through the root tsconfig (Bun and vite both honour it); the root
tsconfig also includes `mcp/**` so `bun run check` type-checks it.

- **Tools** are curated and task-oriented (`defineTool({name, title, description, mode, input,
handler})` returning `{summary, data}`; output is a summary line plus compact JSON with empty
  fields dropped). `mode` (`read|create|update|undo`) fixes the MCP annotations and the default
  scope. At start-up the server calls `authMe` + `householdGet` and registers only tools whose
  scopes the token holds, so a read-only token sees no write tools.
- **New tool**: add the endpoint to the registry first, then a ~15-line `defineTool` in
  `mcp/src/tools/` and an entry in `tools/index.ts` (which lists the planned extension points).
  Triggers go through `parseTrigger` (engine schema, per-type docs in `trigger-docs.ts`, a `Record`
  over `TriggerType` so a new trigger type must be documented).
- **Errors** become MCP tool errors `Error [code]: message` (API code, or `unreachable`);
  `complete_task`/`skip_task` send a fresh idempotency key; completions are attributed `mcp` by the
  token kind.
- **Tests** (`mcp/src/*.test.ts`, vitest) connect the real server to an in-process hauswart
  (`createInProcessFetch`) via the SDK's in-memory transport: `useMcp().connect({scopes})` returns
  `call`/`ok` helpers.

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
  requests skip it (so a bearer upload needs no `Origin`). Set `ORIGIN` behind a reverse proxy.
  **SvelteKit's own form check is off** (`kit.csrf.trustedOrigins: ["*"]` in svelte.config.js, pinned
  by `src/csrf.test.ts`): it refused bearer multipart uploads before `bind` ran. Outside `/api/v1` the
  hook (`auth/origin.ts`, first thing in `handle`, before any session lookup) takes its place and
  refuses every write (any method but GET/HEAD/OPTIONS, any content type) whose `Origin` is not the app
  origin with 403: the error envelope under `/api`, plain text elsewhere. That covers the guest PIN form,
  any form action and every other route outside the registry. One exception: `Origin: null` with
  `Sec-Fetch-Site: same-origin` passes, because browsers post a form from a page served with
  `Referrer-Policy: no-referrer` that way (the `/g` pages used to be; they are `same-origin` now) (`same-site` and `cross-site` do not). A
  new route outside `/api/v1` needs nothing: the check is path-based, and `authz.test.ts` runs it over
  the inventory.
- **Errors** are always `{error: {code, message, details?}}` with the codes in
  `src/lib/api/errors.ts`; services throw `AuthError`-style domain errors or `ApiError`, `bind`
  maps them. Unknown errors become 500 `internal` and are logged by name and code only.
- **Rate limits**: failed password attempts (login, device-token login and the self-service password
  change share one budget, per user + client address, per address, per user); 300 requests/min per
  bearer token; 30 state-changing requests/min per client address on public endpoints (whatever the
  caller sends as credentials). Client addresses are keyed as IPv4, or the /64 for IPv6 (IPv4-mapped IPv6 is
  IPv4). In-memory, so behind a proxy set `ADDRESS_HEADER`/`XFF_DEPTH`. 429 carries `Retry-After`.
- **Hardening**: every response carries `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy` and `Permissions-Policy` (hook); pages get a nonce-based CSP from `kit.csp`
  (svelte.config.js), so inline scripts need `%sveltekit.nonce%` (the theme script lives in
  `app.html` for that reason). Unexpected errors on `/api/*` become the 500 envelope. Sessions end
  180 days after login at the latest; a scheduler (`auth/purge.ts`) deletes sessions that expired
  over 7 days ago and tokens that were revoked or expired over 30 days ago. `HAUSWART_SETUP_TOKEN`,
  if set, guards first-run setup. An administrator's password reset revokes all of the user's API
  tokens (a self-service change does not); demoting an administrator revokes the tokens with the
  `admin` scope; `POST /users/{id}/revoke-tokens` does it on demand.
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
  test fails otherwise). Route files outside `/api/v1` (the calendar feed, the `/g` pages) are
  listed as `public` in the inventory of `src/routes/authz.test.ts`.
- **Self-service password change** (`POST /api/v1/me/password`, session only, body `{currentPassword,
newPassword}`, 204; `auth/change-password.ts`, form in `settings/account`): the new password follows
  `passwordSchema` (the rules of setup and the administrator's reset, argon2id) and must differ from the
  current one (400 on `newPassword`). A wrong current password is a 400 field error on `currentPassword`
  (never 401: that reads as an expired session) and counts against the sign-in budget
  (`loginRateLimiter`, keyed by username + client address, so login, device-token login and this share it;
  a success refunds it; 429 once spent). The hash is replaced only if it is still the one the current
  password was checked against (a concurrent reset or change loses with the same field error). Every
  other session of the user ends, the calling one stays. **API tokens are kept**, unlike an
  administrator's reset: they are credentials the person made on purpose (MCP, Home Assistant, the
  mobile app) and can revoke under `/settings/tokens`; the reset revokes them because the account may be
  taken over. Records the auth event `password_changed` (actor = the user; `AUTH_EVENT_TYPES` is plain
  text in the database, so a new type needs no migration).
- Not built yet, structure kept: TOTP, passkeys and recovery codes (extend `AUTH_EVENT_TYPES`, add
  a step after `verifyCredentials` in `auth/login.ts`).

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
it (setup, Markdown worker, image upload, PDFs, iCal, guest page) and pushes `ghcr.io/<owner>/<repo>` with
`<version>`, `<major>.<minor>` and `latest`; `release-assets.yml` attaches the compiled MCP binaries. Run
the same smoke test locally: start the image with `ORIGIN` and `HAUSWART_COOKIE_SECURE=false` and an empty
volume, then `scripts/docker-smoke.sh <url> <version>`.

## Git

Conventional commits, lowercase (`feat: add task engine`, `fix: …`, `refactor:`, `chore:`,
`docs:`, `test:`, `ci:`). Run `bun run verify` before committing. Never commit `.private-terms`,
`.env`, `data/` or `seed/local/`.
