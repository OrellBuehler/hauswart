# CLAUDE.md — hauswart

hauswart is a self-hosted apartment-management app for a single household with a few users:
recurring maintenance tasks with completion tracking, documentation (markdown, uploads,
Paperless-ngx links), device inventory, defects, spare parts, contacts, costs, insurance policies, appointments, notifications, an
iCal feed, a guest link and an MCP server. Home Assistant, Paperless-ngx and Kept (finance) are
optional adapters, never requirements. Status: early development — authentication, the API spine,
the task core (rooms, assets, tasks, completions, notifications, dashboard), documentation (pages,
attachments, search, file backup), contacts, spare parts, the service log, care hints, defects (with
a PDF export), the warranty overview, generic comments, iCal feeds, the emergency page data and guest
links, costs (cost books, the split between the people, running balances with recorded payments and a CSV export), the per-person finance
connection (Kept), insurance policies (with a cancellation reminder), appointments (see "Appointments"), asset notes and vehicles (details, odometer
readings, tire sets, a fuel log with consumption, statistics, task templates; see "Vehicles"), and a receipt queue that an MCP client works through (see "Receipt queue", with a page and a quick entry for phones in the web app) exist; Home Assistant is wired end to end (readings, auto-complete, hint reactions,
push notifications with a "done" button, areas taken over as rooms, items pushed into its calendars; see "Signals, integrations and delivery" and "Calendar sync"); Paperless-ngx is wired as
a per-person document provider (links, previews, warranty dates, pushing attachments; see "Documents and the
document provider"); the MCP server covers the task core, documentation, defects, parts, contacts,
comments, hints, service log, warranties, costs, the finance inbox, archived documents, insurance policies, appointments, asset notes and vehicles (odometer, fuel log, tire sets, statistics), and hauswart serves it over HTTP at
`/api/v1/mcp` (see "MCP server" and `mcp/README.md`); the web app is installable as a PWA (see "Installable app").

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
src/lib/server/files/            content-addressed file store, image pipeline, sniffing, serving headers (see below); preview.ts: the smaller copy of an
                                 image an assistant reads (`previewSize`, `previewImage`)
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
src/lib/insurance/policy.ts      premium per year and the cancellation deadline (pure, client-safe)
src/lib/server/insurance/        insurance policies: policies.ts (CRUD, filters, covered assets), reminder.ts (the cancellation
                                 reminder task); see "Insurance policies and asset notes"
src/lib/server/asset-notes/      asset notes: notes.ts (CRUD, to a defect), resolve.ts (service log resolution), events.ts (undo
                                 reopens), counts.ts (openNoteCount)
src/lib/server/costs/            cost entries: split.ts (frozen shares), costs.ts (CRUD, list), move.ts (bulk move to a book), books.ts (cost books), summary.ts (year totals,
                                 settlement), ledger.ts (paid/share/payments per person, shared by summary and balances), balances.ts (running
                                 balances), settlements.ts (recorded payments), csv.ts, totals.ts (cost sums on defects and service log entries)
src/lib/server/ai-tasks/         the receipt queue: ai-tasks.ts (upload, list, complete, dismiss, delete), preview.ts (the task's file sized for an assistant);
                                 see "Receipt queue"
src/lib/server/finance/          generic finance-provider seam: providers.ts (registry), suggestions.ts (the private inbox, accept,
                                 dismiss), bill-tasks.ts (tasks that follow bills)
src/lib/server/hints/            per-asset care hints (tip/rule/warning), pinned, ordered, optional signal reaction (stored only)
src/lib/server/defects/          defects (Mängel): status machine, events, handover deadline, reminder task, timeline, PDF export
src/lib/server/warranties/       warranty overview + status (valid / expiring ≤ 90 days / expired); feeds the dashboard
src/lib/server/comments/         generic comments on any entity: commentable registry, soft delete, notifications, counts
src/lib/appointments/when.ts     when an appointment takes place (timed instants or all-day dates), the 14-day limit, start/end instants (pure, client-safe)
src/lib/appointments/            client-safe UI logic next to it: format.ts (wording in the household zone), list.ts (views, filters, day groups),
                                 form.ts (draft -> request bodies), labels.ts; see "Appointments in the web app"
src/lib/server/appointments/     appointments ("Termine"): appointments.ts (CRUD, filters, merge rules), complete.ts (done + the task's
                                 completion), next.ts (the next appointment of a task); see "Appointments"
src/lib/server/calendar/         ical.ts (pure RFC 5545 builder), feeds.ts (ical_feeds CRUD, token), entries.ts (what belongs in a calendar,
                                 read once for the feed and for calendar sync), feed.ts (entries -> events of a feed),
                                 public.ts (the public .ics response: limits, ETag/304)
src/lib/server/calendar-sync/    push of items into a calendar of a connected system: provider.ts (the seam), ref.ts (the marker), items.ts (what a
                                 target wants), reconcile.ts (pure engine), links.ts, store.ts, sync.ts (one run), targets.ts (service),
                                 scheduler.ts, schedule.ts (the 15-minute rhythm, `nextAttemptAt`), testing.ts (in-memory fake calendars); see "Calendar sync"
src/lib/calendar-sync/           client-safe UI logic for calendar targets: form.ts (draft -> request bodies, PATCH diff), stats.ts, health.ts,
                                 labels.ts, errors.ts, providers.ts; see "Calendar sync in the web app"
src/lib/server/share/            guest links: tokens.ts, guest-links.ts (CRUD, window, PIN counter), guest-access.ts (token ->
                                 state, PIN attempts, signed unlock cookie), guest-view.ts (what a link shows), guest-http.ts
                                 (gate + PIN action for the /g routes, response headers), purge.ts
src/lib/server/emergency/        emergency page data (members) and the "Notfall- & Vertretungsblatt" PDF
src/lib/server/vehicles/         vehicle details (`vehicle_details`), odometer readings and the signal they feed: odometer.ts
                                 (`writeOdometer` sync, `recordOdometer` async), signal.ts (readings -> signal + samples),
                                 summary.ts (plate + newest reading on assets), events.ts (completions), vehicles.ts, tires.ts, fuel-logs.ts, stats.ts (see "Vehicles")
src/lib/vehicles/                client-safe: odometer.ts (`odometer:<asset id>` key helpers), plate.ts (plate matching), tires.ts (tread limits,
                                 DOT age, distance per set), fuel.ts (full-to-full consumption), stats.ts (distance per month), templates.ts (task bodies), template-mark.ts (the mark on their tasks, the template ids)
src/lib/server/pdf/render.ts     shared pdfmake wrapper (A4, Roboto from node_modules, no network or file access)
src/lib/pwa/                     client-safe PWA parts: colors.ts (theme colours, tested against app.css), manifest.ts, options.ts
                                 (the service worker's whole behaviour; see "Installable app")
src/lib/server/pwa/service-worker.ts  serves the built worker (build/server/sw.js) with Cache-Control: no-cache and an ETag
src/lib/server/seed/import.ts    seed importer (through the REST API); CLI in scripts/seed.ts, data in seed/
mcp/src/                         MCP server (client-safe imports only): index.ts stdio entry, server.ts (buildHauswartServer =
                                 scope-based registration; createHauswartServer adds the whoami handshake), tool.ts (defineTool),
                                 context.ts (client + name resolvers), tools/ (registry in tools/index.ts, one file per domain);
                                 mcp/README.md is the setup guide
src/lib/server/api/handlers/mcp.ts  POST /api/v1/mcp: the MCP server over Streamable HTTP (stateless, see "MCP server")
src/lib/server/integrations/     optional adapters (homeassistant/, paperless/, kept/) — the core never imports these;
                                 homeassistant/ has client, ws, helpers, fake-server plus adapter (settings, pickers), channel
                                 (`ha_notify`), sync (polling, calendars) and scheduler, and the calendar provider (`calendar-provider.ts`,
                                 `calendar-events.ts`), wired by `registerHomeAssistant()`;
                                 paperless/ has client, fake-server plus adapter (settings, pickers), provider, sync, scheduler,
                                 wired by `registerPaperless()`; kept/ has client, mappers, fake-server plus config, adapter
                                 (settings, pickers), sync and scheduler, wired by `registerKept()` (see "Costs and finance providers")
src/lib/server/db.ts             SQLite connection (WAL, foreign keys); migrations run on startup
src/lib/server/migrator.ts       the migration runner: foreign keys off while migrations run, a differential `foreign_key_check` before commit,
                                 the pending list worked out under `BEGIN IMMEDIATE`, a safety copy first
src/lib/server/migration-copy.ts the `VACUUM INTO` copy written next to a database that has data before it is migrated (newest 3 kept)
src/lib/server/schema.ts         Drizzle schema — one file, every table has created_at/updated_at
src/lib/server/crypto.ts         AES-256-GCM for stored secrets (HAUSWART_SECRET_KEY)
src/lib/money.ts                 minor-unit money type, parsing/formatting, ownership shares
src/lib/costs/                   client-safe UI logic of the costs pages: books.ts (book choice, icons), book-memory.ts, filters.ts, form.ts (draft ->
                                 request bodies), balances.ts (wording), settlements.ts (drafts, bodies, filters), load.ts, quick.ts (category ranking,
                                 chips -> split, quick draft -> bodies), receipts.ts (queue page helpers); see "Costs in the web app" and "Quick entry, receipts and the review flag in the web app"
src/lib/attachments/             client-safe upload logic: files.ts, list.svelte.ts, upload.ts (XHR with progress), receipt-file.ts (checks and the HEIC
                                 decision), receipt-convert.ts (the canvas conversion, browser only)
src/lib/testing/                 useTestDB, createTestUser/Token, createTestEvent, callRoute, fixtures/
src/hooks.server.ts              init (secret key, time zone, migrations) + auth gate + Paraglide locale
src/routes/api/v1/**             one-liner route files: export const GET = bind(endpoints.x, handler)
src/routes/api/health            liveness probe, no database
src/routes/{login,setup}         the only pages that exist outside the app shell; they call the API
src/routes/{manifest.webmanifest,sw.js,offline}  the installable app: public, no user data (see "Installable app")
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
  state condition holds; forgotten when it stops holding). A reading with source `manual` (typed in
  by a person, e.g. an odometer) never goes stale (`isSignalFresh`), is never pruned (neither the
  signal nor its samples), its samples are loaded 400 days back and its estimates look back up to a
  year (`SPARSE_WINDOWS_DAYS`); every other reading is stale after 24 h as before.
- **`counter_delta.orEvery`** `{every, unit}` makes a counter task also fall due by time: when the
  counter threshold is reached or the interval since the last completion (the task's creation, the
  `startedOn` the evaluator passes, when there is none) has passed, whichever comes first. While the
  counter is short of its threshold the time limit sets the status and the date shown is the earlier
  of the limit and the counter estimate: `dueKind` `exact` for the limit, `estimated` while the
  estimate comes first. Once the counter has crossed its threshold the status follows the counter:
  `dueKind` `condition`, `dueDate` the day the evaluator first saw it there, `due` from then and
  `overdue` after the grace days counted from that day - unless the time limit had already fallen on
  an earlier day, which then stays the date and sets the status (`exact`). In the `estimated` case
  `dueDate` **stays the hard time limit** and
  `estimate` carries the earlier guess, so the status, the "due soon" notification and the iCal feed
  keep the limit; whoever shows a date takes `shownDate` / `shownDateIsEstimate`
  (`lib/tasks/engine/shown.ts`: the estimate for kind `estimated`, else the due date) instead of
  `dueDate ?? estimate`. Lists, the dashboard and preparations use the estimate, the detail page
  shows both ("~ date" and "at the latest ..."). A missing, stale or baseline-less counter no longer makes the task
  `unknown`: the time half decides, the reason (`signal_missing`, `signal_stale`, `baseline_missing`)
  is still reported. The occurrence key stays `c:<last completion id>`. `createTask` stores
  `createdAt` from the injected clock.
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
  list needs none. A task whose asset has open notes announces due soon and due with the `*_notes` variants
  of the message (see "Insurance policies and asset notes").
- **Seed files** (`seedSchema`, `seed/*.json`; real data in gitignored `seed/local/`) are imported
  by `scripts/seed.ts` through the REST API and matched by `key`, so repeating it changes nothing:
  rooms and assets by slug, tasks by `externalSource: "seed"` + `externalRef`, preparations by title.
  Existing entries are left alone unless `--update`. Changing the household needs the admin scope.
  An asset of kind `vehicle` may carry a `vehicle` block (the body of `PUT /assets/{id}/vehicle`):
  saved when the vehicle has no saved details yet, overwritten (and what the file leaves out cleared)
  only with `--update`; the block cannot carry `costBookId` (a file knows no book ids) and an update keeps the book a
  person chose. Tire sets and fuel logs are not seeded: a set has no key to find it again by, and a fill books
  a cost entry (`costs:write`).

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
  adapter registers `registerIntegration({kind, validate?, checkReferences?, test, describe, operations})`; it throws
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
  Entity names in code and tests stay synthetic (`sensor.example_*`). Events hauswart wrote into a calendar itself
  (they carry the marker of "Calendar sync") are left out when a calendar is read for `ha_calendar` dates.
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

- **Cost entries** (`cost_entries`, domain data shared by the household): `bookId` (see "Cost books"), `date`, `title`,
  `amountMinor` (positive = expense, negative = refund, never 0) + `currency`, `category`
  (`repair|utilities|renewal_fund|purchase|mortgage_interest|mortgage_principal|insurance|renovation|maintenance|fuel|taxes_fees|groceries|household|dining|leisure|travel|health|gifts|transport|subscriptions|other`;
  the everyday ones count as an expense by default like all but `mortgage_principal`),
  optional asset, room, defect and service log entry (a service log entry or defect fills in
  asset/room when none is given; deleting the target only unlinks), `payee`, `notes`,
  `paidByUserId`, `splitMode`, `countsAsExpense`, `deductible` (`unknown|maintenance|investment|no`: the
  Swiss tax distinction between value-preserving and value-increasing work; only for tax relevant books, see
  "Cost books"), `source`
  (`manual|finance_transaction|finance_bill`). `countsAsExpense` defaults to false for
  `mortgage_principal` (equity, not a cost) and follows a category change unless the person overrode it.
  Entries can be commented on and carry receipts (attachments, owner `cost`). `reviewNeeded` (with `reviewedAt` and
  `reviewedByUserId`; migration `0028`) says that a person still has to look at the entry: the receipt queue sets it on what an
  assistant booked, `POST /costs/{id}/review` (scope `costs:write`, any member) clears it and records who and when, and
  reviewing an entry nobody has to review changes nothing (the first reviewer stays). It changes no total, split or balance.
  `POST /costs` takes an optional `idempotencyKey` (8 to 128 characters, migration `0029`, unique per person who books whatever credential they
  use, exactly like `POST /settlements`): a retry returns the first entry with 200 instead of 201, the same key for another entry (amount,
  currency, category or title; book, date or payer when the retry names them; notes, payee and device do not count) is a 409, and the key is
  free again once the entry is deleted (`recordCost`; `createCost` stays the plain booking, also used by the finance inbox and the fuel log).
  `GET /costs?reviewNeeded=true|false` filters; `GET /costs/summary` carries `reviewNeededCount` (the entries of its own scope: the year
  and the asset or book if one was asked for, any currency, expense or not) and the dashboard `reviewNeededCount` (every year and book).
  The fuel log of a vehicle books its
  fills as `fuel` entries (see "Vehicles"); such an entry carries `fuelLogId` and keeps its amount, currency, date and
  device and its existence in step with that fill (`updateCost`/`deleteCost` refuse with 409 `conflict`,
  `details.fuelLogId`; everything else stays editable).
- **Split math** (`money.ts` `allocate`, `costs/split.ts`): shares are frozen per entry in
  `cost_entry_shares` (basis points, sum exactly 10000), so a later ownership change never rewrites
  history. `ownership` weighs people by `users.ownership_bps` (normalised, 0% pays nothing, all zero
  falls back to equal), `equal` weighs everybody the same - or only the `participantIds` (create and PATCH;
  household members, each once, 1 to 20; refused for any other mode with a 400 on `participantIds`; a
  PATCH with `participantIds` and no `splitMode` needs the entry to be `equal` already), `custom` takes
  explicit shares (sum 10000), `none` is not shared. There is no stored participant list: the frozen shares are
  the participants (a person who joins later bears nothing of an old entry). A person's part of an amount is the
  largest-remainder split of its absolute value (parts add up to the amount exactly; a refund splits exactly like
  the expense it reverses); ties go to the earlier user id. An omitted `splitMode` on create is the book's
  default split. PATCH with `splitMode` ownership/equal splits again by today's shares (`equal`: everybody);
  changing only the amount keeps the frozen shares.
- **Cost books** (`cost_books`, migration `0026`; `costs/books.ts`; `/cost-books`, reads `read`, writes `costs:write`): the
  ledgers entries are booked into. `name` (60, unique without regard to case), `slug`, `icon` (a key the client maps),
  `defaultSplitMode` (`ownership|equal|none`), `taxRelevant`, `archivedAt`, `sortOrder`. The migration creates Wohnung
  (tax relevant, `ownership`), Haushalt and Auto (`equal`) and puts every earlier entry into Wohnung. SQLite cannot
  add a NOT NULL reference to a table with rows, so it rebuilds `cost_entries`; it was written for a migrator with foreign
  keys on, where `DROP TABLE` cascade-deleted `cost_entry_shares` and nulled the fuel log links, so both are set aside and
  restored and the delete triggers are created again. It is the one migration that still runs with foreign keys on
  (`MIGRATIONS_WITH_FOREIGN_KEYS` in `migrator.ts`); every other one runs with them off (see "Migrations" below), and
  `migrations.test.ts` pins both. `cost_entries.book_id` is NOT NULL, `ON DELETE RESTRICT`. **The default book** (`defaultCostBook`,
  `isDefault` in the DTO) is the book flagged `cost_books.is_default` (migration `0027`, which flagged the book that was
  the first one not archived), where an entry without `bookId` goes (so does an accepted finance suggestion and a fuel
  log's cost entry of a vehicle that remembers no book). Exactly one book that is not archived has the flag (a partial
  unique index and the service keep it so): `PATCH /cost-books/{id}` with `isDefault: true` (also on create) moves it in one
  transaction, `isDefault: false` on the default is a 409, an archived book that stays archived cannot get it (400 on
  `isDefault`), archiving or deleting the default hands it to the first book that is still open, restoring a book does not
  give it back and **reordering never moves it**. The last book that is not archived can be
  neither archived nor deleted (409), so there always is one. A book with entries or payments cannot be deleted (409,
  `details.entryCount`/`settlementCount`): archive it, which closes it to new entries (400 on `bookId` when creating
  or moving into it; an entry may stay and be edited) while it still counts in the balances. **Tax class**:
  `deductible` other than `unknown` is a 400 on `deductible` in a book that is not tax relevant (the entry's own value
  may be repeated); moving an entry into such a book resets it to `unknown` unless the request sets it; switching
  `taxRelevant` off keeps what entries say, and `byDeductible` of the summary counts tax relevant books only. `bookId`
  filters the list, `GET /costs/summary` (every number is then that book's) and the CSV; a `bookId` that names no book is
  a 404 on all of them (and on the balances and on `GET /settlements`), never an empty answer. The entry DTO carries `bookName` and
  `bookTaxRelevant` (whether `deductible` means anything for it). **Moving entries**: `PATCH /costs/{id}` with `bookId` moves one; `POST /costs/move-to-book {bookId, ids | assetId}`
  (scope `costs:write`, `costs/move.ts`) moves up to 500 named entries or every entry of a device, all or nothing in one
  transaction (an unknown id is a 400 on `ids`, an unknown device on `assetId`, an unknown or archived target on
  `bookId`), answers `{bookId, moved, unchanged, deductibleReset, dryRun, years}` and changes the ledger only: split, payer and frozen
  shares stay, a tax class the target book cannot have is reset. **`dryRun: true`** does everything but write (the same
  checks, the same counts; `dryRun: true` comes back) and `years` is `{from, to}`, the first and last year of the dates of
  the entries that move or would (null when none does), so a client can say "23 Einträge aus 2024–2026, 5 verlieren ihre
  Steuerklasse" before a move of a whole device is confirmed. Entries a fuel log entry booked may move too (their lock
  covers amount, currency, date and device only).
- **Currency**: entries may be in any currency, but every total, the settlement and the dashboard
  count the household currency only; `otherCurrencyCount` says how many entries were left out (the CSV
  has them all).
- **Summary** (`GET /costs/summary?year=&assetId=&bookId=`): `expenseTotalMinor` and the per category / month (always 12) /
  asset (top 10) / tax class breakdowns count entries with `countsAsExpense`; `equityTotalMinor` is the rest. With an
  `assetId` or `bookId` every number in it, the settlement included, is that asset's or book's alone. It is a
  year of entries: recorded payments are not in it (and so not in the dashboard's `costsYearToDate`).
  **Settlement** covers every split entry with a payer, equity included (it is about who paid cash):
  `balanceMinor` = paid - share (positive = the others owe this person), `settlement` = greedy payments
  from the largest debtor to the largest creditor ("A owes B CHF x"). Split entries without a payer are
  counted in `unassignedPayerCount`, never guessed. The dashboard carries `costsYearToDate`, `balances` and `pendingFinanceSuggestions` (the
  caller's own pending offers, shown as a card linking to the inbox). **`costsYearToDate`** answers "what did the year
  cost" and nothing else: `totalMinor` and `byCategory` (top three) over all books together plus `byBook` (per book,
  largest first, only books with an expense this year, archived ones too, each with `taxRelevant` so a client can tell the
  apartment from the everyday books); household currency, entries that count as an expense, the same numbers as
  `costsSummary` (a test pins it), grouped in SQL without a ledger. It no longer has a `settlement`: a year of entries
  knows nothing of recorded payments, so it would have disagreed with the balance. **`balances`** answers "where do I
  stand": `{currency, myBalanceMinor, hasActivity, suggestedPayments (the first three, between any two people),
suggestedPaymentCount}`, the caller's own place across all books with recorded payments included, from one read of the
  same ledger as `GET /costs/balances` (four queries however many entries there are; a test pins that). It is the one
  part of the dashboard that may fail on its own: when it cannot be worked out the handler answers `balances: null`
  (the schema is nullable) and logs `dashboard.balances_failed` with the error's name and code, so the tasks and the
  rest of the dashboard still open.
- **Settlements and balances** (`settlements`, migration `0026`; `costs/settlements.ts`, `balances.ts`, `ledger.ts`;
  `/settlements`, `GET /costs/balances`): a settlement is a payment between two members ("Ben paid Anna 50"):
  `fromUserId` differs from `toUserId` (both members, else 400 on the field), `amountMinor` is positive (also a CHECK),
  `currency` defaults to the household's, then `date`, `note`, and `bookId` (null = across all books; the book may be
  archived, paying back a closed trip is the normal order). It is **not a cost**: no expense total counts it, it only
  moves the balances. Users cannot be deleted, so its user foreign keys are `RESTRICT`. `POST /settlements` takes an
  optional `idempotencyKey` (8 to 128 characters, migration `0027`, unique per person who records whatever credential
  they use): a retry returns the first payment with 200 instead of 201, the same key for different people, amount, currency
  or book is a 409 (date and note do not count), and the key is free again once the payment is deleted
  (`recordSettlement`). `GET /costs/balances` is all
  time: per member `paidMinor - shareMinor + sentMinor - receivedMinor` (`sentMinor` = payments handed over, a positive
  balance = the others owe this person, zero-sum per currency), household currency only (`otherCurrencyCount` = entries
  and payments left out, `unassignedPayerCount` as in the summary) and `suggestedPayments` from the same greedy `settle`
  as the year summary. With `bookId`: that book's entries and its own payments (payments across all books cannot be
  attributed and stay out; `crossBookSettlements: {count, totalMinor}` says how many of them there are, household
  currency, null for the view of all books); with `all=true` or no parameter: every book, archived ones and payments
  across all books included; `bookId` with `all=true`, or `all=false` without a book, is a 400, an unknown book a 404. `ledger.ts`
  (`bookEntry`, `bookSettlement`, `personBalances`) is the one place paid/share are added up, for the summary and the
  balances alike.
- **CSV** (`GET /costs/export.csv?year=&bookId=`, binary `text/csv`): UTF-8 with BOM, `;` separated, CRLF,
  fixed English column names (`costs/csv.ts` `CSV_COLUMNS`; columns are only ever added at the end, `book` is the
  last; the file of one book is named `hauswart-costs-<year>-<book slug>.csv`), amounts as plain decimals with a point, no
  thousands separator and the currency's own precision (`-12.50`, `1500` for JPY) so they parse the same
  everywhere; text cells that start with `= + - @` tab or CR get an apostrophe (formula injection).
- **Recent categories** (`GET /costs/recent-categories?bookId=`, scope `read`; `costs/recent-categories.ts`): how often each category was used by the newest
  100 entries of each book (`RECENT_CATEGORY_ENTRIES`, newest = the list's order, every entry, archived books too) as rows `{bookId, category, count}` per
  book in the order of the books, most used first; with `bookId` that book alone (404 when it does not exist). It is what the quick entry ranks its category
  chips by (`rankCategories` adds the counts) instead of reading a hundred whole entries.
- **Defects and service log entries** carry `costs: {totalMinor, count}` (correlated subqueries in the
  list select, household currency, refunds netted); their legacy `costEntryId` column is unused.
- **The inbox** (`finance_suggestions`): what a finance provider offers one person - `cost`, `asset` or
  `bill_task` - with the status `pending|accepted|dismissed` and a payload shaped like the API's. It is
  **private to its owner**: the list, accept and dismiss only ever select `user_id = caller`, another
  person's id is a 404 exactly like a missing one, and the finance address of an entry
  (`providerUrl`) is shown only to the person who booked it. `(connection, kind, ref)` is unique: a
  seen item keeps its status (a dismissed one stays dismissed, an accepted one never changes, only a
  pending one takes a fresher payload). A cost suggestion's payload may carry `bookId`, the cost book the
  connection's settings offer for it (the accept dialog preselects it; the API shows null once that book is archived or
  deleted, and legacy payloads without it read as null). Accepting books the cost (paid by the owner, into the book the body
  names, else the one offered with the suggestion while it is open, else the default book, and
  split as it says unless the body overrides book (`bookId`), category, title, asset/room/defect/service log,
  payer, split, participants, expense flag, deductible), creates the asset (with `externalSource: finance_transaction`; the cost of the same
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
  (`source` = the provider's name, no user; none if a person already settled the occurrence `bill:<id>`), a bill
  that becomes payable again revokes that system completion only (never one a person recorded), a cancelled bill
  settles it without a completion, archived tasks are never touched again, bills without a due date are
  skipped. The task is **visible to the whole household** with creditor, invoice number, amount and due
  date: that is what the person consents to by switching `billTasks` on. The description carries what is still
  to pay while the bill needs paying, the invoiced total once it is settled. The address of the bill in the
  finance app (`externalUrl`) is **not** part of that consent: the task endpoints return it only to the person
  whose connection the task follows (`billUrlVisibility`), `null` for everybody else; the task page shows
  "open in finance app" for that person. Title, description, due date and status are overwritten at every sync
  (the task form says so); deleting the task of a still open bill makes the next sync create it again, so the
  delete dialog points to archiving, which is respected. Housekeeping archives tasks
  settled for 90 days and those of a deleted connection.

#### Kept adapter (`integrations/kept/`)

- **Connection** per person (`kept`, `INTEGRATION_LEVELS` user): `PUT /integrations/kept` with `config`
  `{categoryMap: {keptCategoryId: costCategory}, purchaseCategoryIds, autoAcceptCategoryIds (subset of the
map), billTasks, billCreditorFilter (case-insensitive exact creditor names; applies to bill tasks and to paid-bill cost offers), billCostCategory, assignBillTasksTo:
"owner", syncFrom}`; unknown keys are dropped. Everything is opt-in: no category, nothing read. `test` calls
  `me()` and reports `info.missingScopes` (of `transactions:read, bills:read, links:write, categories:read`)
  and `info.backLinks` (false without `ORIGIN`: no back-links can be written then; the card says so).
- **Sync** (`syncConnection`, scheduler every 30 min, backoff 1, 2, 4 ... 15 min via the connection's
  health, immediately when a connection is saved, overlap guard per connection and in the scheduler; each
  part runs on its own and the first failure becomes the connection's `lastError` code):
  - transactions of every mapped or purchase category since the cursor (`finance_sync_state`, per scope:
    a different category set, `syncFrom` or choice of books starts over; first run from `syncFrom` or 1 January) become `cost`
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
- **Books**: `config.categoryBookMap` `{keptCategoryId: bookId}` names the cost book of a mapped category (an entry
  for a category that is not mapped is dropped when the settings are saved) and `config.defaultBookId` the book of a mapped
  category without one and of paid invoices (`billCostCategory`; they have no Kept category). `bookFor` (sync.ts) takes
  the category's book, else the default, else none; a book that is deleted or archived counts as none and the next choice
  is tried, none meaning the household's default book. The id goes into the suggestion's payload (`bookId`, left out when
  none) and, in an automatic category, to `acceptSuggestion` as the body's `bookId` (the adapter passes it, the core
  knows no Kept). The cursors of the transactions and of the paid invoices carry a digest of the books the settings
  name (`booksScope`: the category map and the default book for transactions, the default book alone for invoices), so
  a changed choice reads everything since `syncFrom` again and the offers still waiting take the new `bookId` (a
  decided one never changes: `recordSuggestion` rewrites pending ones only). Book ids are checked when settings are saved: the adapter's `checkReferences` (a generic hook of
  `IntegrationAdapter`, run by `saveConnection` with the database after `validate`, and only when the request sends
  `config`, so a save that leaves the stored settings alone never trips over a book deleted since) throws an
  `IntegrationError` with `field: "config"`, which becomes a 400 on `config` naming the book. A book that does not exist
  is refused, an archived one is allowed (it counts as none when used, the form warns), and the choice for a category that
  is not mapped is dropped before the check. The web settings form has a book select under each mapped category (empty = the connection's default) and one for `defaultBookId` (empty = the household's default book); an archived choice shows a warning, a refused one `integration_kept_book_gone_error`; the accept dialog preselects the book offered with a suggestion.
- Logs carry codes only (`kept.transaction_failed {code}`), never titles, amounts, creditors or tokens.

### Receipt queue

A work queue for an assistant: a person puts a photo or PDF of a receipt in the app, an MCP client reads it, books the cost
entries with the tools that exist and closes the task. The web app has the page `/costs/receipts` and the receipt mode of the quick entry (see
"Quick entry, receipts and the review flag in the web app").

- **The table** (`ai_tasks`, migration `0028`, together with the review flag of cost entries; `ai-tasks/ai-tasks.ts`): `kind`, `status`
  (`pending|done|dismissed`), `note` (the uploader's words, at most 1000 characters), `createdByUserId` (the uploader), the hints `bookId`
  (an open cost book, else 400 on `bookId`) and `assetId` (set null when the book or device goes), `attachmentId` (set null when the file
  goes), `resultJson`, `dismissReason`, `completedAt` (when the task left the queue, done or dismissed), `completedVia` (`session`, or the
  kind of the API token) and `completedByUserId` (who closed it: the person in the browser or the owner of the token; set null with the
  person; the DTO adds `completedByName`, the receipts page shows "Von Ben" and the tools' rows `closedBy`; the first closer stays when a
  repeated call is answered with the task as it is). `kind` is `receipt` today, the only value `POST /ai-tasks` accepts; `fuel_receipt`, `service_invoice` and
  `insurance_policy` are already in `AI_TASK_KINDS`, so another kind widens the request schema and the tools but not the table (the column
  has no CHECK).
- **Everybody sees everything.** Like cost entries the queue is household data: every member lists, reads, completes and dismisses every
  task; deleting is for the uploader or an administrator (403 otherwise; a task whose uploader is gone, for an administrator). What is
  booked from a receipt is paid by the **uploader** by default (the tool text and `get_ai_task`'s `defaults.paidBy` say so), not by the
  token that processes it. Finance inboxes stay private, so `get_ai_task` lists bank transactions only when the token user is the uploader.
- **The file** is an attachment of the owner type `ai_task` (registered with the domain owners). `createAiTask` checks the hints, stores the
  file (`storeAttachmentFile`: type sniffing, images re-encoded, 25 MiB, the same `invalid_request` codes as an attachment upload), then writes
  the attachment and the task in one transaction, so a task never lacks its file. `POST /attachments` with that owner is a 400 and
  `DELETE /attachments/{id}` of its file a 409: the task owns it (owner type `ai_task` needs `costs:write` like `cost`).
- **Booking for a task** (`receiptTaskId` on `POST /costs`, on accepting a finance suggestion - a cost only - and on `POST /assets/{id}/fuel-logs`;
  column `cost_entries.ai_task_id`, `ON DELETE SET NULL`; `ai-tasks/booking.ts` `assertTaskOpenForBooking`, a leaf module the cost service may
  import): the task must exist (400 on the field) and be pending (409 `conflict`, `details.status`; nothing is booked and a finance suggestion stays
  pending), and the entry is **flagged `reviewNeeded` at once and recorded on the task in the same transaction**. `bookedSoFar` on the task DTO lists
  the entries that exist and were booked for it (oldest first, `fuelLogId` when a fuel log entry booked one), whoever booked them and whatever
  became of the task, so a client that was interrupted - or a second one - sees what is done and books only the rest. A fill that is free has no
  cost entry to record it on: `receiptTaskId` is a 400 there. The cost entry DTO carries `receiptTaskId`. A replayed booking (see the key above)
  is answered before the task is looked at, and the key now also stands for the receipt task.
- **Complete** (`POST /ai-tasks/{id}/complete {createdCostIds?, createdFuelLogIds?, note?}`, scope `costs:write`, 200; at least one id): every
  id must exist (400 on the field, naming the ids; nothing changes). The targets are the cost entries named plus the cost entry each named fuel
  log entry booked (a free fill has none), each once. **They must be the task's result**: booked for this task, or created at or after the moment
  the task was queued (a fuel log entry by its own `createdAt`); an entry that existed before the task and one booked for another task are a 400 on
  `createdCostIds` (`createdFuelLogIds`), naming the ids and nothing changes - a payment booked twice is not what the receipt became. In one
  transaction the targets not booked for this task and never reviewed are flagged `reviewNeeded` (`flagForReview`; **a review a person already did
  is never undone**, and entries booked for the task were flagged when they were booked), the file **moves** to the first target (same attachment row, new owner `cost`; `attachmentId` still points at it) and every
  further target gets a **copy** (`copyAttachment`: another row for the same stored file, which is deleted only with the last row), and the
  task becomes `done` with `resultJson` `{createdCostIds, createdFuelLogIds, note}` as reported. With no target (only free fills) the file stays
  with the task. The DTO's `result.costs` are the targets that still exist (title, amount, `reviewNeeded`).
- **Uploading twice** (`POST /ai-tasks` takes an optional `idempotencyKey`, 8 to 128 characters, migration `0029`): the same rules as for
  payments and cost entries - unique per uploader, a retry returns the first task with 200 (whatever became of it since: pending, done, even
  with its book archived by now), nothing is stored or queued for it, the same key for a different receipt (a digest of kind, book, device
  and the bytes uploaded; the note does not count) is a 409, and the key is free once the task is deleted (`recordAiTask`; the key is checked
  before the file is stored).
- **Idempotency** (decided so that a retry is safe and a mistake is not hidden): completing a done task with the same ids, in any order, is 200
  with the task as it is (the note and `completedVia` of the first call stay); with other ids it is 409 `conflict` whose `details` carry the
  recorded ids; completing a dismissed task is 409. `POST /ai-tasks/{id}/dismiss {reason?}` (send `{}`; a JSON body is required) closes a pending
  task (the file stays with it); dismissing a dismissed task is 200 and the first reason stays; a done task is 409.
- **Delete** removes the task and the file only while the task still owns it (pending or dismissed); after a completion the file is the receipt
  of the cost entry and stays. Deleting the cost entry that holds the file clears `attachmentId` (the task shows no file).
- **Counts** (`GET /ai-tasks/count?status=&kind=`, scope `read`, `{count}`; `countAiTasks`): the number of tasks without reading them. The costs page's
  badge on "Belege" asks for `?status=pending` (exact, no more "50+"), and the dashboard carries `pendingReceiptCount` (the same number; a card links to
  `/costs/receipts?status=pending` when it is above zero).
- **Several clients**: nothing locks a task. Two clients (or one that was restarted) can work on it, which `bookedSoFar` makes visible and the rules
  above keep from double booking: the first to complete wins, a later `create`, `accept` or `fill` for the task is a 409, a later `complete` with other
  ids a 409 naming what is recorded, and what the loser had booked stays flagged for a person to sort out. **The lease** is only a warning in front of
  that (`claimed_by_user_id`, `claimed_at`; `POST /ai-tasks/{id}/claim`, scope `costs:write`, no body, answers the task; `ai-tasks/booking.ts`
  `takeLease`, `AI_TASK_CLAIM_MINUTES` = 15): opening a pending task, and booking for it, records the person; their own lease is renewed, a lapsed
  one is taken, one that somebody else holds **stays theirs** (the answer says whose it is) and a done or dismissed task is answered as it is. Setting it
  is no change of the task (`updatedAt` stays). The DTO's `claim` `{byUserId, byName, at, expiresAt}` is set only while the task is pending and the lease
  has not run out (computed with the request's clock, `wireAiTask(task, now)`); the receipts page says "Wird gerade bearbeitet von ...". `get_ai_task`
  claims when the token holds `costs:write` (a read-only token only looks) and starts its answer with a warning when another member's client holds the
  lease; `list_ai_tasks` rows carry `claim` `{by: you|name, minutesLeft}`.
- **The preview** (`GET /ai-tasks/{id}/preview`, binary, scope `read`; `ai-tasks/preview.ts`, `files/preview.ts`): the file as an assistant
  reads it. An image that fits (longest side at most 1600 px, at most 1.5 MB) is sent as stored; a larger one is drawn on white and re-encoded
  as JPEG at `previewSize` (longest side 1600, except a long, narrow receipt, which keeps a short side of 600 px up to a long side of 3200),
  with a lower quality and then a smaller size until it fits. A PDF is sent as stored. ETag from the stored file's sha256 (`-preview` added for the scaled copy), `Cache-Control: private, no-cache` (revalidated each
  time, answered 304 on a matching `If-None-Match`: the copy can change with the scaling rules while the file does not).
- **MCP** (`mcp/src/tools/ai-tasks.ts`): `list_ai_tasks` (read, pending by default), `get_ai_task` (read), `complete_ai_task`
  (`costs:write`, input `costIds`, `fuelLogIds`, `note`; refuses an empty list before calling the API) and `dismiss_ai_task` (`costs:write`,
  mode `undo`: destructive and idempotent). `get_ai_task` answers with the text (summary and JSON: task, file, defaults, open cost books with
  `default`/`taxRelevant`/`defaultSplit`, the cost categories, members with `ownershipPercent`, vehicles with plate, the uploader's pending
  `cost` suggestions of the last 30 days, newest first, at most 20) followed by the receipt as MCP **image content** (`ToolOutput.content`
  carries blocks after the text) or, for a PDF up to 4 MB, as an embedded `resource` with a blob; a larger PDF (`AI_TASK_PDF_READ_MAX_BYTES`, 4 MB, checked on the attachment's
  size before anything is fetched) is not sent at all: `file.problem` tells the model to dismiss the task with the reason "PDF zu gross", and the queue
  page's picker warns when such a PDF is chosen (`exceedsReadingLimit`, only where the file goes to the queue, not as the receipt of an entry). No dependency
  of the project can render PDF pages (pdfmake only writes them; `@napi-rs/canvas` does not read them), so a page is not turned into an image. The members' ownership share comes from `GET /users/directory`, which now also carries `ownershipBps` (every member can
  read it from the frozen shares of the cost entries anyway) and for that reason needs the `read` scope like the other reads (it used to be open to any
  authenticated caller, a token without scopes included). `list_costs` takes `reviewNeeded` and its rows carry `needsReview`.
- **Not built**: a notification for the uploader ("receipt processed"; it would need a new title key in both languages and the delivery
  rules), reopening a dismissed task, retention of dismissed tasks, the other kinds, and a way to complete a task by hand in the web app.
- **Tests**: `ai-tasks/ai-tasks.test.ts` and `preview.test.ts` (service), `routes/api/v1/ai-tasks/ai-tasks.test.ts` (API, scopes, visibility,
  review), `files/preview.test.ts` (sizes and encoding, table-driven), `costs/review.test.ts`, `mcp/src/ai-tasks-tools.test.ts` (tools, image and
  PDF content, the private inbox) and one through the HTTP endpoint in `routes/api/v1/mcp/mcp.test.ts`.

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
  generic owner `asset|room|page|task|defect|service_log|part|contact|cost|insurance_policy` + id, `role`, `label`, the maker's
  connection; unique per document, owner and role), `document_uploads` (push jobs). `AFTER DELETE` triggers on the
  ten owner tables (`0011`, `0014` for costs and `0018` for insurance policies) remove the links of a deleted owner (cascades included); a new link
  owner type needs its trigger and an entry in `documents/owners.ts` (it reuses the comments registry for title and url).
- **Sync** (`registerPaperless()` in `init()`, `integrations/paperless/sync.ts`, scheduler every 30 minutes, soon after
  a connection is saved - backoff ignored - and after a link was made so other people's caches catch up): per
  connection, the documents with a tag of `sharedTagIds` + `receiptTagIds` + `manualTagIds`, incremental by `modified`
  (a second of overlap), and every run every document a link points at (links made at another address are skipped; a
  linked document the account cannot see becomes `ownerVisible = false` without content). A full read (first run, other
  address or scope or warranty fields, once a day) also drops rows nothing needs. Outcome and backoff (1, 2, 4 ... 15
  min) are recorded on the connection like for Home Assistant.
- **In the web app**: every owner page has the "Archived documents" section (`components/documents/linked-documents.svelte`:
  link after a live search, preview, download, unlink); the **Documents** page (`/documents`, `GET /documents` with live
  search `q`, tag, correspondent and `linked` filters, a detail sheet from `GET /documents/{provider}/{id}` with the
  places the document is used and unlink) and its sidebar entry exist only for people with a working connection
  (`DocumentSystem` in `$lib/documents/system.svelte.ts` asks again when a connection is saved or removed); the page
  shows the connection's health (`status`, `lastError`) above the list. A device whose dates follow a document
  (`warrantySource = document`) says so on its page and in the edit form. Failure codes of a push are all worded in
  `$lib/connections/errors.ts` (`consume_failed`, `duplicate`, `interrupted`, `file_missing`, ...).
- **Links** (`GET|POST /document-links`, `DELETE /document-links/{id}`): creating one needs the caller's account to read
  the document (404 otherwise) and caches what it saw; 409 for the same document, owner and role. The link DTO has
  `available` (the caller's own cache row is visible and from the same instance): another person's private document
  shows as not shared, with no title, no `document`, no file urls. A page owner needs `docs:write` (like attachments).
  `GET /documents` lists the caller's synced documents (filters `tag`, `correspondent`, `linked`) or, with `q`, searches
  live (title and text, at most 100 hits); every item has `linkedTo` (link id, owner type, id, title, `ownerUrl`, role). `GET /documents/{provider}/{id}` is asked live.
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
  foreign keys (`asset|room|page|task|defect|service_log|part|asset_hint|contact|cost|insurance_policy|asset_note|tire_set|appointment|ai_task`), files stored
  once by sha256 in `HAUSWART_FILES_DIR` (`files/store.ts`: images re-encoded, metadata stripped,
  thumbnail; PDFs as uploaded; HEIC/SVG/HTML/GIF refused). Owner existence is checked through the
  registry in `attachments/owners.ts`: asset, room, page and task are built in; defect, service_log,
  part, asset_hint, contact, cost, insurance_policy, asset_note, tire_set, appointment and ai_task are registered by `registerDomainAttachmentOwners()`
  (`attachments/domain-owners.ts`, called from `registerDomainEventHandlers()`, so from `init()` and
  `useTestDB()`). A new owner type registers with `registerAttachmentOwner(type, existsFn)` **from
  `init()`** (never from a module that is only loaded with its routes) and calls
  `removeOwnedAttachments(ctx, type, id)` from its delete service (done for all fifteen; deleting an
  asset also removes the attachments of its service log entries, hints, notes and tire sets, whose rows go by cascade
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
  phone, e-mail or address), parts (name, part number, supplier, notes), asset hints (title, body) and insurance
  policies (title, policy number, notes; custom migration `0018`) and appointments (title, place, notes; custom migration `0023`) keep it current (archived assets, tasks, pages and
  parts are dropped). The plate of a vehicle is part of its asset's row (custom migration `0016_vehicle_search`:
  replaces `search_assets_au`, adds triggers on `vehicle_details`); nothing else of `vehicle_details` is indexed. No secret text enters the
  index: pages index `plain_text`; every other free text is cut off at the first `:::` when it
  mentions "secret" anywhere. Hit `url`s are the UI routes (`/docs/<slug>`, `/assets/<id>` also for
  plants and hints, `/rooms/<id>`, `/tasks/<id>`, `/defects/<id>`, `/parts/<id>`, `/contacts/<id>`, `/insurance/<id>`, `/appointments/<id>`).
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
  text in the base language) that is archived when the defect is fixed/rejected or has no deadline. A note on an
  asset can become a defect (`POST /asset-notes/{id}/to-defect`, see "Insurance policies and asset notes").
- **Comments** (`comments` table, `entityType` + `entityId`): a kind of entity is commentable once
  it is in `comments/registry.ts` (`exists`, `title`, `url`, optional `audience`; the urls are the UI
  routes, `/docs/<slug>` for pages). Deleting an entity removes its comments through
  `AFTER DELETE` triggers (migrations `0004` and `0007` for pages): add one per new commentable table. Delete is soft
  (empty body, `deleted: true`), edit is author-only (403 otherwise), delete is author or admin. A new
  comment notifies the other involved members (`notification_comment`). Tasks, assets, defects, hints,
  service log entries, pages, cost entries, insurance policies and appointments carry `commentCount`; cost entries (trigger in
  migration `0013`), insurance policies (`/insurance/<id>`, trigger in `0018`) and appointments (`/appointments/<id>`, trigger in `0023`) are commentable too.
- **Hint reactions** (`signalReactionSchema`, type `signal_change`) are stored with the hint
  (`GET /hints?reactive=true`) and executed by `signals/reactions.ts`, see below.

### Vehicles

- **A vehicle is an asset of kind `vehicle`** (no room; `GET /assets?kind=vehicle`, and `q` also matches
  the plate, both sides compared through `plateKey`: case, spaces, dots and dashes do not matter, so `zh 000.000` finds
  `ZH 000000`; `vehiclesWithPlateLike` in `vehicles/summary.ts`, in code and not in SQL, which could only strip the
  characters it was told about). `vehicle_details` (1:1, created by the first save) holds plate, VIN, Stammnummer
  (`registrationNumber`), `firstRegistration`, `fuelType`, tire sizes, `location`, `odometerUnit`
  (`km|mi`), notes and `costBookId` (the cost book its fuel fills go to, see "Fuel log"; `ON DELETE SET NULL`, migration
  `0027`). `GET|PUT /assets/{id}/vehicle`: PUT replaces (a field left out is cleared; the
  unit relabels the readings, it does not convert them), 400 for an asset of another kind, 404 for a
  missing one; GET answers empty details for a vehicle never saved and 404 for another kind. The asset
  DTO carries `vehicle: {plate, odometer: {value, date, unit} | null}` for vehicles only. The plate is
  indexed for search (see "Search"); deleting the asset removes the odometer signal as well. A vehicle cannot
  change its kind away (`PATCH /assets/{id}`) while it holds saved details (a row that says something; one saved
  with nothing in it does not count and goes with the change), odometer readings or tire sets: 400 field error on
  `kind` naming what is left (`vehicles/kind.ts`, `storedVehicleData`). Fuel log entries need no check of their own,
  each is also an odometer reading.
- **One rule for what only a vehicle has.** Everything under `/assets/{id}` that belongs to vehicles (`/vehicle`,
  `/vehicle/stats`, `/odometer`, `/fuel-logs`, `/tire-sets`, `/tire-sets/{setId}/mount`) treats an asset of another kind
  alike: a **read** is a 404 `not_found` (there is nothing of the sort to show, as for a missing asset), a **write** is a
  400 `invalid_request` (well formed, but that asset cannot have it); a missing asset is a 404 for both. It lives in
  `vehicles/kind.ts` (`assertVehicleForRead` / `assertVehicleForWrite`) and every registry description repeats it, so it
  reaches OpenAPI; `src/routes/api/v1/assets/vehicle-only.test.ts` runs the table. Endpoints addressed by the id of a
  tire set, fuel log entry or odometer reading (`/tire-sets/{id}`, `/tread`, `/fuel-logs/{id}`, `/odometer-readings/{id}`)
  look at no asset kind: those records can only exist for vehicles (see the kind rule above).
- **Odometer readings** (`odometer_readings`, never pruned): `POST /assets/{id}/odometer` (`date`
  defaults to today and is never in the future), `GET` newest first (keyset), `DELETE
/odometer-readings/{id}` (a reading written for a completion, service log entry, fuel log entry or tire change belongs to
  that record and is a 409 `conflict` naming the owner, `details.source`/`sourceId`; one whose record is gone, say a deleted
  task's completion, is free again). A value lower than the reading before it (the newest on or before the date)
  is a 400 on `value`, and so is a value higher than the reading after it (the first one on a later
  date; the same rule for every writer, completions, service log, fuel log and tire changes included), unless
  `force: true` (replaced instrument cluster). That 400 carries a structured reason in `details` besides the English field
  error (whose text is no contract): `code` `lower_than_previous` / `higher_than_next` (`ODOMETER_REFUSAL_CODES`), `field`
  (the request field it is reported on: `value`, `odometer` or `counterValue`) and `reading` `{value, date}`, the
  neighbouring reading in the way (`odometerRefusalDetailsSchema`, built by `outOfOrder` in `vehicles/odometer.ts`); every
  other 400 of a reading (future date, negative value, no vehicle) has no `code`, since `force` would not help.
  `recordOdometer(ctx, {assetId, date, value, source, sourceId?, note?,
createdBy?, force?})` is what other features call when they learn the odometer on the side (fuel log,
  tire change); `source` is `manual|completion|service_log|fuel_log|tire_change` and one
  `(source, sourceId)` has one reading, so saving the record again updates it. `writeOdometer` is its
  synchronous half (runs in the caller's transaction, `fields` names the request field a problem is
  reported on); `settleOdometer` re-evaluates the tasks that read the odometer and announces what became
  due (`recordOdometer` runs both).
- **The engine reads a signal, the readings stay the truth.** `syncOdometerSignal` rebuilds, after every
  insert, update and delete, the signal `odometer:<asset id>` (`odometerSignalKey`; source `manual`, so
  it never goes stale and is never pruned; unit of the vehicle) from the newest reading and one sample
  per reading (at noon of its date in the household zone, or the moment it was entered when earlier).
  A task counts on it with `counter_delta` and `entityId: "odometer:<asset id>"` (optionally `orEvery`);
  the Home Assistant adapter never asks for such a key (not an entity id). A change of the newest value
  goes through `settleSignalChanges` (auto-complete, hint reactions, re-evaluation, notifications, as for
  an adapter's readings). Readings come in now and then, so the estimate (`estimateCrossing`, windows of 28, 90 and
  365 days for manual signals) counts its days from the day of the newest sample, not from today: without a new
  reading it stays where it is, and once that day has passed it says tomorrow with low confidence. A counter task remembers the first value it saw (`task_state.counterBaseline`) until a
  completion snapshots one; the same sync forgets that value when no reading has it any more (the typo that was deleted
  or corrected), so the task starts again from what the vehicle shows instead of counting from a number it never had.
- **Other writers.** A completion with a `counterValue` of a task that reads the odometer records a
  reading dated the day of the completion (`vehicles/events.ts`, a listener on `completionRecorded`, so
  inside the completion's transaction): a value equal to the reading on or before the completion's date
  (including the counter snapshot a completion takes by itself) adds nothing, a lower one fails the completion
  with a 400 on `counterValue`, undo removes the reading. Without a `counterValue` such a task snapshots the
  reading on or before the completion's date (`readingOnOrBefore`, the last one entered among a day's), not the
  current one, so a completion dated back counts from what the odometer showed that day (dated before the first
  reading it takes no snapshot and the task goes on from its remembered starting value; any other counter, say a
  Home Assistant one, still snapshots its current value); the complete and undo handlers then re-evaluate the other tasks that read
  the same odometer (`refreshOdometerReaders`), so they do not wait for the scheduler. A service log entry's `odometer` (vehicles only, 400 on `odometer` for anything else)
  keeps one reading in step with the entry through create, update (value or date) and delete, in the
  entry's transaction; the handlers re-evaluate the readers at once (`refreshOdometerReaders`). A task that counts on a
  vehicle's odometer says so in the lists: every dashboard task (also `nextTasks` of the statistics) carries
  `odometerAssetId`, the vehicle of its `counter_delta` on `odometer:<asset id>` (`odometerAssetOfTrigger`, read from the
  stored trigger), else null, so a one-tap completion opens the reading dialog without fetching the task first.
- **Tire sets** (`tire_sets`, `tire_set_events`, migration `0020`; `vehicles/tires.ts`, rules in `lib/vehicles/tires.ts`):
  `GET|POST /assets/{id}/tire-sets`, `GET|PATCH|DELETE /tire-sets/{id}`, `POST /assets/{id}/tire-sets/{setId}/mount`,
  `POST /tire-sets/{id}/tread`. A set has season (`summer|winter|all_season`), brand, model, size, `dot` (week and
  year, `"2423"`, validated as week 01-53 plus two digits), tread depth and the day it was measured, storage location
  and contact (a tire hotel), purchase date and `retiredAt`. At most one set per vehicle is `mounted` (partial unique
  index and the mount code). **Mounting** (`mountTireSet`) takes the mounted set off (an `unmounted` event of the same
  day and odometer), writes the `mounted` event and, with an `odometer`, a reading of the vehicle (source `tire_change`,
  the mount event as `sourceId`; lower than the reading before is a 400 on `odometer`), in one transaction; 409 for a
  retired or already mounted set. A mount dated before the day the set it takes off was (last) mounted is a 400 on `date`
  (the same day is fine), so an `unmounted` event never precedes its `mounted` one. Whether a set is mounted and its tread change only through mount and tread (each
  measurement is a `tread_measured` event, the newest is the set's depth, and an `odometer` with it is a reading of the
  same kind and rule as for mounting); `retired: true` takes a mounted set off.
  The DTO carries `treadWarning` (below 3 mm summer, 4 mm winter and all-season, `TREAD_WARNING_MM`), `ageYears` (from
  the DOT, one decimal), `mountedOn` and `distance` (`tireSetDistance`: odometer at the unmount, or the newest reading
  while mounted, minus at the mount; events without an odometer use the newest reading on or before their date).
  Completing a tire-change task does not mount anything: the frontend completes the task, then calls mount. Photos are
  attachments of the owner type `tire_set` (comments and document links are not offered).
- **Fuel log** (`fuel_logs`, migration `0021`; `vehicles/fuel-logs.ts`, consumption in `lib/vehicles/fuel.ts`):
  `GET|POST /assets/{id}/fuel-logs` (list takes `year`) and `GET|PATCH|DELETE /fuel-logs/{id}`; writing needs
  `costs:write` (it books money, like accepting a finance suggestion), reading `read`. A fill has `date`, `odometer`,
  `quantity` and `unit` (`l|kWh`, default by the vehicle's fuel type), `amountMinor` + `currency`, `fullTank`,
  `missedPrevious`, `station`, `notes`. **Creating** is one transaction: the fill, an odometer reading (source
  `fuel_log`, same monotonic rule, 400 on `odometer`) and, unless the amount is 0 (a free charge), a cost entry of the new
  category `fuel` for the vehicle (title "Tanken <station>" or "Laden ..." in the base language, payee = station, paid by
  `paidByUserId`, default the caller). **The book**: `bookId` of the request (an open book, else 400 on `bookId`, also for a
  free fill), else the vehicle's own `costBookId` while that book is open, else the default book; `splitMode` is the one
  asked for, else the split of the book the entry lands in (it used to be `ownership` always). The DTO carries `bookId`
  and `bookName` of the cost entry (null for a free fill). **PATCH** moves the reading with date and
  odometer and keeps the cost entry in step for amount, currency, date, station (title and payee, the unit decides the
  title too), payer, split and book (`bookId` moves the entry as `PATCH /costs/{id}` does, resetting a tax class the new
  book cannot have; the book it is in already is always accepted; on a free fill it changes nothing, and a fill that starts
  costing in the same request is booked into it; made free it loses the entry; costing again gets a new one in the vehicle's
  or default book; an entry somebody deleted is not brought back by other changes). **The fill owns what it booked**: on the cost entry (`PATCH|DELETE /costs/{id}`) a
  change of amount, currency, date or device (`assetId`, which would break the link to the fuel log and the vehicle's
  statistics) and a delete are a 409 `conflict` (message names the fuel log, `details.fuelLogId`;
  repeating the current values is fine, so is every other field: category, title, notes, payee, payer, split, deductible,
  room, defect, service log entry, receipts) and `CostEntry.fuelLogId` points back (null for any other entry, and once
  the fill is gone the entry is free). The fill passes `{fuelLogId}` to `updateCost` to move amount, currency and date (its
  device is the vehicle's and is never sent), and lets go of the entry (`cost_entry_id` null)
  before it deletes it. Title and payee of the entry are rewritten by a change of station or unit only while each still
  equals what the fill wrote last time (`writtenNames`), so a title edited on the cost entry stays; the two are judged apart. **DELETE** removes the reading and the cost entry with its receipts. A fill itself
  takes no attachments, comments or document links: receipts go on its cost entry. Consumption is the full-to-full method (`fuelStretches`): a full fill
  closes a stretch from the previous full fill, partial fills in between are added up, a fill flagged `missedPrevious`
  starts the chain again, litres and kWh are separate chains; the DTO carries `pricePerUnitMinor` (a rate in minor
  units, not an amount), and on a closing fill `distance`, `consumptionPer100` and `costPerDistanceMinor` (unknown when an
  amount in the stretch is in another currency), worked out from the whole log whatever page is asked for.
- **Statistics** (`GET /assets/{id}/vehicle/stats?year=`, all time without a year; `vehicles/stats.ts`, distance maths in
  `lib/vehicles/stats.ts`): `distance` and `distanceByMonth` from the odometer readings (a stretch between two readings
  counts evenly for the days after the first up to the second, so a mid-month reading splits the stretch; nothing before
  the first or after the last reading; a reading lower than the one before adds nothing), `costs` (the vehicle's cost
  entries that count as an expense, household currency only, by category, `otherCurrencyCount` for the rest),
  `costPerDistanceMinor`, `consumption` per unit (average weighted by distance and the last ten, over the stretches closed
  in the period), `priceTrend` (last 24 fills), the mounted `tireSet` and `nextTasks` (at most five, from
  `getUpcomingTasks(ctx, {assetId})`, the dashboard's selector). `GET /costs/summary` takes `assetId` too: everything in
  it is then that asset's alone.
- **Task templates** (`lib/vehicles/templates.ts`, pure, titles are Paraglide messages in the given
  locale): winter and summer tires (yearly calendar, October/April 15th, `earlyDays` 14, preparation
  "Garagentermin buchen" 28 days ahead), service (`counter_delta` on the odometer, 15000 km / 10000 mi,
  `orEvery` 12 months), MFK (`one_off`; `suggestMfkDate` = 4, 7, then every 2 years after the first
  registration), vignette (yearly, end of January), vehicle tax (yearly, payment), brake fluid and
  air-conditioning service (every 2 years). Each returns `{id, task, preparations}`: the frontend sends
  `task` to `POST /tasks`, then each preparation to `POST /tasks/{id}/preparations`. `task` carries the mark
  `externalSource: "vehicle_template"`, `externalRef: "<asset id>:<template id>"` (the pair is unique on the server).

### Insurance policies and asset notes

- **Insurance policies** (`insurance_policies`, `insurance_policy_assets`, migrations `0017` and, for the
  triggers, `0018`; `insurance/policies.ts`): generic and shared by the household (`type`: car liability / partial /
  full casco, contents, personal liability, building, legal, travel, health, life, other). `title`, the insurer as
  a contact (`insurerContactId`, set null when the contact is deleted; the DTO has `insurerName`), `policyNumber`,
  `premiumMinor` per `premiumPeriod` (`monthly|quarterly|semiannual|annual`) + `currency` (the household's when
  omitted), `deductibleMinor` (same currency), `startDate`, `endDate` = the **last day of cover** of the current term
  (what an insurer prints as "expires 1 January" is 31 December here), `renewal` (`auto|fixed`),
  `cancellationNoticeMonths`, `assistancePhone`, `showOnEmergency`, `notes`, `archivedAt`. What a policy covers is
  a many-to-many list (`assetIds`, replaced as a whole by PATCH); deleting an asset or the insurer's contact never
  deletes the policy.
- **Derived, never stored** (`lib/insurance/policy.ts`, pure, client-safe, table-tested): `annualPremiumMinor` =
  premium times the periods in a year (exact integer) and `cancellationDeadline` = `endDate` minus the notice months,
  clamped to the end of a shorter month (31 May and 3 months = 28 February); an end date that is the last day of its
  month gives the last day of the target month (30 June and 3 months = 31 March), only for `renewal: auto` with an
  end date and a notice period, else null. It is a function of three stored fields, so storing it could only let it
  disagree with them; the web form can show it live with the same function. It does not roll by itself: after an
  automatic renewal somebody moves `endDate` to the end of the next term and the deadline and reminder follow.
- **API**: `GET|POST /insurance-policies` (filters `assetId`, `type`, `q` over title, policy number and insurer's
  name; only active ones unless `archived=true`, which lists the archived ones; sorted by deadline, none last, then
  title), `GET|PATCH|DELETE /insurance-policies/{id}` (`archived` archives and restores), `GET
/assets/{id}/insurance-policies` (for the asset page; 404 for an unknown asset). The DTO carries the covered
  assets (id, name, kind), `reminderTaskId` and `commentCount`.
- **Reminder task** (`insurance/reminder.ts`, `syncReminder` after every create and update; the defect pattern): a
  `one_off` task with `externalSource: "insurance"`, `externalRef` = the policy id, category `payment`, text in the base
  language, `externalUrl` `/insurance/<id>`, **due on the deadline itself** (so every date shown anywhere is the real
  one), `dueSoonDays` 14 and a preparation 30 days ahead. It exists while the policy is active and the deadline is
  today or later; it is archived when the policy is archived or the deadline goes away or moves into the past (an
  overdue reminder that nobody finished stays, whatever else of the policy is edited, until the dates change) and the
  same task comes back. A one-off task
  stays done once completed, so when the deadline moves and the reminder was completed or skipped, that task is kept
  archived with its history under `externalRef` `<policyId>@<taskId>` and a new one is created for the new deadline;
  an unfinished one moves in place. Deleting the policy deletes all of them.
- **Owner type `insurance_policy`**: attachments (policy documents), document links (new roles `policy` and
  `registration` = vehicle registration; trigger in `0018`), comments (`/insurance/<id>`, trigger in `0018`) and search
  (`search_fts` kind `insurance_policy`: title, policy number and notes cut at a secret block, never the assistance
  phone; archived policies are dropped).
- **Emergency**: not archived policies with `showOnEmergency` are in `GET /emergency` (`insurance`: insurer name and
  phone, policy number, assistance phone) and in a section of the sheet (left out when there are none). Guest links
  never show policies: no guest section fits, the guest view reads none.
- **Asset notes** (`asset_notes`, migration `0019`; `asset-notes/`): small issues to mention at the next
  appointment ("brakes squeak"). `body` (at most 2000 characters), `status` `open|resolved`, `resolvedAt`,
  `resolvedBy`, `serviceLogId` (the entry that addressed it, set null with the entry), `defectId` (set null with the
  defect), `createdBy`. `GET|POST /assets/{id}/notes` (`status` `open` (default), `resolved` or `all`, newest first),
  `PATCH|DELETE /asset-notes/{id}`: resolving records who and when, reopening clears both and the service log link,
  asking for the status a note already has changes nothing. The owner type `asset_note` takes photos (they go with the
  note, and with the asset); a note takes no document links.
- **To a defect** (`POST /asset-notes/{id}/to-defect`, 201 `{note, defect}`): in one transaction a defect on the asset
  (title = the first line cut to 200 characters, description = the text, discovered the day the note was written,
  medium, **no deadline and so no reminder task**: a note is not a claim against the builder, so the household's
  handover deadline is not assumed) and the note resolved with `defectId`. 409 for a note that already is a defect;
  once that defect is deleted the note can be converted again.
- **Resolving through the service log** (`asset-notes/resolve.ts`): `resolvedNoteIds` on service log create and
  update and inside `serviceLog` of `POST /tasks/{id}/complete`. The notes must exist and belong to the entry's asset
  (400 on `resolvedNoteIds`, in a completion on `serviceLog`, before anything is written); open ones become resolved
  with the entry (`resolvedBy` = whoever wrote it), resolved ones stay as they are, so a retry changes nothing; an
  update only adds. The notes and the entry are written in one transaction. **Undoing** the completion that wrote the
  entry reopens its notes (listener on `completionRevoked`, `asset-notes/events.ts`; the entry stays in the log) and
  **deleting** an entry reopens them too. Neither reopens a note that was turned into a defect in the meantime
  (`defectId` set; `reopenNotesOf` skips it): the defect carries the issue on, so the note would be listed twice.
  Once that defect is deleted the note counts as an ordinary resolved one again.
- **`openNoteCount`** is on every task and every dashboard task: the open notes of the task's asset (a correlated
  subquery, 0 without an asset), so the due service task can say "3 Anliegen". The complete endpoint reads the task
  again after writing the entry, so the count it returns is current.
- **Notices**: the due soon and due notices of a task whose asset has open notes are
  `notification_due_soon_notes` / `notification_due_notes` (the usual params plus `notes`, counted when the notice is
  written; the dedupe key is the same, so a stage is still announced once). Prep and overdue notices are unchanged.

### Appointments

- **Appointments** (`appointments`, migrations `0022` and, for the triggers, `0023`; `appointments/`, `lib/appointments/when.ts`):
  the household's "Termine" (a service visit, an inspection, a delivery), shared by everybody. `title` (200), plain-text
  `notes` (5000, no markup), `location` (300), `status` `planned|done|cancelled` (any status can be set from any other).
  **Two kinds, one CHECK**: timed (`allDay` false, `startsAt` < `endsAt`, UTC instants) or all-day (`allDay` true,
  `startDate` <= `endDate`, calendar dates in the household zone, the last day included, so it never moves with the zone); the
  fields of the other kind are null. At most 14 days (`whenProblem`, one function for the request schema, the form and the service, which
  re-checks the merged result; it has no time zone, so a timed one may be up to 14 days and an hour in real time,
  `MAX_TIMED_SPAN_MS`: 14 calendar days across the night the clocks go back are an hour longer, forward an hour shorter). On create `endsAt` defaults to an hour after the start and `endDate` to `startDate`. Optional
  `taskId` + `occurrenceKey` (the occurrence it is for: **pinned** when the appointment gets a task - on create, or in a PATCH that
  changes the task - as the key the task shows then, unless the request names one; the engine's placeholders `none` and `s:none`
  mean "no occurrence" and are never stored, so those stay null), `assetId` (defaults to the task's asset on create) and `contactId`, all
  `set null` when the target is deleted (the DTO shows no `occurrenceKey` without a task); `createdByUserId`. **For a later sync**: `id`
  is stable and `updatedAt` (from the injected clock) moves with every change, status included; a PATCH that changes nothing
  leaves it alone.
- **API**: `GET|POST /appointments` (scopes `read`/`write`; filters `from`/`to` = days in the household zone, both included, an
  appointment is listed when it overlaps one of them - a timed one counts on every day it touches, at midnight it ends it does
  not count on the next -, `assetId`, `taskId`, `contactId`, `status`; soonest first, an all-day one from midnight of its first
  day, then longer, title, id; offset cursor), `GET|PATCH|DELETE /appointments/{id}`, `POST /appointments/{id}/complete`.
  Instants are UTC ISO strings. **PATCH** changes what is given and refuses a result that breaks the rules (a start moved
  behind the end is a 400 on `endsAt`; nothing is shifted implicitly); `allDay` switches the kind and then needs the new start
  (`startDate` or `startsAt`); the fields of the other kind without `allDay` are a 400; a new `taskId` pins the occurrence that
  task shows now (the old key means nothing for it), `occurrenceKey: null` for the same task removes the pin; `status: done`
  records the status only. Create/PATCH 400s are field errors (`taskId`, `assetId`, `contactId`, `startsAt`, `endsAt`,
  `startDate`, `endDate`, `occurrenceKey`), 404 for a missing appointment.
- **Complete** (`complete.ts`): sets `done` and, with a task, completes the occurrence the appointment is for through
  `completeTask` with the idempotency key `appointment:<id>` as the caller (a session is `manual`, a token by its kind, like any
  completion; `note`, `completedAt` as for tasks). Always 200 with `{appointment, completion, task, replayed}`; a repeat answers with
  the first completion (`replayed`). **Which occurrence** (`mayComplete`, built so that it can neither count the work twice nor skip a
  cycle): a _pinned_ appointment completes only while the task still shows its pinned key (else somebody settled it, or it was missed,
  and what is shown is a later cycle); an _unpinned_ one (the task showed none, an explicit `occurrenceKey: null`, an older row) names
  nothing, so it completes the shown occurrence only if that is dated and fell due on or before the appointment's last day (`lastDay`
  in the household zone, an end at midnight belongs to the day before) - a later one belongs to a cycle the visit came before, an
  undated one has nothing to compare, a task that shows none has nothing to settle. Both also leave an occurrence the engine reports
  as handled (`state.reasons` has `completed`, `skipped` or `acknowledged`: a one-off, warranty or bill task keeps its key when it is
  done) - the engine's verdict, not a lookup of completions with that key, because a `min_per_period` task shows one key until its
  last completion of the period. `completion` is then null, as it is when the task is archived; the appointment is done either way.
  A cancelled appointment is a 409. A key is bound to its completion for good, so after the completion was undone and
  the appointment completed again the next one is `appointment:<id>:2` (and so on). **Undoing the task's completion does not
  reopen the appointment**, and reopening the appointment does not undo the completion: it took place either way.
- **On tasks and the dashboard**: every task DTO (list, `GET /tasks/{id}`, the answers of complete/skip/snooze) and every
  dashboard task carries `nextAppointment: {id, allDay, startsAt, startDate} | null`, the earliest _planned_ appointment of the
  task (a correlated subquery, `appointments/next.ts`; timed and all-day ones are ordered with a date as midnight UTC). One whose time has
  passed but that is still planned counts: the task stays what it is waiting for until somebody completes or cancels it. The
  due-date engine is not involved.
- **Owner type `appointment`**: comments (`/appointments/<id>`, trigger in `0023`; `commentCount` on the DTO), attachments
  (`removeOwnedAttachments` on delete), search (`search_fts` kind `appointment`: title, place and notes cut at a secret block, all
  statuses; `/appointments/<id>`). Document links are not offered.
- **iCal feed** (`calendar/feed.ts`, no switch of its own): every appointment that is not cancelled and ended less than 30 days
  ago (`APPOINTMENT_LOOKBACK_DAYS`, also the SQL lower bound on `ends_at` / `end_date`, so history is never loaded; planned ones that were never closed and done ones) as `appointment-<id>@hauswart`; scope `mine` =
  appointments without a task, of an unassigned task or of a task whose current assignee is the owner, `all` = every one.
  A timed one is `DTSTART:20260615T070000Z` / `DTEND` in UTC (no VTIMEZONE needed, no guessing on the nights the clocks change), TRANSP
  OPAQUE; an all-day one is `VALUE=DATE` with an exclusive `DTEND`, TRANSPARENT. `SUMMARY` the title, `LOCATION`, `DESCRIPTION` the
  asset and "Für: <task>", `URL` `/appointments/<id>`; never the notes. SEQUENCE/LAST-MODIFIED from `updatedAt`. The feed's alarm applies
  to planned ones: for a timed one as a trigger relative to DTSTART worked out on real instants (`alarmTime` in the household zone on
  the day `alarmDaysBefore` days before the start, e.g. `-PT37H` across the spring-forward Sunday), left out when it would ring after
  the start. Events sort by their date in the household zone.
- **MCP**: `list_appointments` (`from` defaults to today, for status planned to 30 days back, so a planned appointment that is over but was never
  closed shows up with `overdue: true`), `create_appointment` (times as `date` + `startTime`/`endTime` in the household zone, without
  `startTime` all-day), `update_appointment` (moving keeps the length, in real time, unless an end is given) and `complete_appointment`;
  task rows carry `appointment`.

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
  task; appointments are included too, see "Appointments"); a `min_per_period` window is a multi-day span; estimates only with `includeEstimated`
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
  secrets included), emergency contacts (full), `showOnEmergency` assets with pinned hints and `showOnEmergency` insurance policies
  (insurer, policy number, assistance line; a section of the sheet when there are any).
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

### Calendar sync

Pushes appointments, due dates, preparations and deadlines into a calendar of a connected system, so they show up next to everything else
people plan. Optional like every adapter: without a target nothing happens, and the core knows no calendar system by name.

- **The seam** (`calendar-sync/provider.ts`): an adapter calls `registerCalendarProvider({kind, listCalendars, open, fingerprint?})` (`kind` is in
  `CALENDAR_PROVIDERS` in `enums.ts`, and is also an integration kind). `open(connection, calendarId)` resolves the calendar once per run
  and returns a `CalendarSession`: `name`, `capabilities` `{create, update, delete, alarms}`, `listEvents(range)` (every event, ours with
  a `ref`, foreign ones with `ref: null`), `create(item)` (answers `{uid}`, or `uid: null` when the system does not tell),
  `update(uid, item)` and `delete(uid)`. All throw `IntegrationError(code, message)`. A `CalendarItem` is `ref`, `summary`, `description`
  (no marker), `location`, `when` (`{allDay, startDate, endDate}` with an **exclusive** end, or `{startsAt, endsAt}` instants), `path`
  (`/tasks/<id>`, the provider may add the app address) and `alarmMinutes`. A CalDAV adapter plugs in with no core change: it hands back
  `ref` from wherever it keeps it (the UID, an X-property), returns the `uid` it chose from `create`, and sets `alarms: true` to receive
  `alarmMinutes`.
- **Tables** (migrations `0024_calendar_sync`, `0025_calendar_target_remote_name`): `calendar_targets` holds the connection, provider, `remoteCalendarId`, `remoteName` (the calendar's own
  name as the system last reported it, updated by every run; `name` is the target's, given when it was added), name, `level`
  (`household|user`) with the `userId` the check requires, `enabled`, `configJson`, `capabilitiesJson` (from the last time the calendar was
  opened) and the health: `status`, `lastError` code, `lastOkAt`, `lastCheckedAt` (the last attempt), `consecutiveFailures`, `lastStatsJson` (null for a run that failed before it counted anything). The API adds `nextAttemptAt`: `lastCheckedAt` plus the back-off after failures, else plus 15 minutes (`schedule.ts`), null for a target that is off or was never tried.
  It is **unique per provider and calendar**, because two targets in one calendar would delete each other's events. `calendar_links` holds
  target, `kind`, `itemId`, `instanceKey`, `ref`, `remoteUid` (nullable), `status` (`synced|forgotten`), `contentHash` and `lastPushedAt`,
  unique per target, kind, item and occurrence. Deleting the connection or the person removes their targets and links; events already in the
  calendar stay.
- **Level** follows the connection: a household kind (Home Assistant) gives household targets, managed by administrators and visible to
  everybody (`canManage` says which); a per-person kind gives targets of that person, invisible to others (404). `scope` `mine` (tasks and
  appointments of the owner or of nobody) is only for personal targets; a household target is always `all` (400 on `config` otherwise).
- **Config** (`calendarTargetConfigSchema`): `kinds` is required, a non-empty set of `appointments`, `task_due`, `preparations`,
  `defect_deadlines`, `insurance_deadlines` and `warranty_ends`. `direction` is only `push`: `pull` and `both` are rejected rather than
  accepted and ignored, so the field can widen later without a lie in between. Then `scope`, `timedMode` (`all_day|timed`) with `dueTime`
  (08:00) and `dueDurationMinutes` (30) for items that only have a date (a multi-day span stays all-day), `alarmMinutes` (null),
  `titlePrefix`, `onRemoteDelete` (`recreate|forget`), `conflictPolicy` (only `hauswart_wins`: edits in the calendar are not detected, an
  event is only written again when the item changes in hauswart; `remote_wins` needs the pull direction) and `locale` (the language of
  generated titles and descriptions).
- **One reading** (`calendar/entries.ts` `readCalendarEntries`): the iCal feed and sync share it, so they cannot disagree about what is in a
  calendar. Entries carry titles, places and dates only: never task descriptions, notes, comments, policy numbers or secrets (a test plants
  text in every one of them). A defect's or policy's own entry stands for its reminder task when that kind is carried (`skipTaskSources`).
  `insurance_deadlines` is the cancellation deadline of an active policy (`insurance-<id>-cancel`), from today on. UIDs are `task-<id>-<occurrence>`,
  `prep-...`, `appointment-<id>`, `defect-<id>-deadline`, `warranty-<id>`: a completed occurrence is another item than the next one.
- **Items** (`items.ts` `buildDesiredItems`): the entries inside the horizon (31 days back to 400 ahead; estimates are never carried), with the
  prefix, timing and reminder of the target, sorted by start. `hash` = sha256 (32 hex) of ref, summary, description, location, when, path,
  alarm and the provider's fingerprint; it does not depend on `updatedAt`. The reminder is only part of an item for a calendar with
  `capabilities.alarms` (a provider that keeps none never has its events rewritten for it), and the fingerprint is what the provider adds on top
  of the item (`CalendarProvider.fingerprint(connection.config)`, no calendar call; for Home Assistant the app address its links are built
  from), so a changed `appUrl` or `ORIGIN` writes the events again once. `itemSettingsOf` gives the scheduler the same settings a run builds.
- **The marker** (`ref.ts`): an event is ours only if its description (or the provider's own field) carries `hw-ref: <ref>@sync.hauswart`.
  The engine never names an event without it, whatever its id says. Text that merely mentions it does not count (the whole line must match).
- **Reconcile** (`reconcile.ts`, pure, table-tested including a simulated calendar that must settle in at most three passes): per ref,
  from desired items, links, the events found and the capabilities. Wanted and found: nothing when the link's hash is the item's, else
  `update`; without update but with create and delete `replace` (delete, then write; the link is dropped in between so a failed write
  is simply written again); create-only calendars keep the old event and only remember the new hash (`acknowledge`, so it is not tried
  every minute). Wanted, linked, not found: somebody deleted it; `recreate` writes it again, `forget` keeps a `forgotten` link that is
  never written again until the item is gone. A link without an id that is not found (written a moment ago) is waited for, never written
  twice (`unconfirmed`), but for 30 minutes after it was pushed (`UNCONFIRMED_GRACE_MS`, from `lastPushedAt`): after that it counts as
  deleted like any other (`onRemoteDelete`), which is how a target recovers once a calendar keeps the marker again (the events it dropped
  the marker from stay in the calendar as foreign ones).
  A calendar that lists events without ids keeps them as they are: the link remembers `NO_UID` (`''`), such an event is neither changed nor deleted (the link goes when its item goes).
  Not wanted: the event is deleted when the calendar allows and it was found (otherwise only the link goes), including events of
  ours that nothing remembers when their kind is carried; duplicates of one ref keep the one the link names. The result is a mirror of the
  horizon: an occurrence that was completed disappears from the calendar. Steps are ordered delete, change, create, each by date.
- **A run** (`sync.ts` `syncTarget`): open, read the events of the horizon plus two days, reconcile, apply with at most 100 calendar calls
  (a replace is two; `counts.remaining` says how many steps are left; the scheduler goes on at once), save the link after every step, then look the ids of new events up
  by their marker (`uid: null` creates): the first such create of a run is looked up at once, and when the marker did not survive (a
  calendar that drops the description) the run stops with `unconfirmed`, so such a calendar gets one stray event per run and not one per
  item; the ids of the others are looked up together at the end. A refusal of the system (`unauthorized`, `forbidden`, `network`, `timeout`, `tls`, `server`, ...)
  stops the calls, any other failure is counted and the rest goes on; five failures stop too. A delete that finds its event gone has done what it should; a change that finds it gone (deleted after the events were read) writes it again or leaves it, as `onRemoteDelete` says. The outcome is the target's health:
  `status`, `lastError`, `consecutiveFailures` and the usual 1, 2, 4 ... 15 minute back-off (`dueForAttempt`). Codes: the connection's own and `calendar_missing`, `unsupported`
  (the calendar cannot create), `unconfirmed`, `config_invalid`; a target that is switched off, whose connection is off or whose adapter
  does not run is answered (`disabled`, `no_connection`, `provider_unavailable`, `busy` for a second run at once) without touching its health.
  A target deleted during its run stops the run at the next step (a 404 as for any missing target) and nothing is saved for it. Logs carry codes only.
- **Scheduler** (`registerCalendarSync()` in `init()`): every minute it compares what hauswart knows with the links **without calling any
  calendar** (`hasPendingChanges`) and syncs the targets with a difference, which is how a change is written within a minute without
  instrumenting every service; every 15 minutes every target is synced regardless (that is how a deleted event is noticed). A saved target
  (event `calendarTargetChanged`), a saved connection and a completion (`completionRecorded`/`Revoked`, which move the next due date) kick a
  run after two seconds; targets that failed back off and are tried again as soon as the back-off is over (pending changes or not), and a run that was cut short by its size goes on at once, but a failed one does not. A request
  that finds its target busy (a manual sync) comes round again. Overlap guard, `unref`, injectable intervals and clock.
- **API**: `GET /calendar-targets`, `POST` (404 without a working connection or adapter, 400 on `remoteCalendarId` for a calendar that does not
  exist (`details.code` `calendar_not_found`) or cannot create (`calendar_unsupported`), 409 for a calendar that has a target, 502 `upstream_error` with `details.code`), `PATCH /{id}` (`config` is merged),
  `DELETE /{id}?removeRemote=true` (deletes the events carrying the marker first, linked or not, holding the target's run lock so no sync
  writes them again meanwhile: 409 `details.code: "busy"` while a run is going on, 400 on `removeRemote` for a calendar that cannot
  delete, 409 for a connection that is off, 502 with the target left as it was when nothing was touched yet; once events were deleted a
  failure or a too long list leaves the target **switched off** (502 with `details.deleted/remaining/disabled`), because the items still
  exist and the next sync would write the events again, and a second try goes on) and `POST /{id}/sync` (run now, a failed run is
  `ok: false` with the code, not an HTTP error). Scopes `read`/`write`; household targets additionally need the `admin` scope (403). The calendar
  picker `GET /integrations/{kind}/calendars` carries `capabilities` per calendar.
- **Home Assistant** (`integrations/homeassistant/calendar-provider.ts`, `calendar-events.ts`): a calendar is a `calendar.*` entity and
  `supported_features` says what it takes (create 1, delete 2, update 4); Home Assistant has **only a service for creating**
  (`calendar.create_event`, which does not return the id), so update and delete are the WebSocket commands `calendar/event/update|delete`
  (`haWsCall`), and the id of a new event is found again in `GET /api/calendars/<entity>` through the marker (the Local Calendar supports all
  three, Google create and delete, CalDAV create only; `alarms` is always false, Home Assistant keeps no reminders). Times are naive wall-clock
  strings in the zone of `GET /api/config` (`2026-06-20T09:00:00`; the household zone is converted by instant, and both ends need no common offset across
  the night the clocks change; in the night the clocks go back a time between 02:00 and 03:00 exists twice and Home Assistant reads it as the first
  one, so an event there can sit an hour off, and an event that starts in the first pass and ends in the second, which would end before it starts on the
  clock, gets its end as start plus its length so that Home Assistant accepts it), all-day items `start_date`/`end_date` with the exclusive end. The description is the item's text, a link when `appUrl`
  or `ORIGIN` is known, an empty line and the marker. Reads and `update` are retried twice (`retryTransient`, 300 and 600 ms) on `timeout`, `network`,
  `server`; `create` and `delete` never (a second event, or a delete of a deleted event). Home Assistant refuses a change or delete of an event it
  does not know with the same bare code `failed` as every other refusal (`not_found` is only the entity), so after such a refusal the adapter reads
  the span it listed last and answers `not_found` if the id is not in it (else the refusal stands). Fake: `fake-server.ts` models features, `create_event`,
  the commands and the zone; tests in `calendar-provider.test.ts` (calls, zones, failures, timeouts, malformed bodies) and `calendar-sync.test.ts` (the core runner against
  full, create-only and create-and-delete calendars). A core test must not import the adapter: `calendar-sync/testing.ts` has in-memory fake calendars.
- **Not built yet**: CalDAV/iCloud (the seam is meant for it), the pull direction (`pull`, `both`, `remote_wins`), `.ics` URL subscriptions as
  triggers, detecting edits made in the calendar. One hauswart per calendar: another install writing the same marker into a calendar would
  delete the events of the first.

### MCP server

`mcp/` holds the MCP server for Claude (Claude Code, Desktop) built on `@modelcontextprotocol/sdk` with
Zod 4 input shapes. hauswart serves it itself over HTTP (`POST /api/v1/mcp`, below); `bun run mcp` runs
the same tools over stdio from source for development (no compiled binaries). It is a REST client like
the others: `createApiClient(fetch, baseUrl, {token})` from `src/lib/api`, so endpoint and schema
changes break its build. It imports only client-safe modules (`src/lib/api/**`,
`src/lib/tasks/engine/types`, `src/lib/dates`; a test bundles the stdio entry, which pulls in the whole
server, and fails on any `src/lib/server`, `src/routes` or `src/lib/testing` input). `$lib` aliases
inside those modules resolve through the root tsconfig (Bun and vite both honour it); the root
tsconfig also includes `mcp/**` so `bun run check` type-checks it. The app imports
`mcp/src/server.ts` (`buildHauswartServer`) from `handlers/mcp.ts`; never the other way round.

- **Over HTTP** (`handlers/mcp.ts`, registry entry `mcp`, `src/routes/api/v1/mcp/+server.ts` exports
  POST only): Streamable HTTP, **stateless** - per request a new `McpServer` and a
  `WebStandardStreamableHTTPServerTransport` with `sessionIdGenerator: undefined` and
  `enableJsonResponse: true`, answered with plain `application/json` (a notification gets an empty
  202). No session, no stream: GET and DELETE have no route, so SvelteKit answers 405 (the SDK's
  stateless transport would open an SSE stream on GET, which must not happen). It sits under `/api/v1`
  as a registry endpoint (`auth: "bearer"`, scope `read`, `responseType: "binary"` - allowed for POST
  too - with the JSON-RPC message as the body schema), so it gets everything `bind` does: bearer
  tokens only (the cookie is 403, a missing or bad token 401 with `WWW-Authenticate: Bearer` from the
  hook), the 300/min token limit (the tools' own API calls count too), the 512 KB body cap and the
  authz matrix. The handler passes the already parsed body to the transport (`parsedBody`), maps what
  the transport refuses (406 `Accept`, 400 protocol version, ...) to the API error envelope with the
  same status, and builds the server with `buildHauswartServer` from the principal (user, scopes,
  household), so there is no `authMe`/`householdGet` round trip. The tools' API client calls
  `event.fetch` with the caller's own bearer token (`credentials: "omit"`): SvelteKit answers it in
  process through the hook and `bind`, so scopes and attribution (kind `mcp` -> completions source
  `mcp`) are the token's. Any token kind works; only `read` is needed. **Origin**: `hasForeignOrigin`
  (`auth/origin.ts`) refuses a request whose `Origin` is present and not the app's own with 403
  `csrf_failed` (MCP spec, DNS rebinding); `origin.ts` leaves `/api/v1` alone, programs send no
  `Origin`, so none is required. The check sits in the handler, not in the hook, because the hook sees
  the raw path (`/api/v1/%6dcp`, a trailing slash) and SvelteKit routes the decoded one. The SDK
  1.32 implements protocol revisions up to 2025-11-25; a client that tries the stateless 2026-07-28
  revision first gets a 400 and falls back to `initialize`. OAuth (needed by the claude.ai web
  connectors) is not implemented.
- **Cost book tools** (`tools/cost-books.ts`): `list_cost_books` and `get_balances` (read; a book is given by name, slug
  or id, archived ones too - `ctx.resolveBook`), `record_settlement` (`costs:write`, `from` defaults to the token's
  user; sends a fresh idempotency key; answers with what is still open). `create_cost` takes `book` and `participants` (names, ids or `me`; they
  imply `equal`; an omitted `split` is the book's), `list_costs` and `cost_summary` take `book`, `accept_finance_suggestion`
  takes `book` and `participants`. `list_costs` rows carry `bookTaxRelevant` (only when true) and `get_balances` for one
  book says how many payments across all books it leaves out (`paymentsAcrossAllBooksLeftOut`).
- **Tools** are curated and task-oriented (`defineTool({name, title, description, mode, input,
handler})` returning `{summary, data}`; output is a summary line plus compact JSON with empty
  fields dropped). `mode` (`read|create|update|undo`) fixes the MCP annotations and the default
  scope. Only tools whose scopes the token holds are registered (stdio: after an `authMe` +
  `householdGet` handshake, HTTP: from the principal), so a read-only token sees no write tools.
- **Finance inbox tools** (`tools/finance.ts`): `list_finance_suggestions` (read), `accept_finance_suggestion`,
  `dismiss_finance_suggestion` (mode `undo`: destructive, idempotent) and `sync_finance`, the last three with the
  `costs:write` scope like their endpoints. Strictly the token user's own inbox; a sync that ends `ok: false` is a
  normal result, not a tool error.
- **Insurance and asset notes** (`tools/insurance.ts`, `tools/notes.ts`): `list_insurance_policies` and
  `get_insurance_policy` (read; a policy by id, title or policy number), `add_asset_note`, `list_asset_notes` and
  `resolve_asset_note` (the asset by id or name; resolving is idempotent). `add_service_log` takes `resolvedNoteIds`, task
  rows carry `openNotes`, and documents can be linked to a policy by its title. 74 tools when the token holds every scope (the appointment tools are `tools/appointments.ts`, see "Appointments"; `list_calendar_targets` in `tools/calendar-targets.ts` is read-only, see "Calendar sync"; the four receipt queue tools are `tools/ai-tasks.ts`, see "Receipt queue").
- **New tool**: add the endpoint to the registry first, then a ~15-line `defineTool` in
  `mcp/src/tools/` and an entry in `tools/index.ts` (which lists the planned extension points).
  Triggers go through `parseTrigger` (engine schema, per-type docs in `trigger-docs.ts`, a `Record`
  over `TriggerType` so a new trigger type must be documented).
- **Errors** become MCP tool errors `Error [code]: message` (API code, or `unreachable`);
  `complete_task`/`skip_task` send a fresh idempotency key; completions are attributed `mcp` by the
  token kind.
- **References** (`searchText` in `mcp/src/search-text.ts`; used by `resolveAsset`, `resolveVehicle`, `resolveContact`,
  `resolvePart` and `resolvePolicy`): a record is named by id, name or similar and found with the list endpoint's
  `q`, which the API limits to 100 characters. A blank reference is refused (`invalid_request`, "Nothing to look
  for: give the ..."), never matched against everything; one longer than 100 characters is searched by its first
  100 and only a hit that matches the whole reference counts (else `not_found`), so a long title is found and a
  record that merely starts alike is not taken for it.
- **Documents** (`tools/documents.ts`): `search_documents`, `get_document`, `list_document_links`, `link_document`,
  `unlink_document` go through the token user's own document connection like every other caller (no connection or a
  document that account cannot see: `not_found` with a sentence saying which; linking to a page also needs
  `docs:write`). Owners are given as id, or name for asset, room, part and contact and slug for a page; tags and
  correspondents by name or id. The files are not transferred, sending a file is not offered.
- **Vehicle tools** (`tools/vehicles.ts`): `get_vehicle` (read: details, newest reading, open tasks) and
  `record_odometer` (write: value, date, note, `force`; answers with the tasks that now need attention). A
  vehicle is given by id, name or plate (spaces, dashes and case do not matter; parts of a name or plate
  work when unambiguous); a device given by name is told apart from "no such vehicle".
  Every tool that takes an asset (`ctx.resolveAsset`) accepts a vehicle's plate as well (`lib/vehicles/plate.ts`).
  Fuel, tires and numbers: `list_fuel_logs` and `add_fuel_log` (`tools/fuel.ts`; **`costs:write`**, because a fill books a
  cost entry, so it is offered with the cost tools, not with `write`; it takes `book` like `create_cost`), `get_vehicle_stats` (`tools/vehicle-stats.ts`),
  `list_tire_sets`, `add_tire_set`, `mount_tire_set` and `record_tire_tread` (`tools/tires.ts`). A tire set is given by
  its id or by words from its season, brand, model, size or DOT (`winter`; `findTireSets` searches the vehicle's own
  sets only, so another vehicle's set is never found; an id also finds a retired set, words only active ones; several
  hits are reported with their ids).
  `record_tire_tread` without a set measures the mounted one; mounting the set that already is mounted answers normally
  and changes nothing (the tool is `update`, annotated idempotent). Amounts are decimals in the currency (`toMinor`,
  `money` and `rate` in `tools/costs.ts`; a price per litre or distance unit is a rate, `1.847 CHF/l`) and consumption
  is rounded to two decimals. `cost_summary` takes an `asset` (id, name or plate).
- **Tests** (`mcp/src/*.test.ts`, vitest) connect the real server to an in-process hauswart
  (`createInProcessFetch`) via the SDK's in-memory transport: `useMcp().connect({scopes})` returns
  `call`/`ok` helpers. Document tests also use the fake Paperless of `integrations/paperless/testing.ts`
  (`useFakePaperless()`, a test may import an adapter's harness; the core may not). The HTTP endpoint is tested through the real hook in
  `src/routes/api/v1/mcp/mcp.test.ts` (including the SDK's own HTTP client). `createInProcessFetch`
  and `createCaller` give test events an in-process `event.fetch` (`createTestEvent({fetch})`), which
  handlers that call the app need. `scripts/docker-smoke.sh` checks the endpoint on the built image.

### Installable app (PWA)

- **Parts.** `@vite-pwa/sveltekit` (pinned, `generateSW`) only generates the service worker; the rest is ours:
  the manifest route `GET /manifest.webmanifest` (`lib/pwa/manifest.ts`: standalone, `start_url`/`scope` `/`, light
  palette, icons from `static/icons`, `description` in the browser's language), registration plus update toast
  (`components/app/pwa-update.svelte`), `ThemeColor` (the `theme-color` tags follow the colour mode) and `GET /offline`
  (`csr = false`, light only like the guest pages, see `isScriptlessPath`). The three routes are public paths and
  `public` in the authz inventory. Registration needs HTTPS or localhost and does nothing in `bun dev`.
- **Caching rule: the worker never holds user data.** `lib/pwa/options.ts` (tested) is its whole behaviour. It
  precaches built static client files (`_app/immutable/**` js/css/woff2, `icons/*.png`, favicon) and the `/offline`
  page, nothing else. Navigations to app pages are `NetworkOnly` and get `/offline` only when the network fails.
  `/api`, `/g`, `/login`, `/setup`, `/offline`, `/sw.js`, the manifest, downloads and every `fetch()` are not
  intercepted at all (`isAppNavigation`; workbox copies its source into the worker, so it must stay self-contained).
  No navigation fallback (`navigateFallback: undefined`, and the key must exist: the plugin otherwise fills in `/` and
  would serve pages from the cache), no runtime cache, no `_app/version.json`.
- **Serving.** adapter-bun answers `build/client` files before the hook and without `Cache-Control`, so `bun run
build` moves `sw.js` (runtime inlined, one file) to `build/server/sw.js` (`scripts/move-service-worker.ts`) and
  `src/routes/sw.js` serves it with `no-cache`, an ETag (304) and the hook's headers. It is a 404 in `bun dev` and
  tests (`setServiceWorkerSource`). `base`/`scope` are `/` explicitly: SvelteKit's relative Vite base would register
  `sw.js` next to the current page. `scripts/docker-smoke.sh` checks manifest, worker and offline page.
- **Update flow.** `registerType: "prompt"` plus `clientsClaim`. A new worker waits until the person clicks "Reload"
  in the toast; only that tab reloads (`onNeedReload` is a no-op so the plugin does not reload every tab; `apply`
  listens for `controllerchange` itself, which also covers a page that no worker controlled when it loaded). The
  offline page's `revision` is the build time. An update check runs hourly and when the app becomes visible again
  (at most once a minute).
- **Absolute asset paths.** `kit.paths.relative` is `false` (pinned by `src/paths.test.ts`): the precached `/offline`
  page is served as the fallback on any URL, and relative `./_app/…` links would miss the cache on nested paths.
  `docker-smoke.sh` checks that the offline page links no relative assets and that every precache URL answers 200.
- **Manifest extras and meta.** `shortcuts` (add expense `/costs/quick`, submit receipt `/costs/quick?mode=receipt`, new task, record defect,
  emergency, search, in that order because Android launchers show about four; names in the browser's language), `color_scheme_dark`,
  `categories`; `format-detection: telephone=no`. No `viewport-fit=cover` and the
  status bar stays `default` (iOS 26 draws an edge blur over `cover` pages), so safe-area insets are 0 except at the
  bottom where the shell adds them explicitly.
- **No share target** (`share_target`; Chromium only, Safari ignores it): a shared file arrives as a multipart `POST` navigation to an address of the app.
  Answering it takes either (a) a server route outside `/api/v1` (say `/costs/quick/share`): `isCrossSiteWrite` (`auth/origin.ts`) would refuse the
  request, so that one path needs its own exemption and its own guard (the session cookie is SameSite=Lax, which is no substitute for the origin
  check), and the route should only park the file for the signed-in person and open the quick page to confirm it, never book anything; or (b) a
  service worker `fetch` handler for that one `POST` (which means `injectManifest` instead of `generateSW`) that keeps the file in the worker's
  storage until the page uploads it, which the rule above ("never holds user data") would have to allow as a narrow, deliberate exception.
  Neither is built.

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
  edit an existing migration, never use `drizzle-kit push`. The migrator (`migrator.ts`) runs migrations with foreign
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

## Svelte 5 and UI

Runes only: `$state`, `$derived`, `$effect`, `$props`, `{@render children()}`. No `export let`,
no `$:`, no `<slot />`, no stores for component state. Tailwind classes with `cn()` from
`$lib/utils`; no component CSS. Use shadcn-svelte components. Pages must work at 360 px width and
in dark mode. Every list has an empty state, every async action a pending and an error state.

**Phones and the installed app**:

- **Shell** (`(app)/+layout.svelte`): below `md` a bottom tab bar (`components/app/bottom-nav.svelte`; tabs in
  `nav.ts` `mobileTabs`, "More" opens the sidebar sheet) replaces the hamburger; it hides on `/new` and `/edit`
  routes and while a field that opens the keyboard has focus. `--bottom-nav` (on `:root`, `0px` unless the bar is
  shown) positions everything fixed at the bottom: always write `var(--bottom-nav, 0px)` in `calc()`. The content
  wrapper already pads for the bar plus a floating button, so pages add no bottom padding; floating "new" buttons
  use `components/app/fab.svelte`. The mobile header shows a back arrow on nested routes (`back-target.ts`, a link,
  never `history.back()`), so in-page "back to …" links are `max-md:hidden`. A navigation progress bar and an
  `invalidateAll()` after more than 60 s in the background are part of the shell.
- **Touch sizes come from the primitives**: `ui/*` add `pointer-coarse:` heights (buttons, inputs, select and menu
  items, tabs 40 px; lg 44 px; switch/checkbox hit areas). Do not hand-size plain buttons; avoid hard-coded `h-8` /
  `size-7` on things people tap. Desktop (fine pointer) keeps the compact sizes.
- **Overflow**: a long unbroken word must never widen the page. Grids get a base track (`grid-cols-1`), flex/grid
  children `min-w-0`, label/value lists `minmax(0,1fr)`, titles and values `wrap-anywhere` (`break-words` does not
  lower min-content). Inputs stay `text-base md:text-sm` (iOS zooms on focus below 16 px).
- **Dialogs and sheets** anchor to the top on phones, scroll inside `max-h-[calc(100dvh-2rem)]`, and `FormDialog`
  keeps its footer pinned. The system back gesture closes them (`lib/overlays/`, shallow routing with
  `App.PageState.overlay`); opt out with `closeOnBack={false}` (e.g. a prompt opened from `beforeNavigate`). A dialog
  that navigates afterwards uses `gotoFromOverlay` (`lib/overlays/use-overlay-history.svelte`): it pops the overlay's
  entries first (`popAll`) and navigates from the page below, so Back leads to that page with its own content. Never
  replace an overlay's entry (no `data-sveltekit-replacestate`, no `replaceState` after a pushState): a shallow entry
  shares the router's navigation index with the page below, so Back would change only the address. A click on a link
  inside an overlay gets the same treatment from the `beforeNavigate` in `useOverlayHistory` (cancel, pop, `goto`); a
  plain `goto` from an open overlay leaves its entry behind. `FormDialog`/`ConfirmDialog` give up their entry while
  their action runs. Long forms on pages get a sticky bottom save bar.
- **Information is not hover-only**: anything in `title=` that matters (exact dates, amounts) is also visible on touch.
- **Insurance and asset notes in the web app**: `/insurance` (list with a yearly total, detail, form; the form shows the
  cancellation deadline live from `lib/insurance/policy.ts`, request mapping in `lib/insurance/form.ts`) sits in the finance group
  of the sidebar, so behind "More" on phones. Asset notes live in the card with the anchor `#notes` (`components/asset-notes/`);
  `NoteChoices` is the picker for the completion and service log dialogs and `OpenNotesBadge` the count on task rows and the task
  page. After `bun run check` or `bun run i18n` restart a running `bun dev`: regenerated route nodes and message modules leave the
  dev client with a stale manifest.
- **Appointments in the web app**: `/appointments` (entry "Termine" in the overview group, behind "More" on phones; creating is a dialog, no
  `/new` route) shows `?view=upcoming|past` and `?status=planned,done,cancelled`; the load reads only `view` (it fetches `from`/`to` ranges,
  `viewRange`; the address for the sign-in redirect is read inside `untrack`, `page-load.test.ts` pins this), the status chips filter in the page from `page.url`
  without fetching again. "Over" is day-based and in the household zone (`isOver`: last day before
  today; a timed one that ends at midnight does not touch the next day). Upcoming = the last 30 days on, split by `sectionsFor` into "Noch offen"
  (planned and over: someone still has to close it, its task keeps waiting) and day groups by start day (a longer one that already started sits
  under today); past = the last 12 months, newest first, "older" loads the rest (merged by id with `appendById`: an appointment that spans the boundary is in both ranges). The detail page completes with `POST .../complete {}` and keeps
  what it answered for that page only: the task was completed, or why not (`completion: null`: archived, or the occurrence is settled); cancel
  has an undo toast, "reopen" says it does not undo the task's completion. `AppointmentFormDialog` creates, edits and prefills (`defaults`: task
  with its `occurrenceKey` (never the placeholders `none`/`s:none`), device, contact; another task sends none and the server pins what it shows); its times are wall-clock in the household zone (`zonedTimeToInstant`, never the browser's), an empty
  end sends none on create (the server's hour) and is made explicit on edit, a changed start or end sends both, and `buildUpdateBody` compares the
  wall-clock fields of each side with `draftFromAppointment` and sends a side that was not edited with its stored instant (`untouchedInstants`), so a
  start or end that falls in the repeated autumn hour (a wall-clock time cannot tell the two 02:30 apart) is not moved by editing the other side or the title. `LinkSelect` is a
  searchable combobox (task, device; contacts keep `ContactSelect`). `AppointmentsCard` (planned ones plus "create") sits on the task, device and
  contact pages; `AppointmentBadge` shows `nextAppointment` on task rows (`TaskRow` and `TaskRows` take `timeZone`; the badge is a link except
  inside `TaskRows`, whose row is one) and on the task page.
- **Vehicles in the web app**: `assets/[id]` for kind `vehicle` shows `components/vehicles/` first: `VehicleCard` (plate chip,
  odometer with the "record" dialog, details), `OdometerHistoryCard` (delete is offered for every reading; a reading that belongs to
  a completion, service log entry, fuel log entry or tire change is a 409 whose `details.source` is worded by `readingOwner`),
  `TireSetsCard` (sets with tread and age warnings, mount, measure, retire), `FuelLogCard` (anchor `#fuel-log`; consumption and
  price trends as `Sparkline`, a small SVG without a chart library) and `VehicleCostsCard` (`/assets/{id}/vehicle/stats` per year,
  links to `/costs?asset=`). The asset form takes the vehicle details (`PUT /assets/{id}/vehicle` after the asset; vehicles have no
  room picker).
- **Calendar sync in the web app**: the card `components/calendar-sync/targets-card.svelte` sits on `/settings/calendar` (tab "Kalender", below the
  iCal subscriptions; the Home Assistant card links to `#calendar-targets`). The load reads `GET /calendar-targets` and `GET /integrations`. Everybody
  sees the household's targets; only `canManage` ones get the switch, "Jetzt synchronisieren", edit and delete, and "add" needs a working connection of a
  system the person may add calendars of (`creatableProviders`: the household's connection means administrators). A target's state is
  `targetState` (paused, offline = its connection is not active, error, waiting, ok); codes go through `integrationErrorMessage(code, provider)`, which
  words the calendar codes too (`calendar_missing`, `unsupported`, `unconfirmed`, `config_invalid`, and the run-only `busy`, `disabled`, `no_connection`,
  `provider_unavailable`). A sync that ends `ok: false` is shown inline as a result, never as a crash; counts (`statLines`) are the target's `lastStats`, which
  a run that failed before it counted anything sets to null (it no longer keeps those of the run before it). A new target is looked at again every 3 s
  (ten times) so its first run shows. The dialog never shows or sends `direction` and `conflictPolicy`, lists the calendars of
  `GET /integrations/{provider}/calendars` with their capabilities (calendars that cannot create or already have a target are disabled, the 400 on
  `remoteCalendarId` (by its `details.code`, the two causes in their own words) and the 409 are worded on that field), sends only the fields that differ on PATCH (`updateBody`) and offers a reminder only when
  `capabilities.alarms`. Deleting offers "Einträge im Kalender ebenfalls entfernen" (`?removeRemote=true`) only with `capabilities.delete`; a 409 (connection
  off, or `busy`) or 502 (`details.code`, with counts and `disabled` once it began) is worded by `deleteFailure` and the target stays (then paused, and
  the list behind the dialog is reloaded to show it). `ConfirmDialog` takes optional content (`children`).
- **Odometer readings in forms**: `VehicleReading` (`lib/vehicles/odometer-state.svelte.ts`) loads a vehicle's unit and newest
  reading for a dialog and `OdometerReadingField` prefills it; an unchanged or empty field sends no reading. A task that counts on the
  odometer asks for it when completed: `CompleteButton` asks `odometerAssetOf(task)` (the dashboard's `odometerAssetId`, else the
  trigger; only a task that has neither is fetched, and a failed lookup completes plainly) and opens `CompleteOdometerDialog`, whose
  reading goes along as `counterValue`; the "with note" dialog has the same field. Odometer fields read "95.000", "95,000" and
  "95'000" as 95000 (`parseOdometerValue`), amounts, litres and millimetres keep their decimals (`parseDecimalInput`). Limits in
  messages go through `formatNumber`, never `toLocaleString("en")`. A refused reading is recognised by `refusedReading(err, field)`
  (`lib/vehicles/odometer-error.ts`) from `details.code` and `details.reading` (`odometerRefusalDetailsSchema`), never from the
  English message, and `refusedMessage` names the reading in the way for `lower_than_previous` and `higher_than_next`. Only the record
  dialog (`POST /assets/{id}/odometer`) can send `force`, so only it offers "save anyway", for both codes; the other forms
  (completion, fuel log, tire mount and tread, service log) show the explanation.
- **Tire change offer**: `completeTask` hands the task the server answers with to `tireOffers` (`lib/vehicles/tire-offer.svelte.ts`);
  if `tireChange(task)` (`tire-task.ts`) says it is a tire change, `TireMountOffer` (in the app layout) offers to mount a set. The
  template mark decides (`tires_winter` / `tires_summer`, any other template never offers); an unmarked task is judged by its title
  ("Reifenwechsel", "Radwechsel", "Winterreifen aufziehen", ...). The mount dialogs take the mounted set's `mountedOn` as the minimum
  date (`mountedSince`) and word the server's 400 on `date`.
- **Setting up a vehicle's tasks**: "Termine einrichten" (`lib/vehicles/setup.ts`, `vehicle-setup-dialog.svelte`) creates the
  templates of `lib/vehicles/templates.ts` through the API, task first, then its preparations, each template with its own progress
  and error. Every template task carries the mark `externalSource: "vehicle_template"`, `externalRef: "<asset id>:<template id>"`
  (`lib/vehicles/template-mark.ts`); the server keeps that pair unique, so on a 409 the task that holds the mark is read (`GET /tasks` with `externalSource`,
  `externalRef` and `includeArchived`, the client's `findMarked`): archived, finished (a one-off that was completed or skipped) or
  moved to another device means the vehicle had the template before, and the creation retries with `:<n>` appended; a task that is
  still there means none is made and the template shows "already there" (`TemplateRun.state` `exists`, the page reloads); a holder
  that is gone by now gets the same mark again. `findExistingTask` finds what a vehicle has already by the mark, and only
  a task without a readable mark by likeness (title in either language, odometer counter, an inspection on a date), so nothing is
  offered twice. A mark is readable (`templateOfMark`) when it names one of `VEHICLE_TEMPLATE_IDS` (defined in `template-mark.ts`,
  re-exported by `templates.ts`); one that names another template counts as unreadable here and in the tire change offer. A new vehicle opens that dialog once through `?termine=1`.
- **Costs of a vehicle**: `/costs?asset=` passes the device on to the summary (`costsSummaryQuery`; no other filter narrows its
  totals) and says so above it. A cost entry with `fuelLogId` has its amount, currency, date and device locked in the form (never sent by
  `buildUpdateBody`) with a link to `#fuel-log`, and the detail page offers that link instead of delete; a 409 with
  `details.fuelLogId` that still arrives is worded (`fuelLogOfConflict`).
- **Costs in the web app** (books, balances, settlements): the address carries the book, `/costs?book=<id>|all`. The address wins; without
  one the book the person looked at last applies (localStorage `hauswart:cost-book:<user id>`, `book-memory.ts`, written by an effect once the
  address names a book). `chooseBook` (`lib/costs/books.ts`) decides in the load, which `redirect(307)`s to the explicit address (on a hard
  reload that is a native navigation, SvelteKit's own rule for a redirect that only the browser can make); an address that narrows by device,
  room, search ... (`narrowsBeyondBook`) ignores the memory, so `/costs?asset=` still shows that device's costs. `book` goes to the list,
  summary, CSV and balances (`costsQuery`, `costsSummaryQuery`, `costsExportQuery`, `balancesQuery`). `BookSwitcher` is a row of links (a
  scrolling row on phones that keeps the book on screen in view), the second summary card is the running balance (`BalanceOverview`, from
  `GET /costs/balances`; the year's settlement of the summary is no longer shown, it ignores recorded payments). `/costs/balances` is the Saldo
  page: balance per person with paid / share / payments sent / received, suggested payments with "Als bezahlt erfassen" (opens
  `SettlementDialog` prefilled by `draftFromSuggestion`: book = the one on screen or all books, so the person only confirms or edits), a
  dismissible note "settled before?" while no payment was ever recorded, and the recorded payments (year and person filters, edit, delete).
  Balances are worded, never signed (`balanceWording`, `youWording`, `viewerLine`: "bekommt" / "schuldet"). Books are managed under
  `/settings/cost-books` (create, edit, icon, default split, tax relevant, move, archive, restore, delete; a 409 is worded from `details`
  by `bookConflictMessage`), "new book" is also a chip on the costs page. The cost form picks the book first (`BookPicker`: buttons up to
  four books, else a select); a new entry takes the book's default split until the person chose a split (`withBook`, `splitAfterBook`); "Für wen"
  are member checkboxes of an equal split (`participants`, sent as `participantIds` only when narrowed, and a PATCH sends `splitMode: "equal"`
  again when the set changed); the tax class is only offered, and sent, for a tax relevant book (`taxClassApplies`). The inbox's accept dialog
  has the same picker and checkboxes. The dashboard's `CostsCard` reads `dashboard.balances` ("Du bekommst / Du schuldest" across all books, the first three payments and how many more there are, no request of its own; `null` shows "Der Saldo konnte nicht geladen werden." under the year's costs) and labels the year total "Ausgaben 2026, alle Bücher" with the per-book list of `costsYearToDate.byBook` under it;
  `tryLoadBalances` lets a page open when only the balances fail (the card says so).
  `chooseBook` never hands on an id the server would 404 on; a remembered book that was deleted comes back as `staleMemory`, and the loads forget it (`forgetBook`).
  The single-book balance cards and the Saldo page name the payments across all books they leave out (`crossBookNote`, from `crossBookSettlements`). The tax card measures its rows against
  the sum of `byDeductible` (`taxTotal`, tax relevant books only), not against the year's expenses. The "Für wen" preview of an equal split divides the basis points first and the amount by those (`equalPreview`),
  so it shows what the server books (300.00 among three: 100.02, 99.99, 99.99). Under `/settings/cost-books` a book that takes entries gets "Als Standard festlegen" (`isDefault`; the badge follows it, reordering never moves it).
  Reordering (rooms, books, hints) goes through `lib/reorder.ts`: `saveOrder` waits for every request, a failed one included, then refreshes, so the order shown is the server's.
  **Moving entries**: "Auswählen" on the list (checkboxes in the cards and the table, a sticky bar with the count, at most 500) and, on a list narrowed to a device, "Alle Einträge dieses Geräts verschieben"
  open `MoveCostsDialog` (`POST /costs/move-to-book`; `moveSummary` words moved / unchanged / tax class reset, `moveFailure` the 400s; for a device it first asks a dry run for the chosen book, again whenever the book changes, and shows `movePreview` above the buttons - a failed preview is worded and does not block the move). **Vehicles**: the asset form's "Kostenbuch" picks `costBookId` (every save sends it, a PUT would clear it),
  `VehicleCard` names the book, the fuel dialog offers a book (the vehicle's while it takes entries, else the default; a new fill takes that book's split; no "Für wen", the fuel API has no participants) and the list shows each fill's `bookName`.
- **Quick entry, receipts and the review flag in the web app**: `/costs/quick` is for one hand on a phone (no bottom bar, a sticky save bar of its
  own; the costs page's round button leads there, the dashboard's costs card and the home screen shortcuts too; `?book=` names the book, `?mode=receipt`
  opens on the receipt). The load reads nothing from the address (`untrack`), so the mode switch and `?book` fetch nothing again. **Expense**: a big
  amount field (`inputmode="decimal"`, the household currency, "12." and "12,5" read as typed), book chips (`chooseQuickBook`: the address, then the
  book of the last quick entry - `loadQuickBook`, kept apart from the costs page's remembered book -, then that one, then the default; up to five
  open books as chips, else a select), category chips ranked by `rankCategories` (the book's recent entries first, then all recent entries, then a
  fixed order, the apartment's for a tax relevant book; the form asks `GET /costs/recent-categories` once it is on screen - `loadRecentCategories`, not part of the page load,
  and the chips keep their fixed order without it or once a category was picked), eight
  shown and "more" for the rest, none chosen at the start; payer chips (default me); "für wen" chips: as the book has them (everybody, nobody for a
  book that does not share) sends no split so the book's own applies, any other choice is `equal` among the ticked (`quickSplit`). **Nobody ticked is not guessed**: in a book that shares it is `unchosen`
  (a warning under the chips, the save refused with an error on `participants`) until the person ticks somebody or taps the chip "Nicht teilen" (`notShared`, which
  sends `none`; ticking a person ends it); in a book that does not share, nobody ticked is the book's own "not shared" and the chip is on. A sentence under the
  chips says what the chips mean. Date, payee, title (empty = payee, else the category) and device sit behind "Datum, Titel und
  mehr" (an error on any of them opens the section, `needsMoreSection`, and the device shows its error like the others). `POST /costs`, then `uploadAttachment` (owner `cost`): done = `/costs?book=` plus a 10 s toast with "Rückgängig" (`DELETE`) and "Noch eine";
  a failed upload keeps the entry and offers retry, "ohne Beleg fertig" and undo. **Every draft has a key** (`newIdempotencyKey()`,
  `lib/idempotency.ts`; sent as `idempotencyKey` with `POST /costs` and `POST /ai-tasks`): a save that got no answer is simply tried again with
  the same key (the words say so: the entry is not booked twice), the key is renewed after the entry is booked and when the server answers
  409 (the key stands for another entry: "look in the list"), and the receipt's key also when another photo is picked; the receipt's
  network error says that nothing is booked and links to `/costs/receipts`. Mistakes are cleared as the field changes. **Receipt**: `ReceiptPicker` (camera button
  with `capture="environment"` only on touch, in CSS so hydration does not move the page; any image or PDF in the file picker). A HEIC photo is
  turned into a JPEG through a canvas where the browser decodes it (`prepareReceiptFile`, Safari; the decision `heicPlan` is tested, the canvas is
  not) and refused with the server's `attach_error_heic` wording otherwise. **Receipt only** (`POST /ai-tasks`, multipart, optional note, book and
  device hints) ends on the page `/costs/receipts` with a toast offering undo (`DELETE /ai-tasks/{id}`): open tasks are always read completely and
  listed first (`mergePendingFirst`), the history comes 30 at a time ("Mehr laden"), `?status=` filters; each row shows the thumbnail (the lightbox
  for pictures, a new tab for a PDF), uploader, note, hints, for a done task the booked entries as links with their "Zu prüfen" mark, for a dismissed one the
  reason; anybody may dismiss (reason optional, final), deleting is for the uploader and administrators (`canDeleteTask`). The wording says receipts are
  "über die MCP-Verbindung verbucht". **Review flag**: `CostFlags` shows "Zu prüfen", the detail page a notice with the button "Als geprüft markieren" (`POST /costs/{id}/review`; "Geprüft" stays the word for an entry that was reviewed)
  and who reviewed when, the costs page a "Zu prüfen" chip (`?review=1`; `?year=all` lists every year and is only honoured with the review filter,
  because that list is short), a notice under the summary that links to the entries it counts (`reviewFilters`) and the dashboard a card for
  `reviewNeededCount` that opens `REVIEW_ALL_HREF` (every book and year).
- **After a dialog, refresh with `invalidateAfterOverlay`** (`lib/overlays/use-overlay-history.svelte.ts`): closing a dialog pops its history
  entry, and the router drops an `invalidateAll()` that is still loading when that popstate arrives, so the page kept the old data. It waits
  for the entry to be gone first (`OverlayHistory.settled`); a dialog that navigates uses `gotoFromOverlay`. Menu items that start
  an action with `onclick` do not disable themselves while it runs: bits-ui checks `disabled` after `onclick`, so the
  item no longer selects, the menu does not close and the page stays locked. Items that use `onSelect` are fine (the
  check comes before it runs).

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
