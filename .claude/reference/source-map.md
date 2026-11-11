# Source map

Where things live, file by file. `CLAUDE.md` has the short version; the behaviour of each domain is in
`.claude/rules/`.

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
src/lib/server/docs/markdown*.ts markdown -> sanitized html; async variants run marked in a worker (see `auth-api.md`)
src/lib/server/docs/pages.ts     documentation pages: CRUD, rev concurrency, revisions, backlinks, cached renderings
src/lib/server/docs/render.ts    page rendering for members/guests, link resolution, `{token}` placeholder
src/lib/server/files/            content-addressed file store, image pipeline, sniffing, serving headers (see `docs-attachments-search-backup.md`); preview.ts: the smaller copy of an
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
                                 balances), settlements.ts (recorded payments), csv.ts, totals.ts (cost sums on defects and service log entries),
                                 tags.ts, budgets.ts, recurrences.ts + recurrence-scheduler.ts (recurring costs; see "Tags, budgets and recurring costs")
src/lib/server/ai-tasks/         the receipt queue: ai-tasks.ts (upload, list, count, complete, dismiss, claim, delete), booking.ts (booking for a task and the lease: a leaf
                                 module the cost service imports), preview.ts (the task's file sized for an assistant);
                                 see "Receipt queue"
src/lib/server/finance/          generic finance-provider seam: providers.ts (registry), suggestions.ts (the private inbox, accept,
                                 dismiss), bill-tasks.ts (tasks that follow bills), store.ts + links.ts (leaf modules: suggestion rows, ties between
                                 entries and transactions; the cost service imports them), events.ts (see "Matching with entries made by hand")
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
src/lib/costs/                   client-safe: recurrence.ts (the rule of a recurring cost, pure), budget.ts (budget periods and usage, pure), match.ts (the
                                 matching rule of a transaction and an entry, pure), names.ts (`nameKey`, how names of tags and books are compared); client-safe UI logic of the costs pages: books.ts (book choice, icons), book-memory.ts, filters.ts, form.ts (draft ->
                                 request bodies), balances.ts (wording), settlements.ts (drafts, bodies, filters), load.ts, quick.ts (category ranking,
                                 chips -> split, quick draft -> bodies), receipts.ts (queue page helpers), tags.ts (colours, choosing, names), budgets.ts
                                 (view, display, form), recurrences.ts (rule wording, preview, drafts, bodies), recurrence-controls.svelte.ts (pause, resume, book now),
                                 matches.ts (what the form asks the bank for); see "Costs in the web app", "Quick entry, receipts and the review flag in the web app" and "Tags, budgets, recurring costs and bank matching in the web app"
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
