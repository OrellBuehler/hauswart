---
paths:
  - "src/hooks.server.ts"
  - "src/lib/server/auth/**"
  - "src/lib/server/users/**"
  - "src/lib/server/api/bind*.ts"
  - "src/lib/api/{registry,client,errors,scopes,enums,openapi,browser}.ts"
  - "src/lib/server/docs/markdown*.ts"
  - "src/routes/authz.test.ts"
  - "src/routes/api/registry.test.ts"
  - "src/routes/{login,setup}/**"
  - "src/routes/api/v1/{auth,me,setup,tokens,users}/**"
  - "src/routes/*/settings/{account,tokens}/**"
  - "svelte.config.js"
---

# Authentication and the API spine

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
