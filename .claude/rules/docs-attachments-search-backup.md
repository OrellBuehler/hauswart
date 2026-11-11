---
paths:
  - "src/lib/server/docs/**"
  - "src/lib/server/files/**"
  - "src/lib/server/attachments/**"
  - "src/lib/server/search/**"
  - "src/lib/server/backup/**"
  - "src/lib/server/pdf/**"
  - "src/lib/docs/**"
  - "src/lib/attachments/**"
  - "src/lib/api/schemas/{docs,attachments,search}.ts"
  - "src/lib/server/api/handlers/{pages,attachments,search}.ts"
  - "src/routes/api/v1/{pages,attachments,search}/**"
  - "src/lib/components/{docs,attachments,search}/**"
  - "src/routes/*/docs/**"
---

# Documentation, attachments, search and backup

- **Pages** (`doc_pages`, `doc_page_revisions`; `docs/pages.ts`): `bodyMd` is the source; the
  renderings are caches written on save through the worker-backed async markdown functions
  (`renderedHtmlMember` with secret blocks, `renderedHtmlGuest` without, `plainText` WITHOUT secrets,
  `headingsJson` = `{member, guest}`). `MarkdownError` becomes 400 `invalid_request` with
  `details.code` `too_large` / `too_complex` (`unavailable` is 503), `FileError` 400/413/415 with
  `details.code` (see `api/errors.ts`). `PATCH` needs `rev` (409 `conflict`, `details.currentRev`; the
  update itself is guarded by `rev`); every successful save bumps `rev` and writes a revision (50
  kept). Restoring saves the old title/body as a new revision. Backlinks are computed on read from
  `[[slug]]` references in other pages. `preview` is a reserved slug (static route). Pages are
  written with the `docs:write` scope; `read` sees everything including secret blocks (members and
  tokens alike; only the guest rendering strips them).
- **Link resolution at render time**: `attachment:<id>` resolves only to attachments that exist
  (member: `/api/v1/attachments/<id>/content`; guest: only guest-visible ones, as
  `/g/{token}/files/<id>`), `[[slug]]` to `/docs/<slug>` (guest: `/g/{token}/docs/<slug>`; slug as
  `slugify` writes it). The guest HTML keeps the literal `{token}`; the future guest route must call
  `fillGuestToken(html, token)` (`docs/render.ts`) when it serves a page. Deleting an attachment or
  flipping `guestVisible` re-renders the pages that embed it (`onAttachmentsChanged` listener,
  started in `init()` by `startAttachmentRerender`; only the two HTML caches change, guarded by `rev`).
- **Attachments** (`attachments`): one row per upload, generic owner `ownerType` + `ownerId` without
  foreign keys (`asset|room|page|task|defect|service_log|part|asset_hint|contact|cost|insurance_policy|asset_note|tire_set|appointment|ai_task`), files stored
  once by sha256 in `HAUSWART_FILES_DIR` (`files/store.ts`: images re-encoded, metadata stripped,
  thumbnail; PDFs as uploaded; HEIC/SVG/HTML/GIF refused). Owner existence is checked through the
  registry in `attachments/owners.ts`: asset, room, page and task are built in; defect, service_log,
  part, asset_hint, contact, cost, insurance_policy, asset_note, tire_set, appointment and ai_task are registered by `registerDomainAttachmentOwners()`
  (`attachments/domain-owners.ts`, called from `registerDomainEventHandlers()`, so from `init()` and
  `useTestDB()`). A new owner type registers with `registerAttachmentOwner(type, existsFn)` **from
  `init()`** (never from a module that is only loaded with its routes) and calls
  `removeOwnedAttachments(ctx, type, id)` from its delete service (done for all fifteen; deleting an
  asset also removes the attachments of its service log entries, hints, notes and tire sets, whose rows go by cascade
  without a foreign key to follow). A type nobody registered is a 400 field error on `ownerType`. Uploading, patching or deleting an attachment of a page needs `docs:write`,
  others `write`. `deleteIfUnreferenced` keeps files younger than a minute, so a daily orphan sweep
  (`startFileSweeper`) removes what deletions left behind. `assets.photoAttachmentId` must be an
  image attachment owned by that asset (set it with an update; it cannot be set on create); the asset
  also carries `photoUrl`, the thumbnail URL for `<img src>`.
- **Binary endpoints** (file content, PDF exports): `responseType: "binary"` + `contentTypes` in the
  registry, `response: binaryResponseSchema` as placeholder. The handler returns a finished
  `Response` (`bind` authenticates, parses and passes it through, outside production it checks the
  status and that the content type is one of `contentTypes`, and adds `Cache-Control: no-store` when
  the handler set none). OpenAPI documents `string/binary` per content type. `createApiClient().call`
  returns the raw `Response` (for downloads with a token); use `endpointUrl(endpoint, {params, query})`
  for `<img src>` and plain download links. Stored files are served with `files/serve.ts` (nosniff,
  CSP, ETag = sha256, `private, immutable`); the PDF export is `application/pdf`, `no-store`. pdfmake
  is external to the bundle (`vite.config.ts`) and read from `node_modules` at runtime.
- **Multipart bodies** are passed to `api.call` as a plain object (files as `File`, the rest
  strings); the client builds the `FormData`. In route tests use `callRoute(..., { form })`.
- **Search** (`search_fts`, FTS5, created in custom migration `0006_search_index`): triggers on pages,
  assets, rooms, tasks, defects (title, description, location), contacts (name, company, notes; never
  phone, e-mail or address), parts (name, part number, supplier, notes), asset hints (title, body) and insurance
  policies (title, policy number, notes; custom migration `0018`) and appointments (title, place, notes; custom migration `0023`) keep it current (archived assets, tasks, pages and
  parts are dropped). The plate of a vehicle is part of its asset's row (custom migration `0016_vehicle_search`:
  replaces `search_assets_au`, adds triggers on `vehicle_details`); nothing else of `vehicle_details` is indexed. No secret text enters the
  index: pages index `plain_text`; every other free text is cut off at the first `:::` when it
  mentions "secret" anywhere. Hit `url`s are the UI routes (`/docs/<slug>`, `/assets/<id>` also for
  plants and hints, `/rooms/<id>`, `/tasks/<id>`, `/defects/<id>`, `/parts/<id>`, `/contacts/<id>`, `/insurance/<id>`, `/appointments/<id>`).
  New searchable entities need their own triggers in a new migration and an entry in `URLS`
  (`search/search.ts`). Queries become quoted prefix terms (`ftsExpression`), so no FTS syntax reaches SQLite.
- **Backup** (`backup/`): on by default (`HAUSWART_BACKUP_DIR` default `./data/backups`, set it empty
  to turn off; `HAUSWART_BACKUP_KEEP` default 14). Hourly check: a `VACUUM INTO` copy
  (`hauswart-backup-<UTC>.db`) when the newest is a day old, then `mirrorFiles` copies the stored
  files missing in `<dir>/files` (never overwrites, never deletes).
