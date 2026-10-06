---
name: new-endpoint
description: Add a REST endpoint to hauswart's versioned API (/api/v1) end to end — Zod schema, registry entry, bind route, service function, authz matrix test, OpenAPI regeneration, typed client usage. Use whenever a feature needs a new or changed API operation.
---

hauswart is REST-first: every domain operation is an `/api/v1` endpoint that the Svelte frontend
and a future mobile app consume identically. Do the steps in this order. The registry, `bind` and
the typed client are introduced in M0b; until they exist, build steps 1, 4 and 5 against the
conventions below and wire the rest when M0b lands.

1. **Schema** in `src/lib/api/schemas/<domain>.ts`: Zod schemas for the request (params, query,
   body) and the response. Client-safe: no `$lib/server` imports. Dates are `YYYY-MM-DD` strings,
   instants `timestamp_ms` integers, money integer minor units. Export inferred types.
2. **Registry entry** in `src/lib/api/registry.ts`: method, path (`/api/v1/<resource>`), the
   schemas, the authz rule (who may call it) and a stable `operationId`. The registry is the single
   source for the route, the client and the OpenAPI document.
3. **Service function** in `src/lib/server/<domain>/<name>.ts`: a plain `(ctx, input) => result`
   function with no HTTP types. `ctx` carries the db, the current user/household and `today`
   (`YYYY-MM-DD` in `HAUSWART_TZ`). Add the migration first if it needs one (see `new-table`).
4. **Route** `src/routes/api/v1/<resource>/+server.ts`: a one-liner that exports the handler
   produced by `bind(registry.<operationId>, service)`. No logic in the route file.
5. **Tests**: service tests with `useTestDB()` (happy path, validation failures, another
   household's data is invisible); add the endpoint to the **authz matrix test** (anonymous gets
   401, a user from another household gets 403/404, allowed roles succeed). Bug fixes start with a
   failing test.
6. **OpenAPI**: regenerate `docs/openapi.json` (`bun run openapi`, introduced in M0b) and commit it
   with the change.
7. **Client usage**: call the endpoint from pages through `src/lib/api/client.ts`. No form actions
   for domain logic. Handle pending, error and empty states; every string through Paraglide with
   both `messages/de.json` and `messages/en.json` keys.
8. Run the `verify` skill.
