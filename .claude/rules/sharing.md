---
paths:
  - "src/lib/server/share/**"
  - "src/lib/server/calendar/**"
  - "src/lib/server/emergency/**"
  - "src/lib/share/**"
  - "src/lib/api/schemas/share.ts"
  - "src/lib/server/api/handlers/{calendarFeeds,guestLinks,emergency}.ts"
  - "src/routes/api/v1/{calendar-feeds,guest-links,emergency}/**"
  - "src/routes/api/public/**"
  - "src/routes/g/**"
  - "src/lib/components/{guest,share}/**"
  - "src/routes/*/emergency/**"
  - "src/routes/*/settings/guest-links/**"
---

# iCal feeds, emergency page and guest links

- **Tokens** (`share/tokens.ts`): 32 random bytes base64url; only the sha256 is stored and looked up
  (indexed by hash, then `timingSafeEqual`). A malformed token is rejected before the database.
  Feeds also keep `tokenEnc` (AES-GCM, `crypto.ts`) so the owner can see the address again (`url` in
  the DTO, only for the owner); guest links store no plaintext: the address is returned once on
  create and rotate. Rotating replaces the hash (old address dead at once); revoking keeps the row
  (hash stays, feed `tokenEnc` is wiped) until `purgeDeadShareLinks` deletes rows revoked or expired
  over 30 days ago (runs with the credential purge).
- **Calendar feeds** (`ical_feeds`; `/api/v1/calendar-feeds`, session only, own feeds only, 10 per
  user): the public address is `/api/public/cal/<token>.ics` (`routes/api/public/cal/[token].ics`,
  outside the registry and OpenAPI, listed as public in the authz inventory). Failures are all the same
  404; limits: 240 requests/min per address, 120/min per feed, and an address that presents 20
  unknown tokens in 15 minutes is blocked (`shareMissLimiter`, peeked before the lookup). Answers with
  `text/calendar`, strong ETag (sha256 of the body) with 304, `private, max-age=900`, `noindex`,
  `no-referrer`. Content (`calendar/feed.ts`): next occurrence of every active, not snoozed task
  with a date (scope `mine` = current assignee is the owner or `assignMode` none; `all` = every
  task; appointments are included too, see "Appointments"); a `min_per_period` window is a multi-day span; estimates only with `includeEstimated`
  (TENTATIVE, `~` prefix, medium confidence, within 45 days, no alarm); preparations as "Vorbereiten:
  ..." on due date minus `leadDays` (not done, not skipped by stock); defect deadlines of open defects
  (a defect's reminder task is skipped: the defect event stands for it); warranty ends within 365
  days. Only titles, places and dates: never task descriptions, notes, comments, secrets. UID
  `task-<id>-<occurrenceKey>@hauswart` (`prep-`, `defect-`, `warranty-` alike), LAST-MODIFIED/DTSTAMP/
  SEQUENCE from the row's `updatedAt` (never from `task_state`, which the evaluator rewrites every
  five minutes), events sorted, so the bytes only change with the content. Alarm = `alarmTime` in the
  household zone, `alarmDaysBefore` days ahead (1 = evening before). Texts are Paraglide messages
  with the feed's locale (`m.key(params, {locale})`).
- **Emergency page**: `GET /api/v1/emergency` (read scope) = emergency + rules pages (member HTML,
  secrets included), emergency contacts (full), `showOnEmergency` assets with pinned hints and `showOnEmergency` insurance policies
  (insurer, policy number, assistance line; a section of the sheet when there are any).
  `GET /api/v1/emergency/export.pdf` is the A4 sheet; secrets only with `?includeSecrets=1|true`
  (then a red confidentiality box on top and "Vertraulich" in the footer). The text of pages and
  hints comes from the markdown renderer's HTML (guest audience = secrets stripped, fail closed),
  turned into paragraphs by `htmlToBlocks`. `emergencyDocument` returns the pdfmake content so tests
  can read what is on the sheet.
- **Guest links** (`guest_links`; `/api/v1/guest-links`, session only, any member manages all):
  `expiresAt` required and at most 90 days away (also on update), `startsAt` optional, `pin` 4 to 8
  digits (argon2id), `includeSecrets`, `sections` (`emergency|rules|contacts|devices|howto`) and
  explicit `pageIds`; `DELETE` revokes. Content is shared only when **both** the flag on the item and
  the link agree: pages need `guestVisible` and a selected page section (emergency, rules, howto) or
  their id in `pageIds`; contacts need `guestVisible` (section `emergency` shows those marked
  emergency, `contacts` all of them, never notes or address); devices (section `devices`) are assets
  with `showOnEmergency` or a guest-visible hint, with only their guest-visible hints; secret blocks
  only with `includeSecrets`. Files (`/g/<token>/files/<id>`) need the attachment's own `guestVisible`
  and an owner the link shows (a shared page, or a guest-visible hint of a listed device); anything
  else is a 404 like a missing file.
- **Public pages** `/g/[token]` (+ `docs/[slug]`, `files/[id]`) are SSR only (`csr = false`, no JS)
  and use `+page.server.ts` loads, not the API (inventory: public). Every request passes
  `guestGate` (address and link limits, token lookup). Unknown, revoked, expired, not-yet-valid and
  PIN-locked links answer the same 404 page (German and English text, no detail); only unknown
  tokens count as guesses. The PIN gate is the form action `default` on the home and docs pages:
  5 wrong PINs per link and address, 10 per link and 20 per address in 15 minutes, 30 wrong PINs in
  a row close the link until a member sets a PIN again (`pinFailures`); a correct PIN sets the
  cookie `hauswart_guest` (path `/g/<token>`, HttpOnly, 12 h at most and never past the expiry), an
  HMAC over link id, PIN-hash fingerprint and expiry (`signValue`), so changing the PIN ends all
  unlocks. The hook adds `Cache-Control: no-store`, `X-Robots-Tag: noindex`, `Referrer-Policy:
same-origin` to everything under `/g/` (the token in the path never leaves the site; browsers still send the
  real `Origin` on the PIN form, and `Origin: null` with `Sec-Fetch-Site: same-origin` is accepted as a fallback, see CSRF). Language
  is the link's `locale` (explicit `{locale}` option, not the visitor's). A visit counts (`viewCount`, `lastViewedAt`) at most every 10 minutes.
  Guest HTML is `renderedHtmlGuest` with `fillGuestToken`; with `includeSecrets` it is rendered live
  (60 s in-memory cache). Rendered HTML is the only `{@html}` (`components/guest/guest-html.svelte`).
