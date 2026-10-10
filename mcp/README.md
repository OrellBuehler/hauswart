# hauswart MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets Claude (Claude Code,
Claude Desktop, any MCP client) query and operate hauswart. hauswart serves it itself at
`/api/v1/mcp` (Streamable HTTP), so there is nothing to install next to Claude: you add the address
and a token. The tools call hauswart's REST API (`/api/v1`) with that token, through the same typed
client and endpoint registry as the web app (`src/lib/api`), so a contract change breaks the build
here too.

## Setup

1. In hauswart open **Settings → API tokens**, create a token of kind **MCP server** and choose
   the scopes:
   - `read`: Claude can look things up (upcoming tasks, tasks, assets, documentation pages,
     defects, spare parts, contacts, comments, warranties, statistics, notifications, vehicles with
     their fuel log, tire sets and statistics, the archived documents of your own document system)
     and search across all of it.
   - `write` (in addition): Claude can also create and change tasks and assets, mark tasks done,
     skip, snooze and undo, report defects and change their status, book spare-part stock, comment,
     log service work and link archived documents to devices, rooms and more. Without it the write tools are not even offered.
   - `docs:write` (in addition): Claude can create and edit documentation pages.
   - `costs:write` (in addition): Claude can book costs and fill-ups (the fuel log books a cost entry).

   The token is shown once. Completions made through it are recorded as coming from `mcp`, under
   the token owner's name (a token of another kind works too, but its completions are recorded
   under that kind).

2. Register the server with your client. The address is your hauswart address plus `/api/v1/mcp`.

### Claude Code

```bash
claude mcp add --transport http hauswart https://hauswart.example.org/api/v1/mcp \
  --header "Authorization: Bearer hw_xxxxxxxx"
```

Add `--scope user` to make it available in every project (the default is the current project,
stored in your local settings). `claude mcp list` shows whether it connects.

### Claude Desktop

The connectors in Claude Desktop's settings sign in with OAuth (see below), so a token goes through
a small bridge that starts locally, [`mcp-remote`](https://github.com/geelen/mcp-remote) (needs
Node.js). In `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "hauswart": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://hauswart.example.org/api/v1/mcp",
        "--header",
        "Authorization:${HAUSWART_AUTH}"
      ],
      "env": { "HAUSWART_AUTH": "Bearer hw_xxxxxxxx" }
    }
  }
}
```

The header is built from an environment variable because Claude Desktop on Windows mangles spaces
in arguments. For an address that is plain `http://` (a home network without TLS) add
`"--allow-http"` to the arguments. Restart Claude Desktop afterwards.

### claude.ai and other connectors that sign in with OAuth

The custom connectors of claude.ai (web, mobile) authenticate with OAuth. hauswart does not
implement that yet: it only takes a bearer token (`Authorization: Bearer hw_…`), which those
connectors cannot send. Use Claude Code or Claude Desktop for now.

### Check it

```bash
curl -sS https://hauswart.example.org/api/v1/mcp \
  -H "Authorization: Bearer hw_xxxxxxxx" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

lists the tools your token's scopes allow. Scopes are read on every request, so a token whose
scopes changed offers the new tools as soon as the client asks again (most clients ask when they
connect: restart or reconnect the client).

## How it works

- **Stateless.** Every POST carries one JSON-RPC message and is answered on its own with
  `application/json`; a notification gets `202` and no body. There is no session
  (`Mcp-Session-Id` is not used) and no event stream, so GET and DELETE answer `405`. Each request
  builds its own server with the tools the token's scopes allow, which is why nothing has to be
  kept between requests or shared between instances. The server speaks the protocol revisions
  `2024-11-05` to `2025-11-25` that the SDK implements; a client that tries a newer revision first
  gets a `400` and falls back to `initialize`.
- **Bearer tokens only.** A missing, unknown, expired or revoked token is `401` with
  `WWW-Authenticate: Bearer`; the session cookie is never accepted (`403`); a token without
  `read` is `403`.
- **Origin.** Browsers send an `Origin` header, MCP clients do not. A request that carries one
  other than hauswart's own is refused with `403 csrf_failed` (the MCP specification requires this
  against DNS rebinding), so a web page cannot use the endpoint, even with a token.
- **The tools use the REST API.** They call it with the caller's token through the application's
  own request handling (no network hop), so scopes, the rate limit (300 requests a minute per
  token, the tool calls count as well as the MCP requests) and the attribution of completions are
  the token's.
- **Limits.** A request body is at most 512 KB. Behind a reverse proxy set `ORIGIN` to the public
  address (as for the rest of hauswart); responses are plain JSON, so no special buffering
  settings are needed.
- Errors of a tool come back as MCP tool errors (below); errors of the transport (`406` without
  `Accept: application/json, text/event-stream`, `415`, `400`) use hauswart's usual error
  envelope.

## Tools

Results are a one-line summary followed by compact JSON (empty fields left out). Dates are
`YYYY-MM-DD` in the household's time zone. Errors come back as MCP tool errors in the form
`Error [code]: message` with the API's error code (`not_found`, `invalid_request`, `forbidden`,
`unauthenticated`, …), or `unreachable` when hauswart cannot be reached.

| Tool                         | Scope       | What it does                                                                                                                                               |
| ---------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `whoami`                     | read        | Token user, scopes, household, today's date                                                                                                                |
| `list_upcoming`              | read        | Overdue / today / this week / later / sensor-based tasks, due preparations, open defects, expiring warranties, parts to order; `mine`, `horizon`           |
| `list_tasks`                 | read        | Filter by status, category, room, asset, assignee, text; paged                                                                                             |
| `get_task`                   | read        | One task: trigger, state, preparations, recent completions                                                                                                 |
| `preview_trigger`            | read        | Check a trigger and see its first due date without creating anything                                                                                       |
| `list_rooms`                 | read        | Rooms with ids                                                                                                                                             |
| `list_assets`                | read        | Devices, plants, fixtures, vehicles; filter by kind, room, text; paged                                                                                     |
| `get_asset`                  | read        | One asset in full, with its tasks                                                                                                                          |
| `get_stats`                  | read        | Done / skipped / on time per person and category                                                                                                           |
| `list_notifications`         | read        | The token user's notifications as readable text                                                                                                            |
| `create_task`                | write       | New task; the trigger is validated with the engine's schema and documented in the tool                                                                     |
| `update_task`                | write       | Change fields, replace the trigger, archive or restore                                                                                                     |
| `complete_task`              | write       | Mark done (optionally backdated, with a note); returns the next due date                                                                                   |
| `skip_task`                  | write       | Skip the current occurrence                                                                                                                                |
| `snooze_task`                | write       | Hide a task until a date, or end a snooze                                                                                                                  |
| `undo_completion`            | write       | Revoke a completion or skip (within 7 days)                                                                                                                |
| `create_asset`               | write       | New device, plant or fixture                                                                                                                               |
| `update_asset`               | write       | Change fields, archive or restore                                                                                                                          |
| `search`                     | read        | Full-text search over pages, assets, rooms, tasks, defects, contacts, parts and hints; linked documents by title                                           |
| `list_pages`                 | read        | Documentation pages: filter by section, asset, room, text; paged                                                                                           |
| `get_page`                   | read        | One page: markdown (secret blocks included), `rev`, backlinks, attached file names                                                                         |
| `list_defects`               | read        | Defects: active (default), all or one status; filter by severity, room, asset, text; paged                                                                 |
| `get_defect`                 | read        | One defect with its timeline (status changes, correspondence, comments) and attachment names                                                               |
| `list_parts`                 | read        | Spare parts with stock and orders; filter by text, asset, low stock; `orderNow` = shopping list                                                            |
| `list_contacts`              | read        | Contacts; filter by kind, emergency, text                                                                                                                  |
| `get_contact`                | read        | One contact in full, by id or name                                                                                                                         |
| `list_comments`              | read        | The comment thread of a task, defect, asset, room, part, contact, log entry, hint or page                                                                  |
| `search_documents`           | read        | Documents of your own document system (Paperless-ngx): live title and text search, or the synced household documents; filter by tag, correspondent, linked |
| `get_document`               | read        | One document: date, correspondent, tags, warranty dates, its address in the document system and where it is linked                                         |
| `list_document_links`        | read        | The documents linked to an asset, room, page, task, defect, part, contact or cost entry, or where one document is used                                     |
| `list_hints`                 | read        | Care hints (tips, rules, warnings) of assets                                                                                                               |
| `list_warranties`            | read        | Warranty status per asset, soonest to expire first                                                                                                         |
| `list_insurance_policies`    | read        | Insurance policies by cancellation deadline; filter by asset, type, text, archived; premium normalised to a year                                           |
| `get_insurance_policy`       | read        | One policy in full, by id, title or policy number: insurer, term, deductible, assistance line, covered assets, attached files                              |
| `list_asset_notes`           | read        | The issues noted on an asset to mention at its next appointment (open, resolved or all)                                                                    |
| `list_costs`                 | read        | Cost entries (repairs, utilities, purchases, mortgage ...); filter by year, category, asset, room, payer, text; paged                                      |
| `cost_summary`               | read        | A year's costs, also of one asset: total, per category and month, top assets, tax classes, and who owes whom                                               |
| `create_defect`              | write       | Report a defect (room, asset and responsible contact by name)                                                                                              |
| `set_defect_status`          | write       | Move a defect to reported, in progress, fixed, rejected or back to open, with a note                                                                       |
| `adjust_stock`               | write       | Book a stock movement for a part: used, bought or a correction                                                                                             |
| `add_comment`                | write       | Comment on a task, defect, asset, room, part, contact, log entry, hint or page                                                                             |
| `add_service_log`            | write       | Log maintenance, repair or other work on an asset, with contact, cost and the notes it addressed                                                           |
| `add_asset_note`             | write       | Note a small issue on an asset ("brakes squeak") for the next appointment; the asset by name                                                               |
| `resolve_asset_note`         | write       | Mark a note as resolved                                                                                                                                    |
| `link_document`              | write       | Link an archived document to an asset, room, page, task, defect, part, contact or cost entry, with a role (manual, receipt, ...)                           |
| `unlink_document`            | write       | Remove one document link (the document itself stays in the document system)                                                                                |
| `create_cost`                | costs:write | Book an expense or refund (decimal amount, category, asset and payer by name; split by ownership, equal or none)                                           |
| `list_finance_suggestions`   | read        | Your own inbox from the connected finance app (costs, devices, bills); pending by default, filter by kind or status; paged                                 |
| `accept_finance_suggestion`  | costs:write | Turn a suggestion into a cost entry, device or payment task, optionally overriding title, category, asset, room, payer, split ...                          |
| `dismiss_finance_suggestion` | costs:write | Reject a suggestion for good (it is never offered again)                                                                                                   |
| `sync_finance`               | costs:write | Sync your finance connection now and report what changed                                                                                                   |
| `get_vehicle`                | read        | A vehicle by id, name or plate: details, the latest odometer reading and its date, and its open tasks with their due state                                 |
| `record_odometer`            | write       | Record a vehicle's odometer (value, optional date and note); a lower value than before is refused unless `force`; lists the tasks that now need attention  |
| `list_fuel_logs`             | read        | A vehicle's fuel log, newest first: quantity, amount, price per unit and, on a full fill, the distance and consumption per 100; filter by year; paged      |
| `get_vehicle_stats`          | read        | A vehicle in numbers for a year or all time: distance, costs by category and per distance unit, consumption, price trend, mounted tires, next tasks        |
| `list_tire_sets`             | read        | A vehicle's tire sets: season, size, DOT age, tread depth with a warning below the limit of the season, storage, distance driven, which one is mounted     |
| `add_fuel_log`               | costs:write | Log a fill-up or charge (odometer, quantity, amount, full or partial); records the odometer and books a cost entry of the category fuel                    |
| `add_tire_set`               | write       | Add a set of tires to a vehicle (season, brand, model, size, DOT code, tread depth, storage); it is not mounted yet                                        |
| `mount_tire_set`             | write       | Mount a set (by id or words like `winter`), taking the mounted one off, with optional date and odometer; repeating it changes nothing                      |
| `record_tire_tread`          | write       | Record a tread depth in mm for a set (the mounted one by default); says when it is below the limit of the season                                           |
| `create_page`                | docs:write  | New documentation page (needs `docs:write`)                                                                                                                |
| `update_page`                | docs:write  | Edit a page; needs the `rev` from `get_page`, a concurrent edit is reported, not overwritten                                                               |

Rooms, assets and people can be given by name (`asset: "Dishwasher"`, `assignee: "Ben"`, `me`)
instead of an id, and so can contacts and parts; a vehicle can also be given by its plate (`asset: "ZH 123456"`, spaces and dashes do not matter). An ambiguous name is reported with the candidates. Tools are annotated with the
MCP `readOnlyHint`, `destructiveHint` and `idempotentHint`: only `undo_completion`,
`unlink_document` and `dismiss_finance_suggestion` (which cannot be undone) are marked destructive, and only those
three, the `update_*`, `set_defect_status`, `snooze_task`, `resolve_asset_note`, `mount_tire_set`, `sync_finance` and the read tools are idempotent.
Nothing here deletes data except a document link (never the document); files can be listed by name but not uploaded or downloaded. The finance inbox tools
only ever see the token user's own suggestions (the inbox is private to each person) and need a Kept
connection of that person; `accept_finance_suggestion` takes the same overrides as the REST endpoint, for the kind
of suggestion it names (a cost, a device or a bill).

The document tools read and link through **your own account** in the document system (each person
connects theirs under Settings, Integrations): without a connection they answer `not_found`, so does a
document your account cannot see, and another person's private documents never appear. Linking to a
documentation page needs `docs:write` in addition. The files themselves are not transferred, and sending
a file to the document system is not offered.

The vehicle tools take a vehicle by id, name or plate. `add_fuel_log` books money, so like `create_cost` it needs
`costs:write`: one call records the odometer reading and a cost entry of the category `fuel` (none for a free charge),
and the consumption per 100 is worked out between two full fills. `mount_tire_set` and `record_tire_tread` take a tire
set by id or by words from its season, brand, model or size (`winter`) and list the candidates when more than one
fits. Completing a tire-change task does not mount a set; ask for both.

## Adding a tool

Tools live in `src/tools/`; `src/tools/index.ts` is the registry and lists the planned
extension points (guest link, iCal feed).
Once the endpoint exists in `src/lib/api/registry.ts`, a tool is a few lines:

```ts
export const listDefects = defineTool({
  name: "list_defects",
  title: "List defects",
  description: "Open defects, newest first. Use before reporting a new one.",
  mode: "read", // read | create | update | undo: fixes the annotations and the needed scope
  input: { status: z.enum(["active", "all"]).default("active") },
  async handler({ status }, ctx) {
    const page = await ctx.api.call(endpoints.defectsList, {
      query: { status },
    });
    return {
      summary: `${page.items.length} defects.`,
      data: { defects: page.items },
    };
  },
});
```

Add it to the `tools` array. A tool is registered only when the token holds its scopes (`scopes`
defaults to `read` for read tools and `write` otherwise; pass e.g. `["write", "docs:write"]` for
more). `ctx` offers the typed client, the token user, the household, `today()` and helpers that
resolve rooms, assets and people by name. Only import client-safe code: `src/lib/api/**`,
`src/lib/tasks/engine/types` and `src/lib/dates` (a test fails if the bundle reaches server code).

## Development

```bash
bun --bun vitest run mcp                     # the tools against an in-process hauswart over the SDK's in-memory transport
bun --bun vitest run src/routes/api/v1/mcp   # the HTTP endpoint through the real hook
HAUSWART_URL=http://localhost:5173 HAUSWART_TOKEN=hw_xxxxxxxx bun run mcp   # the same tools over stdio, from a checkout
```

`bun run mcp` is the stdio entry point (`mcp/src/index.ts`), kept for working on the tools without
a deployed hauswart: it connects to the REST API of any instance with the token in the environment,
tells you on stderr how many tools it registered, and exits with a message if the address is
unreachable or the token was rejected. Claude Desktop can run it too (`"command": "bun"`,
`"args": ["/path/to/hauswart/mcp/src/index.ts"]`, the two variables under `"env"`). There are no
compiled binaries any more: the HTTP endpoint replaced them.

`mcp/src/server.ts` builds a server in two ways: `createHauswartServer` asks the instance who the
token belongs to first (stdio, tests), `buildHauswartServer` takes that as given (the HTTP endpoint,
`src/lib/server/api/handlers/mcp.ts`, which has just authenticated the request itself).
