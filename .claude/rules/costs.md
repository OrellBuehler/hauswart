---
paths:
  - "src/lib/server/costs/**"
  - "src/lib/server/finance/**"
  - "src/lib/money.ts"
  - "src/lib/costs/**"
  - "src/lib/api/schemas/{costs,cost-books,settlements,finance}.ts"
  - "src/lib/server/api/handlers/{costs,cost-books,settlements,finance}.ts"
  - "src/routes/api/v1/{costs,cost-books,settlements,finance}/**"
  - "mcp/src/tools/{costs,cost-books,finance}.ts"
---

# Costs and finance providers

- **Cost entries** (`cost_entries`, domain data shared by the household): `bookId` (see "Cost books"), `date`, `title`,
  `amountMinor` (positive = expense, negative = refund, never 0) + `currency`, `category`
  (`repair|utilities|renewal_fund|purchase|mortgage_interest|mortgage_principal|insurance|renovation|maintenance|fuel|taxes_fees|groceries|household|dining|leisure|travel|health|gifts|transport|subscriptions|other`;
  the everyday ones count as an expense by default like all but `mortgage_principal`),
  optional asset, room, defect and service log entry (a service log entry or defect fills in
  asset/room when none is given; deleting the target only unlinks), `payee`, `notes`,
  `paidByUserId`, `splitMode`, `countsAsExpense`, `deductible` (`unknown|maintenance|investment|no`: the
  Swiss tax distinction between value-preserving and value-increasing work; only for tax relevant books, see
  "Cost books"), `source`
  (`manual|finance_transaction|finance_bill|recurring`), `tags` and `recurrenceId` (see "Tags, budgets and recurring costs"), `financeLinked`. `countsAsExpense` defaults to false for
  `mortgage_principal` (equity, not a cost) and follows a category change unless the person overrode it.
  Entries can be commented on and carry receipts (attachments, owner `cost`). `reviewNeeded` (with `reviewedAt` and
  `reviewedByUserId`; migration `0028`) says that a person still has to look at the entry: the receipt queue sets it on what an
  assistant booked, `POST /costs/{id}/review` (scope `costs:write`, any member) clears it and records who and when, and
  reviewing an entry nobody has to review changes nothing (the first reviewer stays). It changes no total, split or balance.
  `POST /costs` takes an optional `idempotencyKey` (8 to 128 characters, migration `0029`, unique per person who books whatever credential they
  use, exactly like `POST /settlements`): a retry returns the first entry with 200 instead of 201, the same key for another entry (amount,
  currency, category or title; book, date or payer when the retry names them; notes, payee and device do not count) is a 409, and the key is
  free again once the entry is deleted (`recordCost`; `createCost` stays the plain booking, also used by the finance inbox and the fuel log).
  **The 409s say which they are** (`error.details.code`, `COST_CONFLICT_CODES` in `enums.ts`, built by `costConflict` in `costs/conflicts.ts`):
  `idempotency_key_reused` (also on `POST /settlements` and `POST /ai-tasks`), `suggestion_decided` (the suggestion named by `financeSuggestionId` is
  accepted or dismissed already, or its transaction is booked; also on accepting and dismissing a suggestion), `entry_tied` (`PATCH` of an entry that
  is tied to a finance item already, and accepting a link to such an entry) and `receipt_task_closed` (with `details.status`). A 409 without a code (the
  fuel log lock has `details.fuelLogId`, a book that still has entries carries its counts) is told apart by its other details. The client reads the code with
  `costConflictCode` (`lib/costs/conflict.ts`), so `isKeyConflict` and `tieRefused` no longer guess from the status and from what the form sent.
  `GET /costs?reviewNeeded=true|false` filters; `GET /costs/summary` carries `reviewNeededCount` (the entries of its own scope: the year
  and the asset or book if one was asked for, any currency, expense or not) and the dashboard `reviewNeededCount` (every year and book).
  The fuel log of a vehicle books its
  fills as `fuel` entries (see "Vehicles"); such an entry carries `fuelLogId` and keeps its amount, currency, date and
  device and its existence in step with that fill (`updateCost`/`deleteCost` refuse with 409 `conflict`,
  `details.fuelLogId`; everything else stays editable).
- **Split math** (`money.ts` `allocate`, `costs/split.ts`): shares are frozen per entry in
  `cost_entry_shares` (basis points, sum exactly 10000), so a later ownership change never rewrites
  history. `ownership` weighs people by `users.ownership_bps` (normalised, 0% pays nothing, all zero
  falls back to equal), `equal` weighs everybody the same - or only the `participantIds` (create and PATCH;
  household members, each once, 1 to 20; refused for any other mode with a 400 on `participantIds`; a
  PATCH with `participantIds` and no `splitMode` needs the entry to be `equal` already), `custom` takes
  explicit shares (sum 10000), `none` is not shared. There is no stored participant list: the frozen shares are
  the participants (a person who joins later bears nothing of an old entry). A person's part of an amount is the
  largest-remainder split of its absolute value (parts add up to the amount exactly; a refund splits exactly like
  the expense it reverses); ties go to the earlier user id. An omitted `splitMode` on create is the book's
  default split. PATCH with `splitMode` ownership/equal splits again by today's shares (`equal`: everybody);
  changing only the amount keeps the frozen shares.
- **Cost books** (`cost_books`, migration `0026`; `costs/books.ts`; `/cost-books`, reads `read`, writes `costs:write`): the
  ledgers entries are booked into. `name` (60, unique without regard to case, umlauts included: `nameKey`), `slug`, `icon` (a key the client maps),
  `defaultSplitMode` (`ownership|equal|none`), `taxRelevant`, `archivedAt`, `sortOrder`. The migration creates Wohnung
  (tax relevant, `ownership`), Haushalt and Auto (`equal`) and puts every earlier entry into Wohnung. SQLite cannot
  add a NOT NULL reference to a table with rows, so it rebuilds `cost_entries`; it was written for a migrator with foreign
  keys on, where `DROP TABLE` cascade-deleted `cost_entry_shares` and nulled the fuel log links, so both are set aside and
  restored and the delete triggers are created again. It is the one migration that still runs with foreign keys on
  (`MIGRATIONS_WITH_FOREIGN_KEYS` in `migrator.ts`); every other one runs with them off (see `migrations.md`), and
  `migrations.test.ts` pins both. `cost_entries.book_id` is NOT NULL, `ON DELETE RESTRICT`. **The default book** (`defaultCostBook`,
  `isDefault` in the DTO) is the book flagged `cost_books.is_default` (migration `0027`, which flagged the book that was
  the first one not archived), where an entry without `bookId` goes (so does an accepted finance suggestion and a fuel
  log's cost entry of a vehicle that remembers no book). Exactly one book that is not archived has the flag (a partial
  unique index and the service keep it so): `PATCH /cost-books/{id}` with `isDefault: true` (also on create) moves it in one
  transaction, `isDefault: false` on the default is a 409, an archived book that stays archived cannot get it (400 on
  `isDefault`), archiving or deleting the default hands it to the first book that is still open, restoring a book does not
  give it back and **reordering never moves it**. The last book that is not archived can be
  neither archived nor deleted (409), so there always is one. A book with entries or payments cannot be deleted (409,
  `details.entryCount`/`settlementCount`): archive it, which closes it to new entries (400 on `bookId` when creating
  or moving into it; an entry may stay and be edited) while it still counts in the balances. **Tax class**:
  `deductible` other than `unknown` is a 400 on `deductible` in a book that is not tax relevant (the entry's own value
  may be repeated); moving an entry into such a book resets it to `unknown` unless the request sets it; switching
  `taxRelevant` off keeps what entries say, and `byDeductible` of the summary counts tax relevant books only. `bookId`
  filters the list, `GET /costs/summary` (every number is then that book's) and the CSV; a `bookId` that names no book is
  a 404 on all of them (and on the balances and on `GET /settlements`), never an empty answer. The entry DTO carries `bookName` and
  `bookTaxRelevant` (whether `deductible` means anything for it). **Moving entries**: `PATCH /costs/{id}` with `bookId` moves one; `POST /costs/move-to-book {bookId, ids | assetId}`
  (scope `costs:write`, `costs/move.ts`) moves up to 500 named entries or every entry of a device, all or nothing in one
  transaction (an unknown id is a 400 on `ids`, an unknown device on `assetId`, an unknown or archived target on
  `bookId`), answers `{bookId, moved, unchanged, deductibleReset, dryRun, years}` and changes the ledger only: split, payer and frozen
  shares stay, a tax class the target book cannot have is reset. **`dryRun: true`** does everything but write (the same
  checks, the same counts; `dryRun: true` comes back) and `years` is `{from, to}`, the first and last year of the dates of
  the entries that move or would (null when none does), so a client can say "23 Einträge aus 2024–2026, 5 verlieren ihre
  Steuerklasse" before a move of a whole device is confirmed. Entries a fuel log entry booked may move too (their lock
  covers amount, currency, date and device only).
- **Currency**: entries may be in any currency, but every total, the settlement and the dashboard
  count the household currency only; `otherCurrencyCount` says how many entries were left out (the CSV
  has them all).
- **Summary** (`GET /costs/summary?year=&assetId=&bookId=`): `expenseTotalMinor` and the per category / month (always 12) /
  asset (top 10) / tax class breakdowns count entries with `countsAsExpense`; `equityTotalMinor` is the rest. With an
  `assetId` or `bookId` every number in it, the settlement included, is that asset's or book's alone. It is a
  year of entries: recorded payments are not in it (and so not in the dashboard's `costsYearToDate`).
  **Settlement** covers every split entry with a payer, equity included (it is about who paid cash):
  `balanceMinor` = paid - share (positive = the others owe this person), `settlement` = greedy payments
  from the largest debtor to the largest creditor ("A owes B CHF x"). Split entries without a payer are
  counted in `unassignedPayerCount`, never guessed. The dashboard carries `costsYearToDate`, `balances` and `pendingFinanceSuggestions` (the
  caller's own pending offers, shown as a card linking to the inbox). **`costsYearToDate`** answers "what did the year
  cost" and nothing else: `totalMinor` and `byCategory` (top three) over all books together plus `byBook` (per book,
  largest first, only books with an expense this year, archived ones too, each with `taxRelevant` so a client can tell the
  apartment from the everyday books); household currency, entries that count as an expense, the same numbers as
  `costsSummary` (a test pins it), grouped in SQL without a ledger. It no longer has a `settlement`: a year of entries
  knows nothing of recorded payments, so it would have disagreed with the balance. **`balances`** answers "where do I
  stand": `{currency, myBalanceMinor, hasActivity, suggestedPayments (the first three, between any two people),
suggestedPaymentCount}`, the caller's own place across all books with recorded payments included, from one read of the
  same ledger as `GET /costs/balances` (four queries however many entries there are; a test pins that). It is one of two
  parts of the dashboard that may fail on their own (`orNull` in the handler): when it cannot be worked out the handler answers `balances: null`
  (the schema is nullable) and logs `dashboard.balances_failed` with the error's name and code, so the tasks and the
  rest of the dashboard still open. The other is **`budgetAlerts`** (`dashboardBudgetAlerts`, `costs/budgets.ts`): `{exceeded, warning, top}` from the
  status of today's month and year (the same numbers as `GET /costs/budgets/status`), `exceeded` and `warning` counting the active budgets over their amount and from 80 % up, `top` the most
  urgent three (exceeded before warning, then the higher share used, then the order they were made in; each with book, category, period, amount, spent, `percentUsed`, `state`); household data, the same for every member; all zeros and `top: []` while every budget is
  within its amount, `null` and `dashboard.budget_alerts_failed` when it cannot be worked out.
- **Settlements and balances** (`settlements`, migration `0026`; `costs/settlements.ts`, `balances.ts`, `ledger.ts`;
  `/settlements`, `GET /costs/balances`): a settlement is a payment between two members ("Ben paid Anna 50"):
  `fromUserId` differs from `toUserId` (both members, else 400 on the field), `amountMinor` is positive (also a CHECK),
  `currency` defaults to the household's, then `date`, `note`, and `bookId` (null = across all books; the book may be
  archived, paying back a closed trip is the normal order). It is **not a cost**: no expense total counts it, it only
  moves the balances. Users cannot be deleted, so its user foreign keys are `RESTRICT`. `POST /settlements` takes an
  optional `idempotencyKey` (8 to 128 characters, migration `0027`, unique per person who records whatever credential
  they use): a retry returns the first payment with 200 instead of 201, the same key for different people, amount, currency
  or book is a 409 (date and note do not count), and the key is free again once the payment is deleted
  (`recordSettlement`). `GET /costs/balances` is all
  time: per member `paidMinor - shareMinor + sentMinor - receivedMinor` (`sentMinor` = payments handed over, a positive
  balance = the others owe this person, zero-sum per currency), household currency only (`otherCurrencyCount` = entries
  and payments left out, `unassignedPayerCount` as in the summary) and `suggestedPayments` from the same greedy `settle`
  as the year summary. With `bookId`: that book's entries and its own payments (payments across all books cannot be
  attributed and stay out; `crossBookSettlements: {count, totalMinor}` says how many of them there are, household
  currency, null for the view of all books); with `all=true` or no parameter: every book, archived ones and payments
  across all books included; `bookId` with `all=true`, or `all=false` without a book, is a 400, an unknown book a 404. `ledger.ts`
  (`bookEntry`, `bookSettlement`, `personBalances`) is the one place paid/share are added up, for the summary and the
  balances alike.
- **CSV** (`GET /costs/export.csv?year=&bookId=&tagId=`, binary `text/csv`): UTF-8 with BOM, `;` separated, CRLF,
  fixed English column names (`costs/csv.ts` `CSV_COLUMNS`; columns are only ever added at the end, `tags` is the
  last, after `book`; the file of one book is named `hauswart-costs-<year>-<book slug>.csv`), amounts as plain decimals with a point, no
  thousands separator and the currency's own precision (`-12.50`, `1500` for JPY) so they parse the same
  everywhere; text cells that start with `= + - @` tab or CR get an apostrophe (formula injection).
- **Recent categories** (`GET /costs/recent-categories?bookId=`, scope `read`; `costs/recent-categories.ts`): how often each category was used by the newest
  100 entries of each book (`RECENT_CATEGORY_ENTRIES`, newest = the list's order, every entry, archived books too) as rows `{bookId, category, count}` per
  book in the order of the books, most used first; with `bookId` that book alone (404 when it does not exist). It is what the quick entry ranks its category
  chips by (`rankCategories` adds the counts) instead of reading a hundred whole entries.
- **Defects and service log entries** carry `costs: {totalMinor, count}` (correlated subqueries in the
  list select, household currency, refunds netted); their legacy `costEntryId` column is unused.
- **The inbox** (`finance_suggestions`): what a finance provider offers one person - `cost`, `asset`, `bill_task` or
  `link` (see "Matching with entries made by hand") - with the status `pending|accepted|dismissed` and a payload shaped like the API's. It is
  **private to its owner**: the list, accept and dismiss only ever select `user_id = caller`, another
  person's id is a 404 exactly like a missing one, and the finance address of an entry
  (`providerUrl`) is shown only to the person who booked it. `(connection, kind, ref)` is unique: a
  seen item keeps its status (a dismissed one stays dismissed, an accepted one never changes, only a
  pending one takes a fresher payload). A cost suggestion's payload may carry `bookId`, the cost book the
  connection's settings offer for it (the accept dialog preselects it; the API shows null once that book is archived or
  deleted, and legacy payloads without it read as null). Accepting books the cost (paid by the owner, into the book the body
  names, else the one offered with the suggestion while it is open, else the default book, and
  split as it says unless the body overrides book (`bookId`), category, title, asset/room/defect/service log,
  payer, split, participants, expense flag, deductible), creates the asset (with `externalSource: finance_transaction`; the cost of the same
  transaction gets the asset, in either order) or the bill task, in one transaction. A cost booked from a
  provider item remembers it (`providerConnectionId` + `providerRef`, unique) so it is never booked twice,
  even after the entry is deleted.
- **Provider seam**: an adapter calls `registerFinanceProvider({kind, sync})`; `POST /finance/sync` runs
  the caller's own connection now (404 without one, a provider failure is a normal `ok: false` answer).
  `GET /integrations/{kind}/categories|accounts` are pickers for the caller's own connection.
- **Back-links** are the provider's business but the bookkeeping is generic: a provider entry has
  `providerLinkId` and `linkSyncedAt` (null = to write; set again to null when title or asset change); a
  deleted entry with a written link queues a `cost_link_removals` row in the same transaction; the core
  emits `financeLinksPending`. Failures stay queued and are retried by the next sync.
- **Bill tasks** (`finance/bill-tasks.ts`): a task with `externalSource: finance_bill`, `externalRef:
<connectionId>:<billId>` (the connection in the reference keeps two people's bills apart), category
  `payment`, assigned to the connection's owner (fixed, notify the assignee), trigger `kept_bill`
  (`status` open/overdue/paid/cancelled). A paid bill completes it with a system completion
  (`source` = the provider's name, no user; none if a person already settled the occurrence `bill:<id>`), a bill
  that becomes payable again revokes that system completion only (never one a person recorded), a cancelled bill
  settles it without a completion, archived tasks are never touched again, bills without a due date are
  skipped. The task is **visible to the whole household** with creditor, invoice number, amount and due
  date: that is what the person consents to by switching `billTasks` on. The description carries what is still
  to pay while the bill needs paying, the invoiced total once it is settled. The address of the bill in the
  finance app (`externalUrl`) is **not** part of that consent: the task endpoints return it only to the person
  whose connection the task follows (`billUrlVisibility`), `null` for everybody else; the task page shows
  "open in finance app" for that person. Title, description, due date and status are overwritten at every sync
  (the task form says so); deleting the task of a still open bill makes the next sync create it again, so the
  delete dialog points to archiving, which is respected. Housekeeping archives tasks
  settled for 90 days and those of a deleted connection.
