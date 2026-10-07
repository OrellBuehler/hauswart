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
     defects, spare parts, contacts, comments, warranties, statistics, notifications) and search
     across all of it.
   - `write` (in addition): Claude can also create and change tasks and assets, mark tasks done,
     skip, snooze and undo, report defects and change their status, book spare-part stock, comment
     and log service work. Without it the write tools are not even offered.
   - `docs:write` (in addition): Claude can create and edit documentation pages.
   - `costs:write` (in addition): Claude can book costs.

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

| Tool                 | Scope       | What it does                                                                                                                                     |
| -------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `whoami`             | read        | Token user, scopes, household, today's date                                                                                                      |
| `list_upcoming`      | read        | Overdue / today / this week / later / sensor-based tasks, due preparations, open defects, expiring warranties, parts to order; `mine`, `horizon` |
| `list_tasks`         | read        | Filter by status, category, room, asset, assignee, text; paged                                                                                   |
| `get_task`           | read        | One task: trigger, state, preparations, recent completions                                                                                       |
| `preview_trigger`    | read        | Check a trigger and see its first due date without creating anything                                                                             |
| `list_rooms`         | read        | Rooms with ids                                                                                                                                   |
| `list_assets`        | read        | Devices, plants, fixtures; filter by kind, room, text; paged                                                                                     |
| `get_asset`          | read        | One asset in full, with its tasks                                                                                                                |
| `get_stats`          | read        | Done / skipped / on time per person and category                                                                                                 |
| `list_notifications` | read        | The token user's notifications as readable text                                                                                                  |
| `create_task`        | write       | New task; the trigger is validated with the engine's schema and documented in the tool                                                           |
| `update_task`        | write       | Change fields, replace the trigger, archive or restore                                                                                           |
| `complete_task`      | write       | Mark done (optionally backdated, with a note); returns the next due date                                                                         |
| `skip_task`          | write       | Skip the current occurrence                                                                                                                      |
| `snooze_task`        | write       | Hide a task until a date, or end a snooze                                                                                                        |
| `undo_completion`    | write       | Revoke a completion or skip (within 7 days)                                                                                                      |
| `create_asset`       | write       | New device, plant or fixture                                                                                                                     |
| `update_asset`       | write       | Change fields, archive or restore                                                                                                                |
| `search`             | read        | Full-text search over pages, assets, rooms, tasks, defects, contacts, parts and hints                                                            |
| `list_pages`         | read        | Documentation pages: filter by section, asset, room, text; paged                                                                                 |
| `get_page`           | read        | One page: markdown (secret blocks included), `rev`, backlinks, attached file names                                                               |
| `list_defects`       | read        | Defects: active (default), all or one status; filter by severity, room, asset, text; paged                                                       |
| `get_defect`         | read        | One defect with its timeline (status changes, correspondence, comments) and attachment names                                                     |
| `list_parts`         | read        | Spare parts with stock and orders; filter by text, asset, low stock; `orderNow` = shopping list                                                  |
| `list_contacts`      | read        | Contacts; filter by kind, emergency, text                                                                                                        |
| `get_contact`        | read        | One contact in full, by id or name                                                                                                               |
| `list_comments`      | read        | The comment thread of a task, defect, asset, room, part, contact, log entry, hint or page                                                        |
| `list_hints`         | read        | Care hints (tips, rules, warnings) of assets                                                                                                     |
| `list_warranties`    | read        | Warranty status per asset, soonest to expire first                                                                                               |
| `list_costs`         | read        | Cost entries (repairs, utilities, purchases, mortgage ...); filter by year, category, asset, room, payer, text; paged                            |
| `cost_summary`       | read        | A year's costs: total, per category and month, top assets, tax classes, and who owes whom                                                        |
| `create_defect`      | write       | Report a defect (room, asset and responsible contact by name)                                                                                    |
| `set_defect_status`  | write       | Move a defect to reported, in progress, fixed, rejected or back to open, with a note                                                             |
| `adjust_stock`       | write       | Book a stock movement for a part: used, bought or a correction                                                                                   |
| `add_comment`        | write       | Comment on a task, defect, asset, room, part, contact, log entry, hint or page                                                                   |
| `add_service_log`    | write       | Log maintenance, repair or other work on an asset, with contact and cost                                                                         |
| `create_cost`        | costs:write | Book an expense or refund (decimal amount, category, asset and payer by name; split by ownership, equal or none)                                 |
| `create_page`        | docs:write  | New documentation page (needs `docs:write`)                                                                                                      |
| `update_page`        | docs:write  | Edit a page; needs the `rev` from `get_page`, a concurrent edit is reported, not overwritten                                                     |

Rooms, assets and people can be given by name (`asset: "Dishwasher"`, `assignee: "Ben"`, `me`)
instead of an id, and so can contacts and parts; an ambiguous name is reported with the candidates. Tools are annotated with the
MCP `readOnlyHint`, `destructiveHint` and `idempotentHint`: only `undo_completion` is marked
destructive, and only the `update_*`, `set_defect_status`, `snooze_task` and read tools are idempotent.
Nothing here deletes data; files can be listed by name but not uploaded or downloaded.

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
