---
paths:
  - "mcp/**"
  - "src/lib/server/api/handlers/mcp.ts"
  - "src/lib/api/schemas/mcp.ts"
  - "src/routes/api/v1/mcp/**"
---

# MCP server

`mcp/` holds the MCP server for Claude (Claude Code, Desktop) built on `@modelcontextprotocol/sdk` with
Zod 4 input shapes. hauswart serves it itself over HTTP (`POST /api/v1/mcp`, below); `bun run mcp` runs
the same tools over stdio from source for development (no compiled binaries). It is a REST client like
the others: `createApiClient(fetch, baseUrl, {token})` from `src/lib/api`, so endpoint and schema
changes break its build. It imports only client-safe modules (`src/lib/api/**`,
`src/lib/tasks/engine/types`, `src/lib/dates`; a test bundles the stdio entry, which pulls in the whole
server, and fails on any `src/lib/server`, `src/routes` or `src/lib/testing` input). `#lib` aliases
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
- **Tags, budgets and recurring costs** (`tools/cost-tags.ts`, `cost-budgets.ts`, `cost-recurrences.ts`, all read-only): `list_cost_tags`, `get_budget_status` (`year`, `month`; the
  most used budgets first, amounts as decimals) and `list_cost_recurrences` (`active`; the schedule in words, `problem` when a booking failed). A tag is given by name or id
  (`ctx.resolveTag`; an unknown one is an error listing the known ones, never a new tag): `create_cost`, `accept_finance_suggestion` take `tags`, `list_costs` and
  `cost_summary` take `tag`; cost rows carry `tags` and, unless manual, `source`. Link suggestions show as `kind: link` with the transaction and the entry.
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
  rows carry `openNotes`, and documents can be linked to a policy by its title. 77 tools when the token holds every scope (the appointment tools are `tools/appointments.ts`, see "Appointments"; `list_calendar_targets` in `tools/calendar-targets.ts` is read-only, see "Calendar sync"; the four receipt queue tools are `tools/ai-tasks.ts`, see "Receipt queue").
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
