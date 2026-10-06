# hauswart MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets Claude (Claude Code,
Claude Desktop, any MCP client) query and operate hauswart. It runs on your machine over stdio and
talks to your hauswart instance through the REST API (`/api/v1`) with a scoped bearer token. It
uses the same typed client and endpoint registry as the web app (`src/lib/api`), so a contract
change breaks the build here too.

## Setup

1. In hauswart open **Settings → API tokens**, create a token of kind **MCP server** and choose
   the scopes:
   - `read`: Claude can look things up (upcoming tasks, tasks, assets, statistics, notifications).
   - `write` (in addition): Claude can also create and change tasks and assets, mark tasks done,
     skip, snooze and undo. Without it the write tools are not even offered.

   The token is shown once. Completions made through it are recorded as coming from `mcp`, under
   the token owner's name.

2. Set two environment variables for the server:

   | Variable         | Meaning                                                        |
   | ---------------- | -------------------------------------------------------------- |
   | `HAUSWART_URL`   | Base URL of the instance, e.g. `https://hauswart.example.org`. |
   | `HAUSWART_TOKEN` | The token from step 1 (`hw_…`).                                |

3. Register the server with your client.

### Claude Code

From a clone of this repository (needs [Bun](https://bun.sh) and `bun install`):

```bash
claude mcp add hauswart \
  --env HAUSWART_URL=https://hauswart.example.org \
  --env HAUSWART_TOKEN=hw_xxxxxxxx \
  -- bun /path/to/hauswart/mcp/src/index.ts
```

With the compiled binary (no Bun or checkout needed on the machine that runs Claude):

```bash
bun run mcp:build        # writes dist/hauswart-mcp (a single executable for this platform)
claude mcp add hauswart \
  --env HAUSWART_URL=https://hauswart.example.org \
  --env HAUSWART_TOKEN=hw_xxxxxxxx \
  -- /path/to/hauswart-mcp
```

Add `--scope user` to make it available in every project.

### Claude Desktop

In `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "hauswart": {
      "command": "/path/to/hauswart-mcp",
      "env": {
        "HAUSWART_URL": "https://hauswart.example.org",
        "HAUSWART_TOKEN": "hw_xxxxxxxx"
      }
    }
  }
}
```

For the source version use `"command": "bun"` and `"args": ["/path/to/hauswart/mcp/src/index.ts"]`.
Restart Claude Desktop afterwards.

### Check it

```bash
HAUSWART_URL=https://hauswart.example.org HAUSWART_TOKEN=hw_xxxxxxxx bun run mcp
# stderr: hauswart-mcp: connected to https://hauswart.example.org, 18 tools
```

The server asks hauswart who the token belongs to when it starts and exits with a message if the
URL is unreachable, the token was rejected, or it lacks `read`. Scopes are read at start-up: after
changing a token's scopes, restart the client.

## Tools

Results are a one-line summary followed by compact JSON (empty fields left out). Dates are
`YYYY-MM-DD` in the household's time zone. Errors come back as MCP tool errors in the form
`Error [code]: message` with the API's error code (`not_found`, `invalid_request`, `forbidden`,
`unauthenticated`, …), or `unreachable` when hauswart cannot be reached.

| Tool                 | Scope | What it does                                                                                     |
| -------------------- | ----- | ------------------------------------------------------------------------------------------------ |
| `whoami`             | read  | Token user, scopes, household, today's date                                                      |
| `list_upcoming`      | read  | Overdue / today / this week / later / sensor-based tasks and due preparations; `mine`, `horizon` |
| `list_tasks`         | read  | Filter by status, category, room, asset, assignee, text; paged                                   |
| `get_task`           | read  | One task: trigger, state, preparations, recent completions                                       |
| `preview_trigger`    | read  | Check a trigger and see its first due date without creating anything                             |
| `list_rooms`         | read  | Rooms with ids                                                                                   |
| `list_assets`        | read  | Devices, plants, fixtures; filter by kind, room, text; paged                                     |
| `get_asset`          | read  | One asset in full, with its tasks                                                                |
| `get_stats`          | read  | Done / skipped / on time per person and category                                                 |
| `list_notifications` | read  | The token user's notifications as readable text                                                  |
| `create_task`        | write | New task; the trigger is validated with the engine's schema and documented in the tool           |
| `update_task`        | write | Change fields, replace the trigger, archive or restore                                           |
| `complete_task`      | write | Mark done (optionally backdated, with a note); returns the next due date                         |
| `skip_task`          | write | Skip the current occurrence                                                                      |
| `snooze_task`        | write | Hide a task until a date, or end a snooze                                                        |
| `undo_completion`    | write | Revoke a completion or skip (within 7 days)                                                      |
| `create_asset`       | write | New device, plant or fixture                                                                     |
| `update_asset`       | write | Change fields, archive or restore                                                                |

Rooms, assets and people can be given by name (`asset: "Dishwasher"`, `assignee: "Ben"`, `me`)
instead of an id; an ambiguous name is reported with the candidates. Tools are annotated with the
MCP `readOnlyHint`, `destructiveHint` and `idempotentHint`: only `undo_completion` is marked
destructive, and only the `update_*`, `snooze_task` and read tools are idempotent. Nothing here
deletes data.

## Adding a tool

Tools live in `src/tools/`; `src/tools/index.ts` is the registry and lists the planned
extension points (search, pages, defects, parts and stock, contacts, comments, hints, costs).
Once the endpoint exists in `src/lib/api/registry.ts`, a tool is a few lines:

```ts
export const listDefects = defineTool({
  name: "list_defects",
  title: "List defects",
  description: "Open defects, newest first. Use before reporting a new one.",
  mode: "read", // read | create | update | undo: fixes the annotations and the needed scope
  input: { status: z.enum(["open", "done"]).optional() },
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
bun run mcp              # run from source
bun run mcp:build        # dist/hauswart-mcp
bun --bun vitest run mcp # tests: the server against an in-process hauswart over the SDK's in-memory transport
```
