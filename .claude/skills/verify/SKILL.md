---
name: verify
description: Run hauswart's full pre-merge verification — verify (format, lint, svelte-check, tests), leak guard over the whole tree, and a production build — and know what to check by hand. Use before every commit, merge or hand-off.
---

Run from the repository root; every step must pass without errors:

```bash
bun run verify              # prettier --check, eslint, svelte-check, vitest
bun run leak-guard --all    # private-term scan over every tracked or unignored file
bun run build               # production build with svelte-adapter-bun
```

Fix the cause of a failure. Never weaken the leak guard, skip a hook (`--no-verify`), loosen a
lint rule or delete a failing test to get green. `bun run format` fixes formatting.

Check by hand before merging:

- **Leaks**: no real names, addresses, hostnames, Home Assistant entity ids, Paperless ids or
  tokens in the diff, fixtures, seeds or the commit message; `seed/local/`, `.env` and
  `.private-terms` are not staged.
- **Migrations**: a schema change comes with a generated migration; no existing migration was
  edited; no `drizzle-kit push`.
- **API**: a contract change updates the registry and `docs/openapi.json` (`bun run openapi`; a
  test fails when it is stale). The authz matrix and the route guard are generated from the
  registry, so a new endpoint needs its route file and handler, not a matrix entry.
- **i18n**: new UI strings exist in both `messages/de.json` and `messages/en.json`.
- **UI**: new pages were looked at in a browser at 360 px and desktop width, light and dark.
- **Runtime**: after `bun run build`, `HAUSWART_SECRET_KEY=$(openssl rand -base64 32)
DATABASE_PATH=$(mktemp -d)/hauswart.db bun ./build/index.js` serves `/api/health` as
  `{"status":"ok"}`; stop the server afterwards. For auth changes also smoke-test with curl: `GET
/api/v1/setup`, `POST /api/v1/setup` (with `-H 'Origin: http://localhost:3000'` and JSON), then
  `GET /api/v1/auth/me` with the cookie and with a token from `POST /api/v1/auth/token`.

Report the result of each command, not just "green".
