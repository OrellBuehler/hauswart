---
name: new-endpoint
description: Add a REST endpoint to hauswart's versioned API (/api/v1) end to end — Zod schema, registry entry, service, handler, bind route, tests, OpenAPI regeneration, typed client usage. Use whenever a feature needs a new or changed API operation.
---

hauswart is REST-first: every domain operation is an `/api/v1` endpoint that the Svelte frontend,
the mobile app, Home Assistant and the MCP server consume identically. Do the steps in this order.

1. **Schema** in `src/lib/api/schemas/<domain>.ts`: Zod schemas for the request (`params`, `query`,
   `body`) and the response. Client-safe: relative imports only, no `$lib/server`. Request bodies
   are `z.strictObject` (unknown fields are a 400); query values arrive as strings, so use
   `z.coerce`. Dates are `YYYY-MM-DD` (`dateSchema`), instants UTC ISO strings
   (`isoTimestampSchema`, `toIso`), money integer minor units. Lists respond with
   `paginated(item)` = `{items, nextCursor}` and take `paginationQuerySchema`. Name a reused
   response object with `.meta({ id: "Name" })` so it becomes `components/schemas` in OpenAPI (use a
   named schema on the response side only). Export inferred types.
2. **Registry entry** in `src/lib/api/registry.ts` with `defineEndpoint({...})`, added to
   `endpoints` under a camelCase key equal to its `id`:
   - `method`, `path` (`/api/v1/tokens/{id}`; every `{name}` must be in `params`), `summary`,
     `tags`, `response`, optional `body`/`query`/`params`.
   - `auth`: `session` (browser cookie only), `bearer` (API token only), `both`, or `public`.
     Choose `both` for read/write domain endpoints; keep self-management (tokens, profile) on
     `session`. `public` endpoints must also be added to `src/lib/server/auth/routing.ts`.
   - `scopes`: what the caller needs, all of them. `read` for GETs, `write` for general changes,
     `docs:write`, `costs:write`, `ha:action`, `admin` as appropriate; `[]` = any authenticated
     caller. Sessions hold all scopes their role allows; `admin` only for administrators.
   - `status` (200, 201 or 204 — 204 uses `emptySchema` and returns `null`), `errors` for extra
     codes the handler raises (`not_found`, `conflict`, …), `setsSession` only for endpoints that
     start a cookie session, `bodyType: "multipart"` for uploads, `maxBodyBytes` if the default
     256 KiB is wrong.
3. **Service function** in `src/lib/server/<domain>/<name>.ts`: a plain function with no HTTP types
   that takes the db/context and parsed input. Throw domain errors (like `AuthError`) or
   `ApiError`; `bind` maps both to the envelope. Add the migration first if it needs one (see
   `new-table`). One household: domain data is shared by all users; per-user resources filter by
   the caller's id and answer 404 for other users' rows.
4. **Handler** in `src/lib/server/api/handlers/<domain>.ts`:
   `export const x: Handler<typeof endpoints.x> = ({ ctx, params, query, body, event }) => …`.
   `ctx` is `{ db, user, principal, now, today }` (`today` = `YYYY-MM-DD` in `HAUSWART_TZ`; `user`
   and `principal` are null only on `public` endpoints). Return the response body, or
   `reply(status, body)` for a one-off status. Map rows to the wire shape field by field (see
   `wire.ts`) so nothing leaks by accident. `event` is for cookies and the client address only.
5. **Route** `src/routes/api/v1/<resource>/+server.ts`, one line per method:
   `export const GET = bind(endpoints.x, x);`. Nothing else may be in the file; the guard test
   `src/routes/api/registry.test.ts` fails otherwise, and when the file location, method or path
   differ from the registry entry.
6. **Tests**: service tests with `useTestDB()` (happy path, validation, edge cases); route tests
   next to the route with `callRoute` from `$lib/testing/route` (success, validation 400, not
   found, per-user invisibility for user-owned resources). The authz matrix
   (`src/routes/authz.test.ts`) and the route guard are generated from the registry — no entry to
   add, but they must pass: they check 401 anonymous, 403 for the wrong credential kind, a token
   missing a scope, a member on `admin` endpoints and cross-origin cookie requests (`csrf_failed`).
   Bug fixes start with a failing test.
7. **OpenAPI**: run `bun run openapi` and commit `docs/openapi.json` with the change (a test fails
   when it is stale).
8. **Client usage**: pages call `createApiClient(fetch).call(endpoints.x, { params, query, body })`
   in `load` (with the load's own `fetch`) or `api.call(...)` from `$lib/api/browser` in event
   handlers. It returns the parsed response or throws `ApiError` (`code`, `status`, `details`);
   render `apiErrorMessage(err)`. No form actions for domain logic. Handle pending, error and empty
   states; every string through Paraglide with keys in both `messages/de.json` and
   `messages/en.json`.
9. Run the `verify` skill.
