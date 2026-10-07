# Changelog

## Unreleased

### Added

- Self-service password change: everybody can set a new password under Settings > Account, or with
  `POST /api/v1/me/password` (browser session only; the current password is required). The new password
  follows the rules of the first-run setup and must differ from the current one. A wrong current password
  counts against the same failed-attempt limit as signing in. Your other browsers and devices are signed
  out, the one you changed it in stays. API tokens stay valid, unlike after an administrator's reset: they
  are credentials you made on purpose, revoke them under Settings > API tokens if the password changed
  because of a leak. The change is recorded as the security event `password_changed`.
- Settings, Integrations: a Kept card to connect, test (missing token permissions are listed), choose
  the categories and what happens with them, switch bill tasks on (visible to the whole household), and
  sync now.
- Costs in the web interface (replacing the placeholder page): a year view with the expense total, equity,
  the settlement of who owes whom and a report by month, category, device and tax treatment, a list with
  search and filters, a CSV download, adding, editing and deleting entries (amount in minor units, refunds,
  split by ownership, equally, custom percentages or not at all, expense flag, tax treatment, links to a
  device, room, defect and service log entry), a detail page with the frozen shares, receipts and
  comments, and the finance inbox: accept a suggestion as it is or adjust it first, dismiss it, and sync
  now.

### Fixed

- Uploads through the API with a bearer token no longer need an `Origin` header. SvelteKit's built-in form
  check rejected them (403) before the API could tell a token from a browser session; it is switched off
  and the server now refuses cross-site writes itself: for cookie-authenticated API requests as before,
  and for everything outside `/api/v1` (the guest PIN form and any other form) in the request hook,
  whatever the content type.
- The PIN form on guest pages was refused with 403 in browsers: guest pages send no referrer, so browsers
  post the form with `Origin: null`. It is accepted now when the browser reports the request as
  same-origin (`Sec-Fetch-Site`); posts from other sites are still refused.

## 0.1.0

First early release. hauswart is in early development: the core works and is well tested, but this
is not a stable release. Expect breaking changes (API, data model, configuration) between versions,
and read this file before every update. **Back up `/data` before you upgrade**; database migrations
run automatically at start and cannot be undone.

### Added

- Tasks and the due-date engine: recurring maintenance tasks with completion tracking and an audit of
  who did what. Triggers: fixed intervals (from completion or from a schedule, optionally by season),
  calendar rules (weekly, monthly, yearly, "last Friday of the month"), a minimum number of times per
  week, month, quarter or year, counters (for example operating hours since the last service), state
  conditions with a duration, collection dates from Home Assistant calendars, one-off dates, and
  system triggers for warranty ends and bills. Preparations (such as "order the filter" three weeks
  ahead, skipped while the part is in stock), rotation between people (alternating, or fair by effort),
  estimated dates from sensor readings, snooze, skip and undo within seven days.
- Dashboard and notifications: overdue, today, this week and later, with in-app notifications per stage
  (preparation, due soon, due, overdue, a daily digest), per-person preferences and quiet hours.
- Rooms, inventory, plants and QR codes: devices, plants and fixtures with photos, rooms, archive and
  restore, QR codes that open a device's page on a phone (print one, or an A4 sheet per room or for the whole
  inventory), where tasks can be completed on the spot.
- Care hints per device (tips, rules, warnings), pinned or ordered, with an optional reaction to a
  reading from Home Assistant.
- Contacts (with a role per device), spare parts with stock, orders and an "order now" list that
  accounts for lead time, and a service log per device. Completing a task books the used parts out of
  stock.
- Defects ("Mängel") with a status workflow, a deadline counted from the handover date with a reminder
  task, a timeline of status changes, correspondence and comments, and a PDF export.
- Warranty overview with valid, expiring (within 90 days) and expired states.
- Comments on tasks, devices, defects, rooms, parts, contacts, service log entries, hints, pages and
  costs, with notifications for the other members.
- Documentation wiki: Markdown pages with callouts, a table of contents, revisions (the last 50),
  backlinks (`[[page]]`) and "secret" blocks that guests, the search index and guest links never see.
  Attachments (JPEG, PNG, WebP and PDF; images are re-encoded without metadata and get a thumbnail)
  on pages, devices, rooms, tasks, defects, service log entries, parts, hints, contacts and costs.
  Full-text search over pages, devices, rooms, tasks, defects, contacts, parts and hints (Ctrl+K).
- iCal feeds: a secret subscription address per feed with due tasks, preparations, defect deadlines and
  warranty ends, estimated dates on request, and optional alarms.
- Emergency sheet and guest links: the "Notfall- & Vertretungsblatt" as a PDF, and guest links for
  visitors or a stand-in with a PIN, an expiry (at most 90 days), a start date and a choice of
  sections. Guest pages need no sign-in and no JavaScript.
- Home Assistant adapter (household-wide, administrators only): reads counters and states, collection
  dates from calendars and registry devices, completes tasks automatically when a counter resets or a
  state changes, reacts to state changes with a hint notification, and sends push notifications through
  `notify` services with a "Done" button that marks the task as done (a one-time token per
  notification; the Home Assistant package to receive the tap is shown in the settings).
- Paperless-ngx document provider, connected per person with their own account: link documents to
  devices, tasks, defects and other entities, previews and downloads, warranty dates read from custom
  fields, suggestions for receipts and correspondents, pushing an attachment to Paperless, and a note
  written back. Through the REST API only so far, see "Known limitations".
- Costs: expenses and refunds with categories, a split between the people by ownership share, equal or
  custom (shares are frozen per entry), a year summary, the settlement of who owes whom, a tax class for
  maintenance versus value-adding work, receipts and a CSV export. Through the REST API and MCP only so
  far.
- Kept finance provider, connected per person: transactions and paid invoices become cost suggestions in
  a private inbox, open bills become tasks, and booked costs link back to Kept. Through the REST API only
  so far.
- REST API under `/api/v1`, the same one the web interface uses, with scoped bearer tokens (`read`,
  `write`, `docs:write`, `costs:write`, `ha:action`, `admin`) and an OpenAPI 3.1 description at
  `/api/v1/openapi.json` (also `docs/openapi.json`).
- MCP server for Claude and other MCP clients (`mcp/`, 39 tools when the token holds every scope) that
  only offers the tools a token's scopes allow. Compiled binaries for Linux, macOS and Windows are
  attached to the release.
- Security: argon2id passwords, sessions and API tokens stored hashed, stored credentials encrypted with
  `HAUSWART_SECRET_KEY`, a content security policy with nonces and the usual security headers, `Origin`
  checks on cookie-authenticated requests, rate limits for sign-in, tokens and public endpoints, and a
  host policy for what the server may connect to (an allow-list of hosts for members' integrations; link-local
  and cloud metadata addresses are always refused).
- Interface in German and English (per person), light and dark mode, usable from 360 px wide.
- Backups: a daily consistent copy of the database (the newest 14 are kept) and a mirror of the uploaded
  files, written to `HAUSWART_BACKUP_DIR`.
- Docker image `ghcr.io/orellbuehler/hauswart` (Bun on Alpine, linux/amd64, runs as user 1001, data in
  `/data`, health check on `/api/health`), tagged with the version, `major.minor` and `latest`.

### Known limitations

- No two-factor sign-in or passkeys yet, no recovery codes and no self-service password change: an
  administrator resets passwords. There is no e-mail at all, so no password reset by mail.
- Push notifications go through Home Assistant only. Without it, notifications exist in the app, not
  outside it.
- Costs have no web interface yet (the page is a placeholder). Use the REST API, the MCP server or the
  CSV export. Paperless-ngx and Kept are connected and used through the REST API only: their settings
  cards in the web interface show a status, not a form.
- No native mobile app and no installable web app (PWA). The API is ready for one; the web interface
  works on a phone.
- One household per installation, and one instance only: the database is SQLite, and rate limits and a
  few caches are kept in memory. Running several instances against the same data is not supported.
- Uploads accept JPEG, PNG, WebP and PDF up to 25 MiB. HEIC (the iPhone default) is rejected, export a
  JPEG instead; so are SVG, GIF and HTML.
- Uploads through the API with a bearer token must send an `Origin` header equal to the server's own
  address (SvelteKit's form check); without it the server answers 403. Browsers always send it.
- Guest pages are light mode only and have no interactivity beyond the PIN form.
- The host check for integrations repeats before every request but does not pin the connection to the
  checked address, so a DNS rebinding attack between check and request is not closed. Run hauswart
  where members cannot reach internal services you care about, or leave the allow-list empty.
- The image is built for linux/amd64 only (no arm64 yet).
- Whole-database export and import do not exist apart from the backups, the costs CSV and the PDFs.
  There is no way to go back to an older version except restoring a backup.
- The MCP server cannot upload or download files and deletes nothing.
