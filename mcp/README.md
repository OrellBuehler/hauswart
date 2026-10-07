# hauswart MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets Claude (Claude Code,
Claude Desktop, any MCP client) query and operate hauswart. It runs on your machine over stdio and
talks to your hauswart instance through the REST API (`/api/v1`) with a scoped bearer token. It
uses the same typed client and endpoint registry as the web app (`src/lib/api`), so a contract
change breaks the build here too.

## Setup

1. In hauswart open **Settings → API tokens**, create a token of kind **MCP server** and choose
   the scopes:
   - `read`: Claude can look things up (upcoming tasks, tasks, assets, documentation pages,
     defects, spare parts, contacts, comments, warranties, statistics, notifications, the archived
     documents of your own document system) and search across all of it.
   - `write` (in addition): Claude can also create and change tasks and assets, mark tasks done,
     skip, snooze and undo, report defects and change their status, book spare-part stock, comment,
     log service work and link archived documents to devices, rooms and more. Without it the write tools are not even offered.
   - `docs:write` (in addition): Claude can create and edit documentation pages.
   - `costs:write` (in addition): Claude can book costs.

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

Every GitHub release has the compiled server attached, so you do not need to build it:
`hauswart-mcp-linux-x64`, `-linux-arm64`, `-darwin-x64`, `-darwin-arm64` and `-windows-x64.exe`, plus a
`SHA256SUMS` file. Download the one for your machine, check it with `sha256sum -c SHA256SUMS --ignore-missing`,
make it executable (`chmod +x`) and, on macOS, remove the download quarantine with
`xattr -d com.apple.quarantine hauswart-mcp-darwin-arm64`.

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
# stderr: hauswart-mcp: connected to https://hauswart.example.org, 44 tools
```

The server asks hauswart who the token belongs to when it starts and exits with a message if the
URL is unreachable, the token was rejected, or it lacks `read`. Scopes are read at start-up: after
changing a token's scopes, restart the client.

## Tools

Results are a one-line summary followed by compact JSON (empty fields left out). Dates are
`YYYY-MM-DD` in the household's time zone. Errors come back as MCP tool errors in the form
`Error [code]: message` with the API's error code (`not_found`, `invalid_request`, `forbidden`,
`unauthenticated`, …), or `unreachable` when hauswart cannot be reached.

| Tool                  | Scope       | What it does                                                                                                                                               |
| --------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `whoami`              | read        | Token user, scopes, household, today's date                                                                                                                |
| `list_upcoming`       | read        | Overdue / today / this week / later / sensor-based tasks, due preparations, open defects, expiring warranties, parts to order; `mine`, `horizon`           |
| `list_tasks`          | read        | Filter by status, category, room, asset, assignee, text; paged                                                                                             |
| `get_task`            | read        | One task: trigger, state, preparations, recent completions                                                                                                 |
| `preview_trigger`     | read        | Check a trigger and see its first due date without creating anything                                                                                       |
| `list_rooms`          | read        | Rooms with ids                                                                                                                                             |
| `list_assets`         | read        | Devices, plants, fixtures; filter by kind, room, text; paged                                                                                               |
| `get_asset`           | read        | One asset in full, with its tasks                                                                                                                          |
| `get_stats`           | read        | Done / skipped / on time per person and category                                                                                                           |
| `list_notifications`  | read        | The token user's notifications as readable text                                                                                                            |
| `create_task`         | write       | New task; the trigger is validated with the engine's schema and documented in the tool                                                                     |
| `update_task`         | write       | Change fields, replace the trigger, archive or restore                                                                                                     |
| `complete_task`       | write       | Mark done (optionally backdated, with a note); returns the next due date                                                                                   |
| `skip_task`           | write       | Skip the current occurrence                                                                                                                                |
| `snooze_task`         | write       | Hide a task until a date, or end a snooze                                                                                                                  |
| `undo_completion`     | write       | Revoke a completion or skip (within 7 days)                                                                                                                |
| `create_asset`        | write       | New device, plant or fixture                                                                                                                               |
| `update_asset`        | write       | Change fields, archive or restore                                                                                                                          |
| `search`              | read        | Full-text search over pages, assets, rooms, tasks, defects, contacts, parts and hints; linked documents by title                                           |
| `list_pages`          | read        | Documentation pages: filter by section, asset, room, text; paged                                                                                           |
| `get_page`            | read        | One page: markdown (secret blocks included), `rev`, backlinks, attached file names                                                                         |
| `list_defects`        | read        | Defects: active (default), all or one status; filter by severity, room, asset, text; paged                                                                 |
| `get_defect`          | read        | One defect with its timeline (status changes, correspondence, comments) and attachment names                                                               |
| `list_parts`          | read        | Spare parts with stock and orders; filter by text, asset, low stock; `orderNow` = shopping list                                                            |
| `list_contacts`       | read        | Contacts; filter by kind, emergency, text                                                                                                                  |
| `get_contact`         | read        | One contact in full, by id or name                                                                                                                         |
| `list_comments`       | read        | The comment thread of a task, defect, asset, room, part, contact, log entry, hint or page                                                                  |
| `search_documents`    | read        | Documents of your own document system (Paperless-ngx): live title and text search, or the synced household documents; filter by tag, correspondent, linked |
| `get_document`        | read        | One document: date, correspondent, tags, warranty dates, its address in the document system and where it is linked                                         |
| `list_document_links` | read        | The documents linked to an asset, room, page, task, defect, part, contact or cost entry, or where one document is used                                     |
| `list_hints`          | read        | Care hints (tips, rules, warnings) of assets                                                                                                               |
| `list_warranties`     | read        | Warranty status per asset, soonest to expire first                                                                                                         |
| `list_costs`          | read        | Cost entries (repairs, utilities, purchases, mortgage ...); filter by year, category, asset, room, payer, text; paged                                      |
| `cost_summary`        | read        | A year's costs: total, per category and month, top assets, tax classes, and who owes whom                                                                  |
| `create_defect`       | write       | Report a defect (room, asset and responsible contact by name)                                                                                              |
| `set_defect_status`   | write       | Move a defect to reported, in progress, fixed, rejected or back to open, with a note                                                                       |
| `adjust_stock`        | write       | Book a stock movement for a part: used, bought or a correction                                                                                             |
| `add_comment`         | write       | Comment on a task, defect, asset, room, part, contact, log entry, hint or page                                                                             |
| `add_service_log`     | write       | Log maintenance, repair or other work on an asset, with contact and cost                                                                                   |
| `link_document`       | write       | Link an archived document to an asset, room, page, task, defect, part, contact or cost entry, with a role (manual, receipt, ...)                           |
| `unlink_document`     | write       | Remove one document link (the document itself stays in the document system)                                                                                |
| `create_cost`         | costs:write | Book an expense or refund (decimal amount, category, asset and payer by name; split by ownership, equal or none)                                           |
| `create_page`         | docs:write  | New documentation page (needs `docs:write`)                                                                                                                |
| `update_page`         | docs:write  | Edit a page; needs the `rev` from `get_page`, a concurrent edit is reported, not overwritten                                                               |

The document tools read and link through **your own account** in the document system (each person
connects theirs under Settings, Integrations): without a connection they answer `not_found`, so does a
document your account cannot see, and another person's private documents never appear. Linking to a
documentation page needs `docs:write` in addition. The files themselves are not transferred, and sending
a file to the document system is not offered.

Rooms, assets and people can be given by name (`asset: "Dishwasher"`, `assignee: "Ben"`, `me`)
instead of an id, and so can contacts and parts; an ambiguous name is reported with the candidates. Tools are annotated with the
MCP `readOnlyHint`, `destructiveHint` and `idempotentHint`: only `undo_completion` and `unlink_document`
are marked destructive, and only the `update_*`, `set_defect_status`, `snooze_task`, those two and the read
tools are idempotent. Nothing here deletes data except a document link (never the document); files can be
listed by name but not uploaded or downloaded.

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
bun run mcp              # run from source
bun run mcp:build        # dist/hauswart-mcp
bun --bun vitest run mcp # tests: the server against an in-process hauswart over the SDK's in-memory transport
```
