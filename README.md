# hauswart

[![hauswart dashboard](docs/assets/shots/dashboard-light.webp)](https://orellbuehler.github.io/hauswart/)

**Website: <https://orellbuehler.github.io/hauswart/>** (screenshots show synthetic demo data)

Self-hosted apartment management for a household: recurring maintenance tasks with completion
tracking, documentation, a device inventory, defects, spare parts, contacts and costs.
Integrations (Home Assistant, Paperless-ngx, Kept) are optional adapters, never requirements.

**Status: early development.** The core works (tasks, devices, defects, documentation, spare parts,
costs, iCal feeds, guest links, Home Assistant, Paperless-ngx, Kept, REST API, MCP server); there
is no stable release yet. The interface is in German (default) and English.

## Run with Docker

```bash
docker build -t hauswart .
docker run -d --name hauswart -p 3000:3000 -v hauswart-data:/data \
  -e HAUSWART_SECRET_KEY="$(openssl rand -base64 32)" \
  hauswart
curl http://localhost:3000/api/health   # {"status":"ok"}
```

Keep the secret key: it encrypts stored credentials, and losing it makes them unreadable.
Set `ORIGIN` to the public URL (for example `https://hauswart.example.org`), always behind a
reverse proxy and also on plain HTTP (`http://localhost:3000`, together with
`HAUSWART_COOKIE_SECURE=false`): signing in checks the `Origin` header against it. The first
visit opens the setup page, which creates the administrator account.

## Configuration

| Variable                 | Default                 | Purpose                                                                                       |
| ------------------------ | ----------------------- | --------------------------------------------------------------------------------------------- |
| `HAUSWART_SECRET_KEY`    | none (required in prod) | 32 random bytes, base64. Encrypts stored secrets.                                             |
| `DATABASE_PATH`          | `./data/hauswart.db`    | SQLite database file.                                                                         |
| `HAUSWART_FILES_DIR`     | `./data/files`          | Uploaded documents and photos.                                                                |
| `HAUSWART_BACKUP_DIR`    | `./data/backups`        | Daily database backups plus a mirror of the uploaded files (`files/`). Set empty to turn off. |
| `HAUSWART_BACKUP_KEEP`   | `14`                    | Number of backups to keep.                                                                    |
| `HAUSWART_TZ`            | `Europe/Zurich`         | Household time zone for calendar dates.                                                       |
| `HAUSWART_COOKIE_SECURE` | `true`                  | Set to `false` only when serving over plain HTTP.                                             |
| `HAUSWART_SETUP_TOKEN`   | none                    | If set, first-run setup asks for this value (guards a new install).                           |
| `BODY_SIZE_LIMIT`        | `512K` (image: `30M`)   | Largest request body the server accepts; uploads are up to 25 MiB.                            |
| `ORIGIN`                 | none                    | Public URL; required behind a proxy and on plain HTTP (CSRF check).                           |
| `ADDRESS_HEADER`         | none                    | Header carrying the client address (for example `X-Forwarded-For`).                           |
| `XFF_DEPTH`              | none                    | Number of trusted proxies for `ADDRESS_HEADER`.                                               |

See [.env.example](.env.example).

Set `HAUSWART_SETUP_TOKEN` when the instance is reachable before you have created the first
account: anyone who can open `/setup` first would otherwise become the administrator. The setup
page then asks for the token; it has no effect once an administrator exists.

## Integrations and network access

Home Assistant is connected once for the household (administrators only); Paperless-ngx and Kept are
connected by every person with their own account. The server fetches the address a person enters,
so which hosts a connection may point at is restricted:

- **Allow-list.** Administrators may connect any host. Other members may only save a Paperless or
  Kept connection whose host is on the household's list, kept under Settings, Household
  (`integrationHostAllowlist` in `PATCH /api/v1/household`, visible to administrators only). Entries
  are host names or addresses, optionally with a port (`docs.example.org`, `nas.example.org:8000`),
  compared exactly and case-insensitively (internationalised names as punycode); an entry without a
  port allows every port of that host. The list starts empty, so until an administrator adds hosts
  members cannot connect their own accounts, and saving a connection never adds a host by itself.
- **Never reachable**, for anybody: link-local addresses (169.254.0.0/16, fe80::/10) and cloud
  metadata endpoints (100.100.100.200, `metadata.google.internal`). Host names are resolved and every
  address is checked when a connection is saved and again before every request.
- **Loopback** (127.0.0.0/8, ::1) is reserved for administrators' connections and the household-wide
  Home Assistant connection.

## Development

Requires [Bun](https://bun.sh) 1.4 or newer.

```bash
bun install
bun dev                  # dev server
bun run verify           # format:check + lint + check + test
bun run build && bun run start  # start runs with NODE_ENV=production: HAUSWART_SECRET_KEY is required
bun run db:generate      # after editing src/lib/server/schema.ts
bun run openapi          # regenerate docs/openapi.json (the versioned /api/v1 contract)
bun run leak-guard --all # scan the tree for configured private terms
```

An MCP server for Claude lives in [mcp/](mcp/README.md) (`bun run mcp`, `bun run mcp:build`).

Hooks run through [prek](https://github.com/j178/prek): `prek install` once per clone.
See [CLAUDE.md](CLAUDE.md) for architecture and conventions.

## License

[PolyForm Noncommercial 1.0.0](LICENSE) — free for personal and other noncommercial use.
