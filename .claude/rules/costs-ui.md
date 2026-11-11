---
paths:
  - "src/routes/*/costs/**"
  - "src/routes/*/settings/cost-books/**"
  - "src/routes/*/settings/cost-tags/**"
  - "src/lib/components/costs/**"
  - "src/lib/components/dashboard/**"
  - "src/lib/costs/**"
  - "src/lib/attachments/receipt-*.ts"
  - "src/lib/idempotency.ts"
  - "src/lib/reorder.ts"
---

# Costs in the web app

- **Costs in the web app** (books, balances, settlements): the address carries the book, `/costs?book=<id>|all`. The address wins; without
  one the book the person looked at last applies (localStorage `hauswart:cost-book:<user id>`, `book-memory.ts`, written by an effect once the
  address names a book). `chooseBook` (`lib/costs/books.ts`) decides in the load, which `redirect(307)`s to the explicit address (on a hard
  reload that is a native navigation, SvelteKit's own rule for a redirect that only the browser can make); an address that narrows by device,
  room, search ... (`narrowsBeyondBook`) ignores the memory, so `/costs?asset=` still shows that device's costs. `book` goes to the list,
  summary, CSV and balances (`costsQuery`, `costsSummaryQuery`, `costsExportQuery`, `balancesQuery`). `BookSwitcher` is a row of links (a
  scrolling row on phones that keeps the book on screen in view), the second summary card is the running balance (`BalanceOverview`, from
  `GET /costs/balances`; the year's settlement of the summary is no longer shown, it ignores recorded payments). `/costs/balances` is the Saldo
  page: balance per person with paid / share / payments sent / received, suggested payments with "Als bezahlt erfassen" (opens
  `SettlementDialog` prefilled by `draftFromSuggestion`: book = the one on screen or all books, so the person only confirms or edits), a
  dismissible note "settled before?" while no payment was ever recorded, and the recorded payments (year and person filters, edit, delete).
  Balances are worded, never signed (`balanceWording`, `youWording`, `viewerLine`: "bekommt" / "schuldet"). Books are managed under
  `/settings/cost-books` (create, edit, icon, default split, tax relevant, move, archive, restore, delete; a 409 is worded from `details`
  by `bookConflictMessage`), "new book" is also a chip on the costs page. The cost form picks the book first (`BookPicker`: buttons up to
  four books, else a select); a new entry takes the book's default split until the person chose a split (`withBook`, `splitAfterBook`); "Für wen"
  are member checkboxes of an equal split (`participants`, sent as `participantIds` only when narrowed, and a PATCH sends `splitMode: "equal"`
  again when the set changed); the tax class is only offered, and sent, for a tax relevant book (`taxClassApplies`). The inbox's accept dialog
  has the same picker and checkboxes. The dashboard's `CostsCard` reads `dashboard.balances` ("Du bekommst / Du schuldest" across all books, the first three payments and how many more there are, no request of its own; `null` shows "Der Saldo konnte nicht geladen werden." under the year's costs) and labels the year total "Ausgaben 2026, alle Bücher" with the per-book list of `costsYearToDate.byBook` under it;
  `tryLoadBalances` lets a page open when only the balances fail (the card says so).
  `chooseBook` never hands on an id the server would 404 on; a remembered book that was deleted comes back as `staleMemory`, and the loads forget it (`forgetBook`).
  The single-book balance cards and the Saldo page name the payments across all books they leave out (`crossBookNote`, from `crossBookSettlements`). The tax card measures its rows against
  the sum of `byDeductible` (`taxTotal`, tax relevant books only), not against the year's expenses. The "Für wen" preview of an equal split divides the basis points first and the amount by those (`equalPreview`),
  so it shows what the server books (300.00 among three: 100.02, 99.99, 99.99). Under `/settings/cost-books` a book that takes entries gets "Als Standard festlegen" (`isDefault`; the badge follows it, reordering never moves it).
  Reordering (rooms, books, hints) goes through `lib/reorder.ts`: `saveOrder` waits for every request, a failed one included, then refreshes, so the order shown is the server's.
  **Moving entries**: "Auswählen" on the list (checkboxes in the cards and the table, a sticky bar with the count, at most 500) and, on a list narrowed to a device, "Alle Einträge dieses Geräts verschieben"
  open `MoveCostsDialog` (`POST /costs/move-to-book`; `moveSummary` words moved / unchanged / tax class reset, `moveFailure` the 400s; for a device it first asks a dry run for the chosen book, again whenever the book changes, and shows `movePreview` above the buttons - a failed preview is worded and does not block the move). **Vehicles**: the asset form's "Kostenbuch" picks `costBookId` (every save sends it, a PUT would clear it),
  `VehicleCard` names the book, the fuel dialog offers a book (the vehicle's while it takes entries, else the default; a new fill takes that book's split; no "Für wen", the fuel API has no participants) and the list shows each fill's `bookName`.
- **Quick entry, receipts and the review flag in the web app**: `/costs/quick` is for one hand on a phone (no bottom bar, a sticky save bar of its
  own; the costs page's round button leads there, the dashboard's costs card and the home screen shortcuts too; `?book=` names the book, `?mode=receipt`
  opens on the receipt). The load reads nothing from the address (`untrack`), so the mode switch and `?book` fetch nothing again. **Expense**: a big
  amount field (`inputmode="decimal"`, the household currency, "12." and "12,5" read as typed), book chips (`chooseQuickBook`: the address, then the
  book of the last quick entry - `loadQuickBook`, kept apart from the costs page's remembered book -, then that one, then the default; up to five
  open books as chips, else a select), category chips ranked by `rankCategories` (the book's recent entries first, then all recent entries, then a
  fixed order, the apartment's for a tax relevant book; the form asks `GET /costs/recent-categories` once it is on screen - `loadRecentCategories`, not part of the page load,
  and the chips keep their fixed order without it or once a category was picked), eight
  shown and "more" for the rest, none chosen at the start; payer chips (default me); "für wen" chips: as the book has them (everybody, nobody for a
  book that does not share) sends no split so the book's own applies, any other choice is `equal` among the ticked (`quickSplit`). **Nobody ticked is not guessed**: in a book that shares it is `unchosen`
  (a warning under the chips, the save refused with an error on `participants`) until the person ticks somebody or taps the chip "Nicht teilen" (`notShared`, which
  sends `none`; ticking a person ends it); in a book that does not share, nobody ticked is the book's own "not shared" and the chip is on. A sentence under the
  chips says what the chips mean. Date, payee, title (empty = payee, else the category) and device sit behind "Datum, Titel und
  mehr" (an error on any of them opens the section, `needsMoreSection`, and the device shows its error like the others). `POST /costs`, then `uploadAttachment` (owner `cost`): done = `/costs?book=` plus a 10 s toast with "Rückgängig" (`DELETE`) and "Noch eine";
  a failed upload keeps the entry and offers retry, "ohne Beleg fertig" and undo. **Every draft has a key** (`newIdempotencyKey()`,
  `lib/idempotency.ts`; sent as `idempotencyKey` with `POST /costs` and `POST /ai-tasks`): a save that got no answer is simply tried again with
  the same key (the words say so: the entry is not booked twice), the key is renewed after the entry is booked and when the server answers
  409 `idempotency_key_reused` (the key stands for another entry: "look in the list"; a 409 `suggestion_decided` spends no key, it releases the
  bank transaction and says so under the list), and the receipt's key also when another photo is picked; the receipt's
  network error says that nothing is booked and links to `/costs/receipts`. Mistakes are cleared as the field changes. **Receipt**: `ReceiptPicker` (camera button
  with `capture="environment"` only on touch, in CSS so hydration does not move the page; any image or PDF in the file picker). A HEIC photo is
  turned into a JPEG through a canvas where the browser decodes it (`prepareReceiptFile`, Safari; the decision `heicPlan` is tested, the canvas is
  not) and refused with the server's `attach_error_heic` wording otherwise. **Receipt only** (`POST /ai-tasks`, multipart, optional note, book and
  device hints) ends on the page `/costs/receipts` with a toast offering undo (`DELETE /ai-tasks/{id}`): open tasks are always read completely and
  listed first (`mergePendingFirst`), the history comes 30 at a time ("Mehr laden"), `?status=` filters; each row shows the thumbnail (the lightbox
  for pictures, a new tab for a PDF), uploader, note, hints, for a done task the booked entries as links with their "Zu prüfen" mark, for a dismissed one the
  reason; anybody may dismiss (reason optional, final), deleting is for the uploader and administrators (`canDeleteTask`). The wording says receipts are
  "über die MCP-Verbindung verbucht". **Review flag**: `CostFlags` shows "Zu prüfen", the detail page a notice with the button "Als geprüft markieren" (`POST /costs/{id}/review`; "Geprüft" stays the word for an entry that was reviewed)
  and who reviewed when, the costs page a "Zu prüfen" chip (`?review=1`; `?year=all` lists every year and is only honoured with the review filter,
  because that list is short), a notice under the summary that links to the entries it counts (`reviewFilters`) and the dashboard a card for
  `reviewNeededCount` that opens `REVIEW_ALL_HREF` (every book and year).
- **Tags, budgets, recurring costs and bank matching in the web app**: **Tags** are managed under `/settings/cost-tags` (name and one of the nine palette colours, `TAG_COLOR_STYLES`;
  deleting names the entry count) and carried as `tagIds`. `TagPicker` (toggle chips, at most 10; `creatable` makes a tag by name on the spot in the least used colour) sits in the cost form, the
  recurring cost form and the accept dialog; the quick entry shows it only when tags exist. `TagChips` shows them on rows and the detail page. The costs page filters by `?tag=` (`CostFilters.tagId`;
  `withKnownTag` drops a tag that no longer exists, which the API answers with a 404): list, summary and CSV follow it, the balances do not (the note under the summary says so). **Budgets** have their own
  page, `/costs/budgets?period=month|year&year=&month=` (it measures a month or a year by itself, not the list's filters): active budgets of one period type, the ones needing attention first
  (`itemsForPeriod`), each with a bar, the state as a word and an icon (never colour alone), what is left or the overspend, and a link to the entries it measured (`budgetEntriesQuery`). The dashboard's
  costs card adds one line when a budget is almost used up or exceeded (from `dashboard.budgetAlerts`, no call of its own; nothing when it is null). **Recurring costs**: `/costs/recurring` (active, paused, finished), `/[id]` (rhythm,
  next three dates - `RecurrenceUpcoming`, which for a paused one lists none and says it goes on from the next date when resumed -, template) and `/new`, `/[id]/edit` with `RecurrenceForm` (the entry's draft without date plus the rule; `splitPatch` is shared with the entry form; the payer defaults to the person).
  `RecurrenceControls` runs pause, resume and "Jetzt buchen" (enabled only for a due booking, `isDue`: the API never books ahead). `ruleWording` words the rule, `clampNote` explains month-end clamping, and
  `RecurrencePreview` adds the next three dates and, while saving books something, "Bucht sofort n Einträge seit ..." (`immediateBookings`, at most `RECURRENCE_BOOKING_CAP` = 120 per run). An entry's
  "Wiederkehrend" badge links to its recurring cost on the detail page. **Bank matching**: `FinanceMatches` (cost form, quick entry) asks `GET /finance/matches` 400 ms after amount, currency and date are
  valid (`matchQuery`), only for a person with a working finance connection (`tryLoadFinanceConnected`); the chosen transaction goes along as `financeSuggestionId` and is released when the entry stops fitting
  it (`matchFits`) or the server refuses it (`tieRefused`), which asks again and says why. In the inbox a `link` suggestion shows the transaction and the matching entry; "Nicht verknüpfen" dismisses it.
