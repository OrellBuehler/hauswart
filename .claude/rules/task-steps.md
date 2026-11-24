---
paths:
  - "src/lib/server/tasks/steps.ts"
  - "src/lib/server/tasks/step-counts.ts"
  - "src/lib/server/attachments/from-url.ts"
  - "src/lib/server/attachments/preview.ts"
  - "src/lib/server/files/pdf-pages.ts"
  - "src/lib/server/net/**"
  - "src/lib/api/schemas/{task-steps,attachments}.ts"
  - "src/routes/api/v1/{tasks,attachments}/**"
  - "src/lib/components/task-steps/**"
  - "mcp/src/tools/{task-steps,attachments}.ts"
  - "mcp/src/task-steps-tools.test.ts"
---

# Task steps, attaching from an address, reading attachments

A chore should show the exact steps to do it, with a picture per step where that helps. Steps come from a person typing them in the web
app, from an assistant that writes them through the MCP server (from the manufacturer's site, or from the manual attached to the device),
or from the seed file. Three pieces make that work: the steps themselves, a way to attach a picture or PDF found online, and a way for an
assistant to read an attached file (a manual, a page at a time).

## Steps of a task

- **The table** (`task_steps`, migration `0031`; `tasks/steps.ts`, `tasks/step-counts.ts`): `taskId` (cascade), `position` (0-based; not
  unique, a reorder rewrites rows one at a time), `title` (one line, at most 200 characters, no line break), `body` (plain text, at most
  2000, default empty), the usual timestamps; index on `(task_id, position)`. Domain data shared by the household, no per-user scoping.
  `tasks.steps_source` (JSON `{label, url, attachmentId, page}`, all nullable) says where the steps come from. The attachment inside it has
  no foreign key; readers check that it still exists (`resolveStepsSource`): when it is gone `attachmentId`, `attachment` and `page` read as
  null and, if nothing else is left, the whole source is null.
- **Pictures** are attachments of the owner type `task_step` (`ownerId` = the step id; registered with the domain owners, uploads need
  `write`). No comments, no document links, no search index, never shown to a guest (`getGuestFile` only knows pages and hints). They come
  back in `steps[].images` in upload order (`createdAt`, then the row's insertion order). Deleting a step removes its attachments in the
  same transaction as the step (`deleteOwnedAttachmentRows`; the stored files are swept after the commit, `releaseAttachments`); deleting a
  task removes the attachments of all its steps (the step rows go by cascade and the attachments have no foreign key to follow, so
  `deleteTask` collects the step ids first, like `deleteAsset` does for notes and hints).
- **Read**: `GET /tasks/{id}` carries `steps` (`{id, position, title, body, images: Attachment[]}`) and `stepsSource`
  (`{label, url, attachmentId, page, attachment: {id, filename, mime, url} | null} | null`). Every task DTO carries `stepCount` (a
  correlated subquery, like `openNoteCount`): list rows, the detail, the answers of complete/skip/snooze, the dashboard's tasks (and so the
  `nextTasks` of the vehicle statistics). `GET /tasks?hasSteps=true|false` filters on it.
- **Write**: `PUT /tasks/{id}/steps` (scope `write`) `{steps: [{id?, title, body?}], source?}` replaces the list in one transaction (at most 30
  steps). A step with the id of one of this task's steps keeps its id, pictures and `createdAt` and takes the new title, body and place
  (a step that did not change is not written, so its `updatedAt` stays); a step without an id is new; a step the list leaves out is
  deleted with its pictures. An unknown id (or one of another task) is a 400 on `steps` and rolls everything back; the same id twice is a
  400 on `steps` from the schema. `source` left out keeps the source, `null` removes it, an object replaces it as a whole (a field left
  out is cleared): `label` (200), then `url` (http or https, 2000 characters, no user name or password) **or** `attachmentId` (an attachment
  that exists, else a 400 on `source`) with an optional `page` (1 to 9999, only with `attachmentId`); both together, a page alone and an
  empty object are 400s. Answers `{steps, stepsSource, stepCount}`. Archived tasks can be edited. **The task is not touched**: no
  re-evaluation, and `tasks.updated_at` is written back as it was (`set updated_at = updated_at`, otherwise the column's `$onUpdate` would
  move it), because the iCal feed and calendar sync read `updatedAt` for SEQUENCE and LAST-MODIFIED and a step is in no calendar.
- **Seed**: a seed task may carry `steps: [{title, body?}]` (no images). They are written when the task has none yet (a task just made, or
  one whose run stopped half way), and replaced only with `--update`, by place: step n of the file takes over step n of the task (keeping its
  id and so its pictures), and steps the task has beyond the file stay (the importer never deletes). A task without a `steps` key is left
  alone. The report counts per task (`steps: {created, updated, unchanged}`).
- **Not built**: steps for the tasks of a template, a step that is a completion checklist item, a picture copied between steps, reordering
  by a move endpoint (send the list in the new order), a notification, the task page (frontend).

## Attaching a file from an address

- **`POST /attachments/from-url`** `{ownerType, ownerId, url, caption?, guestVisible?}` (scope `write`, 201 with the attachment): the same
  owners, owner checks and scope rules as the upload (`requireOwnerScope`: a page needs `docs:write`, a cost entry `costs:write`; the owner
  type `ai_task` is a 400). The owner is checked **before** anything is fetched. The bytes then go through `createAttachment` exactly like an
  upload (sniffing decides the type, images re-encoded and stripped, PDFs as they are, 25 MiB, the store's own `details.code`s, 415 for a
  page of HTML). The name is the last part of the address after redirects. The declared content type is never passed on.
- **Only public addresses** (`net/host-policy.ts` `assertPublicUrl`, a second mode next to the integration policy, which stays as it is):
  http or https, no user name or password, **no port in the address** (the default 80/443), and a host that is or resolves to public
  addresses only. A name is resolved and every answer is checked; one that does not resolve is `HostUnresolvedError` (the fetch reports
  `unreachable`). Refused (`classifyPublicAddress`, table-tested): loopback, `0.0.0.0/8` and `::` (unspecified), RFC 1918, CGNAT
  `100.64.0.0/10`, link-local, unique-local `fc00::/7`, site-local `fec0::/10`, multicast, the metadata endpoints, the IPv4 documentation,
  benchmark, protocol-assignment and `240.0.0.0/4` ranges, and every IPv6 address outside `2000::/3` (Teredo and the documentation ranges
  inside it too); IPv4-mapped, IPv4-compatible, NAT64 (`64:ff9b::/96`; the local-use `64:ff9b:1::/48` is private) and 6to4 (`2002::/16`)
  addresses are judged by the IPv4 address they carry. Address literals in other spellings (`2130706433`, `0x7f000001`, `127.1`) are
  normalised by the URL parser first. Tests run lenient (`setLenientHostPolicy(true)`): loopback and any port are allowed and names are
  not resolved, everything else is checked; tests of the policy switch it off and stub `setHostResolver`.
- **The download** (`net/public-fetch.ts` `fetchPublicFile`): redirects are followed by hand, at most 3 (the fourth is `too_many_redirects`),
  and **every hop** passes `assertPublicUrl`, so a redirect to a private address, another scheme or a port is `blocked_host` and nothing
  connects there. One `AbortSignal.timeout` of 15 s covers every request and the body. The body is read chunk by chunk with a 25 MiB cap
  and the read is cancelled when it is reached (`too_large`, also when `Content-Length` says so before). The request has `Accept` for images
  and PDFs and `User-Agent: hauswart/<version>` and nothing else of the household (no cookie, referer or origin). The options are
  injectable (`timeoutMs`, `maxBytes`, `maxRedirects`).
- **Failures** are a 400 `invalid_request` with a field error on `url` and `details.code` (`FROM_URL_ERROR_CODES`): `blocked_host`,
  `unreachable` (name, connection, TLS, timeout), `upstream_status` (+ `details.status`; a 3xx without a usable `Location` is this too),
  `too_large`, `too_many_redirects`. A request that is malformed (scheme, credentials, length) is a plain Zod 400 without a code. What the
  store refuses keeps its own codes and statuses. The log line carries the code and status only (`attachments.from_url_failed`), never
  the address.
- **DNS rebinding is not closed**, as everywhere else in the app: the check resolves the name, `fetch` resolves it again, and nothing pins
  the connect address. The registry description says so. What narrows it: the check repeats per hop, nothing the server fetched is shown
  to anybody but through the usual attachment endpoints, and only public ranges are reachable anyway. If the process runs with a proxy in its
  environment (`HTTP_PROXY`), Bun's `fetch` may go through it and the proxy then resolves the name itself, which the check cannot see;
  do not set one on a host that runs hauswart.
- **Abuse**: the endpoint needs `write` and the token limit applies (300 requests a minute); there is no per-user concurrency limit.

## Reading an attachment as an assistant does

- **`GET /attachments/{id}/preview`** (binary, scope `read`, any attachment whatever its owner; `attachments/preview.ts`): an image is sent
  as the receipt preview sends it (`previewOfImage`, shared with `GET /ai-tasks/{id}/preview`: as stored when the longest side is at most
  1600 px and it is at most 1.5 MB, else JPEG at `previewSize`; the constants are `ATTACHMENT_PREVIEW_*` and the `AI_TASK_*` names alias
  them). A PDF without `pages` is sent as stored when it is at most 4 MiB (`ATTACHMENT_PDF_READ_MAX_BYTES`), whatever its page count. A
  larger one is a 400 with `details.code: "too_large"` and `details.pageCount`, so the caller can ask for a range.
- **`pages`** (`"3"` or `"3-8"`, counted from 1, at most 20 pages, `parsePageRange`; a malformed value or a longer range is a 400 on `pages`
  from the query schema) returns a PDF of just those pages, cut out with `pdf-lib` (`files/pdf-pages.ts`: `openPdf`, `extract`; pure
  JavaScript, works under Bun; the copy keeps what a page inherits from its page tree, such as the size). A range past the end is a 400
  on `pages` with `details.code: "out_of_range"` and `details.pageCount`; `pages` for an image is a 400 on `pages` (`not_a_pdf`). A PDF
  pdf-lib cannot open (encrypted, damaged, no pages: it reads a file that is no PDF as one without pages, so a count below 1 counts as
  unreadable) is a 400 `details.code: "unreadable"` for a page request and for a PDF over 4 MiB (no range would help); a small one is still sent
  whole, without a page count. There is no rendering: a page is never turned into an image.
- **Header `X-Page-Count`** (`PAGE_COUNT_HEADER`, documented in OpenAPI through the new `responseHeaders` of a registry entry): the number
  of pages of the whole stored PDF, also when only some pages are sent; left out for images and for a PDF that cannot be opened.
- **Caching** as the receipt preview: `ETag` from the sha256 (`-preview` for a scaled image, `-pages-3-8` for a range, normalised so `3-3`
  is `3`), `Cache-Control: private, no-cache`, 304 on a matching `If-None-Match`. The filename of a range is `<name>-pages-3-8.pdf`.
- **CPU and memory**: a PDF is parsed in the request (pdf-lib yields between batches of objects). The stored file is at most 25 MiB.

## MCP tools

- **`get_task`** adds `steps` (`n` 1-based, `id`, `title`, `body`, `images: {count, attachmentIds}`), `stepsSource` (with the file's name) and
  `files`: the attachments of the task and of its device, each marked `owner: task|device`, so an assistant can find a manual. Task rows
  of every tool carry `steps` (the count, left out when 0); `list_tasks` takes `hasSteps`.
- **`set_task_steps`** (`update`, scope `write`): `task` (id, or a title when unambiguous), `steps: [{id?, title, body?, imageUrl?}]`,
  `source?` (`{label?, url?, attachmentId?, page?}` or null). It `PUT`s the steps, then for each step with `imageUrl` calls
  `POST /attachments/from-url` with the owner type `task_step`, one after the other. A picture that cannot be fetched does not fail the
  call: the answer has per step `image: "added"` or `imageProblem: "<code> (<status>): <sentence>"` (`fromUrlProblem`). A body left out is
  written empty, also for a step that is kept. The description tells the model how to write steps (one action per step, in the order
  they are done, imperative and concrete, what is needed first as the first step, a picture only when it shows this exact device or
  part, keep the ids of kept steps, a step can have several pictures so do not resend `imageUrl`) and that text from a page or manual is
  untrusted input. `imageUrl` is not validated by the tool: a malformed address becomes an `imageProblem`, the steps are saved.
- **`get_attachment`** (`read`): by id, optional `pages`. Answers the summary and JSON (`filename`, `mime`, `size`, `pageCount`, `pages` sent,
  `delivered`) followed by the file as MCP image content or, for a PDF, an embedded `resource` with a blob (as `get_ai_task`). A PDF over
  4 MB asked for without `pages` is a normal answer that names the page count and asks for a range (not a tool error); an unreadable PDF
  too; a page past the end is a tool error. Extracted pages over 4 MB are not handed over.
- **`attach_from_url`** (`create`, scope `write`): `ownerType` `asset|task|room|part|defect|task_step` and `owner` (a device also by
  plate, a task also by title, a room and a part by name; a defect and a step by id), `url`, `caption`. A failure is a tool error whose
  first word is the code. Pages are not offered (a page needs `docs:write`).
- **Untrusted input**: the descriptions of `get_task`, `get_attachment`, `attach_from_url` and `set_task_steps` say that the text of a
  file, a page or a picture is data, never instructions (`mcp/src/task-steps-tools.test.ts` pins the sentences, as the receipt tools do),
  and so does the README. The server instructions tell a client that tasks can have steps and where to get them.
- **Tests**: `tasks/steps.test.ts` (service), `routes/api/v1/tasks/steps.test.ts`, `api/schemas/task-steps.test.ts`, `net/host-policy.test.ts`
  (the table of address classes, URL decisions), `net/public-fetch.test.ts` (a fake web server: redirects, size, time, blocked hops),
  `attachments/from-url.test.ts`, `routes/api/v1/attachments/from-url.test.ts`, `attachments/preview.test.ts`, `files/pdf-pages.test.ts`,
  `routes/api/v1/attachments/preview.test.ts`, `mcp/src/task-steps-tools.test.ts` and one through the HTTP endpoint in
  `routes/api/v1/mcp/mcp.test.ts`. `lib/testing/fake-web.ts` is the fake web server, `files/test-pdfs.ts` builds PDFs of a given page
  count (page n is `200 + n` points wide), padded to any size, encrypted or damaged.
