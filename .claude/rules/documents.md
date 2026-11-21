---
paths:
  - "src/lib/server/documents/**"
  - "src/lib/server/integrations/paperless/**"
  - "src/lib/documents/**"
  - "src/lib/api/schemas/documents.ts"
  - "src/lib/server/api/handlers/documents.ts"
  - "src/routes/api/v1/{documents,document-links}/**"
  - "src/lib/components/documents/**"
  - "src/routes/*/documents/**"
  - "mcp/src/tools/documents.ts"
---

# Documents and the document provider

- **Per person, never shared.** A document system (Paperless-ngx) is connected by every person with their own token
  (`INTEGRATION_LEVELS.paperless = "user"`, `connections.userId`), so everybody reads exactly what their own account
  may. Every document call (list, meta, preview, thumb, download, link creation, push) goes through the caller's own
  connection: no connection or a disabled one is 404, and another person's token is never used. A document the account
  cannot see is 404 whatever other accounts see; an upstream refusal is 502 `upstream_error` with `details.code`
  (`unauthorized`, `forbidden`, `too_large`, `timeout`, ...). Nothing about a document is logged.
- **The seam** (`documents/provider.ts`): the core knows a `DocumentProvider` (`search`, `get` -> null when not visible,
  `openFile`, `webUrl`, `startUpload`, `awaitUpload`, `shareUploaded`, `addNote`), registered by the adapter
  (`registerDocumentProvider`) and named only by `DOCUMENT_PROVIDERS` in `enums.ts`. The core also reads the connection
  settings (`documentProviderConfigSchema` in `api/schemas/documents.ts`: `sharedTagIds`, `warrantyFieldId`,
  `warrantyExtendedFieldId`, `uploadTagIds`, `uploadStoragePathId`, `uploadCorrespondentId`, `shareGroupIds`,
  `receiptTagIds`, `manualTagIds`, `writeBackNotes`, `appUrl`); every id is the person's choice, picked from
  `GET /integrations/{kind}/{tags,correspondents,custom-fields,groups,storage-paths}` (own connection; `q` narrows).
- **Tables** (migrations `0010_documents` and, for the triggers, `0011_document_link_cleanup`): `external_documents` (cache per connection: title, date, correspondent, tags,
  mime, pages, notes count, the two warranty dates, `ownerVisible`; unique per connection and external id; a row with
  `ownerVisible = false` keeps no content, it only says "asked, not shown"), `external_document_sync` (address and
  scope the cache was built for, newest modification seen, last full read), `document_links` (provider, external id,
  generic owner `asset|room|page|task|defect|service_log|part|contact|cost|insurance_policy` + id, `role`, `label`, the maker's
  connection; unique per document, owner and role), `document_uploads` (push jobs). `AFTER DELETE` triggers on the
  ten owner tables (`0011`, `0014` for costs and `0018` for insurance policies) remove the links of a deleted owner (cascades included); a new link
  owner type needs its trigger and an entry in `documents/owners.ts` (it reuses the comments registry for title and url).
- **Sync** (`registerPaperless()` in `init()`, `integrations/paperless/sync.ts`, scheduler every 30 minutes, soon after
  a connection is saved - backoff ignored - and after a link was made so other people's caches catch up): per
  connection, the documents with a tag of `sharedTagIds` + `receiptTagIds` + `manualTagIds`, incremental by `modified`
  (a second of overlap), and every run every document a link points at (links made at another address are skipped; a
  linked document the account cannot see becomes `ownerVisible = false` without content). A full read (first run, other
  address or scope or warranty fields, once a day) also drops rows nothing needs. Outcome and backoff (1, 2, 4 ... 15
  min) are recorded on the connection like for Home Assistant.
- **In the web app**: every owner page has the "Archived documents" section (`components/documents/linked-documents.svelte`:
  link after a live search, preview, download, unlink); the **Documents** page (`/documents`, `GET /documents` with live
  search `q`, tag, correspondent and `linked` filters, a detail sheet from `GET /documents/{provider}/{id}` with the
  places the document is used and unlink) and its sidebar entry exist only for people with a working connection
  (`DocumentSystem` in `#lib/documents/system.svelte.ts` asks again when a connection is saved or removed); the page
  shows the connection's health (`status`, `lastError`) above the list. A device whose dates follow a document
  (`warrantySource = document`) says so on its page and in the edit form. Failure codes of a push are all worded in
  `#lib/connections/errors.ts` (`consume_failed`, `duplicate`, `interrupted`, `file_missing`, ...).
- **Links** (`GET|POST /document-links`, `DELETE /document-links/{id}`): creating one needs the caller's account to read
  the document (404 otherwise) and caches what it saw; 409 for the same document, owner and role. The link DTO has
  `available` (the caller's own cache row is visible and from the same instance): another person's private document
  shows as not shared, with no title, no `document`, no file urls. A page owner needs `docs:write` (like attachments).
  `GET /documents` lists the caller's synced documents (filters `tag`, `correspondent`, `linked`) or, with `q`, searches
  live (title and text, at most 100 hits); every item has `linkedTo` (link id, owner type, id, title, `ownerUrl`, role). `GET /documents/{provider}/{id}` is asked live.
- **Files** (`preview`, `thumb`, `download[?original=1]`): binary endpoints that stream through the caller's connection
  (25 MB cap, redirects refused, `too_large` before any byte when declared, a stream error beyond it). Only PDF, raster
  images and plain text are inline; everything else is `application/octet-stream` + `attachment`. `nosniff`, a CSP,
  `Cache-Control: private, max-age=300`.
- **Warranty from documents** (`documents/warranty.ts`, `assets.warrantySource` `manual|document`): after a link (role
  `receipt` or `warranty` on an asset) and after every sync, an asset whose dates are empty or `document` takes the
  latest date of each field of its documents; a manual edit that changes a date switches to `manual` and is never
  overwritten; a document without a date changes nothing.
- **Suggestions** (`GET /documents/suggestions?kind=asset|contact`, from the caller's own cache only): receipts (a
  `receiptTagIds` tag) with a warranty date and no linked asset; correspondents of the synced documents that no contact
  stands for. A contact made from a correspondent carries `externalSource = "document_correspondent"`, `externalRef =
"<provider>:<correspondentId>"` (provider-scoped, not connection-scoped: contacts are the household's, the household
  is assumed to use one instance per provider).
- **Pushing** (`POST /attachments/{id}/push-to-documents` -> 202 + job, poll `GET /documents/uploads/{jobId}`, own jobs
  only): uploads with the configured tags, storage path and correspondent, waits for the consumption task (10 minutes,
  polled every 2 s), sets owner = the account and view/change groups = `shareGroupIds` (skipped without groups; a
  failure is job `warning = permissions_failed`, the document and link stay), links the document to the attachment's
  owner with the given role (hint attachments are refused), writes the note. A file the provider already holds is
  linked as it is when the account can read it (`duplicate: true`), else the job fails `duplicate`. Jobs are rows
  (`queued|uploading|processing|done|failed`, `errorCode` a short code): at startup a `processing` job resumes, the
  others fail `interrupted`; a second push of a file still being handled returns the same job.
- **Note write-back** (`writeBackNotes`): after a link, in the background, a note `Verknüpft in hauswart: <app url><path
of the owner>` is added to the document unless an identical note exists (writes per document are serialised); a
  failure is logged by name and never fails the link. The app address is `appUrl`, else `ORIGIN`, else the bare path.
- **Search**: linked documents appear as hits of type `document` (id `<provider>:<externalId>`, url = the first thing
  they are linked to), matched by title only, only from the caller's own cache (so never somebody's private document).
- **Tests** live in `integrations/paperless/` (a core test must not import an adapter): `useFakePaperless()` gives a
  fake with several accounts (`addAccount`) and `strictPermissions` (visibility by owner, view users and groups), the
  harness registers the adapter and speeds up polling; `documents.api.test.ts`, `uploads.api.test.ts`, `sync.test.ts`,
  `scheduler.test.ts` cover isolation, sync, links, files, suggestions, search, pushes and notes.
