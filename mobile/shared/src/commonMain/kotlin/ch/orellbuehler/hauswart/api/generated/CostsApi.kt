// Generated from docs/openapi.json by `bun run mobile:api`. Do not edit.
@file:OptIn(ExperimentalSerializationApi::class)

package ch.orellbuehler.hauswart.api.generated

import ch.orellbuehler.hauswart.api.ApiHttp
import ch.orellbuehler.hauswart.api.BinaryBody
import ch.orellbuehler.hauswart.api.Patch
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.nullable
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonClassDiscriminator
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

class CostsApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * List cost entries
     *
     * Newest first by date. Filter by book (`bookId`; an unknown book is a 404, not an empty list), year or a date range (`from`/`to`), category, asset, room, defect, who paid (`paidBy`, a user id or `me`), whether a person still has to review the entry (`reviewNeeded=true|false`), the tag it carries (`tagId`; an unknown tag is a 404) and a search text over title, payee and notes. Amounts are minor units of the entry's currency: positive = expense, negative = refund. Every entry carries its book and whether that book is tax relevant (`bookTaxRelevant`) and its tags.
     *
     * @param category repair | utilities | renewal_fund | purchase | mortgage_interest | mortgage_principal | insurance | renovation | maintenance | fuel | taxes_fees | groceries | household | dining | leisure | travel | health | gifts | transport | subscriptions | other
     */
    suspend fun costsList(
        cursor: String? = null,
        limit: Long? = null,
        bookId: String? = null,
        year: Long? = null,
        from: String? = null,
        to: String? = null,
        category: String? = null,
        assetId: String? = null,
        roomId: String? = null,
        defectId: String? = null,
        paidBy: String? = null,
        tagId: String? = null,
        reviewNeeded: Boolean? = null,
        q: String? = null,
    ): CostsListResponse =
        http.json("GET", "/api/v1/costs", listOf("cursor" to cursor, "limit" to limit, "bookId" to bookId, "year" to year, "from" to from, "to" to to, "category" to category, "assetId" to assetId, "roomId" to roomId, "defectId" to defectId, "paidBy" to paidBy, "tagId" to tagId, "reviewNeeded" to reviewNeeded, "q" to q), CostsListResponse.serializer())

    /**
     * Book a cost
     *
     * `bookId` defaults to the default book (`isDefault` in `GET /cost-books`; an archived book is a 400 on `bookId`), `currency` to the household's, `date` to today. `splitMode` defaults to the book's default split: `ownership` divides by the people's current ownership shares, `equal` equally among everybody or, with `participantIds`, among those household members only (each listed once), `custom` by `shares` (basis points, sum 10000), `none` does not split; `participantIds` with any other split and `shares` with any other than `custom` are a 400. The shares are frozen with the entry; the parts add up to the amount exactly (largest remainder, ties to the earlier user id). `countsAsExpense` defaults to false for a mortgage repayment (equity), else true. `deductible` other than `unknown` needs a tax relevant book (400 on `deductible` otherwise). `tagIds` label the entry with tags (`/cost-tags`; 400 on `tagIds` for one that does not exist). A finance provider's transaction is booked by accepting its suggestion; `financeSuggestionId` instead ties an entry you book by hand to one of your own pending cost suggestions from the finance app (`GET /finance/matches` finds them): in the same transaction the suggestion is accepted and the entry remembers the transaction, so it is never booked twice and its back-link is written (404 for a suggestion that is not yours, 400 on the field when it is not a cost or its amount or currency differs from the entry's, 409 when it is decided already). Without `financeSuggestionId`, when exactly one of the payer's pending cost suggestions looks like the new entry (same amount and currency, at most 3 days apart, similar text) it becomes a `link` suggestion to this entry in the same transaction (a recurring booking does the same); nothing is accepted by itself, and several fitting suggestions change nothing. `receiptTaskId` books the entry for a task of the receipt queue (`/ai-tasks`): in the same transaction the entry is flagged `reviewNeeded` and recorded on the task (`bookedSoFar` of `GET /ai-tasks/{id}`, `receiptTaskId` on the entry), so an interrupted client or another one sees what is booked already; an unknown task is a 400 on the field, a task that is done or dismissed a 409 `conflict` (`details.status`). A repeated `idempotencyKey` (8 to 128 characters; unique per person who books, whatever credential they use) returns the first entry with status 200 and books nothing; the same key for a different entry (amount, currency, category, title or receipt task, or book, date or payer when the retry names them) is a 409 `conflict`; once the entry is deleted its key is free again. Send one per attempt to save, and keep it for a retry that got no answer. A 409 `conflict` carries `details.code` so a client does not have to guess: `idempotency_key_reused` (the key stands for another entry), `suggestion_decided` (the suggestion named by `financeSuggestionId` was accepted or dismissed already, or its transaction is booked) or `receipt_task_closed` (the receipt task is not waiting any more; `details.status`). A refused request books nothing and spends no key.
     */
    suspend fun costsCreate(
        body: CostsCreateRequest,
    ): CostEntry =
        http.json("POST", "/api/v1/costs", emptyList(), CostsCreateRequest.serializer(), body, CostEntry.serializer())

    /**
     * Costs of a year: totals and settlement
     *
     * Totals per category, month and asset (top ten) and per tax class count entries in the household currency that count as an expense; mortgage repayments are reported as `equityTotalMinor`; the tax classes count the entries of tax relevant books only. `people` and `settlement` cover every split entry with a payer of the year: `balanceMinor` = paid - share, and `settlement` lists who pays whom to square the balances. Recorded payments (`/settlements`) are not part of a year: the running balance with them is `GET /costs/balances`. With `assetId`, `bookId` or `tagId` only the entries of that asset, book or tag are counted; a `bookId` or `tagId` that names nothing is a 404.
     */
    suspend fun costsSummary(
        year: Long? = null,
        assetId: String? = null,
        bookId: String? = null,
        tagId: String? = null,
    ): CostsSummary =
        http.json("GET", "/api/v1/costs/summary", listOf("year" to year, "assetId" to assetId, "bookId" to bookId, "tagId" to tagId), CostsSummary.serializer())

    /**
     * The categories the newest entries used
     *
     * How often each category was used by the newest 100 entries of each book (`entriesPerBook`), as rows `{bookId, category, count}` per book in the order of the books, most used first: what a form needs to offer the likely categories first without reading whole entries. Every entry counts, refunds and other currencies too; archived books are included. With `bookId` only that book is answered (a book that does not exist is a 404). Read scope.
     */
    suspend fun costsRecentCategories(
        bookId: String? = null,
    ): RecentCategories =
        http.json("GET", "/api/v1/costs/recent-categories", listOf("bookId" to bookId), RecentCategories.serializer())

    /**
     * Move cost entries to another book
     *
     * Moves the entries in `ids` (1 to 500) or every entry of the device `assetId` into the book `bookId`, all or nothing in one transaction; give exactly one of `ids` and `assetId` (400 on `ids` otherwise). The book must be open (400 on `bookId` for an unknown or archived one), an unknown id is a 400 on `ids` and nothing moves, an unknown device a 400 on `assetId`. Entries already in the book are counted as `unchanged`. An entry keeps its split, payer and frozen shares: moving changes which ledger it counts in (summaries, balances, the book's CSV), not who bears it. Entries booked by a fuel log entry move too (the fill owns their amount, currency, date and device only). Moving into a book that is not tax relevant resets a tax class other than `unknown` to `unknown` (`deductibleReset` counts them). With `dryRun: true` nothing is written: the same checks and the same numbers come back with `dryRun: true`, `moved` and `deductibleReset` saying what a move would do and `years` the first and last year of the dates of the entries that would move (null when none would), so a client can show "23 entries from 2024-2026, 5 lose their tax class" before the person confirms. A real move answers `dryRun: false` and the same `years` of what it moved.
     */
    suspend fun costsMoveToBook(
        body: CostsMoveToBookRequest,
    ): MoveCostsToBookResult =
        http.json("POST", "/api/v1/costs/move-to-book", emptyList(), CostsMoveToBookRequest.serializer(), body, MoveCostsToBookResult.serializer())

    /**
     * Cost entries of a year as CSV
     *
     * UTF-8 with a byte order mark, semicolon separated and CRLF line ends (opens in Swiss Excel). Amounts are plain decimals with a point and no thousands separator (`-12.50`), so they parse the same everywhere. Text that would be read as a formula is prefixed with an apostrophe. Columns are only ever added at the end (`tags` is the last one: the tag names of the entry, by name, separated by a comma and a space). With `bookId` or `tagId` only that book's or tag's entries are exported (404 for one that does not exist).
     */
    suspend fun costsExport(
        year: Long? = null,
        bookId: String? = null,
        tagId: String? = null,
    ): BinaryBody =
        http.binary("GET", "/api/v1/costs/export.csv", listOf("year" to year, "bookId" to bookId, "tagId" to tagId))

    /**
     * Get a cost entry
     */
    suspend fun costsGet(
        id: String,
    ): CostEntry =
        http.json("GET", "/api/v1/costs/${ApiHttp.segment(id)}", emptyList(), CostEntry.serializer())

    /**
     * Change a cost entry
     *
     * Setting `splitMode` to `ownership` or `equal` splits again by the people's current shares (`equal` among everybody); `shares` need `custom`; `participantIds` need an `equal` split (the entry's, or the one set in the same request) and split again among those members. Changing only the amount keeps the frozen shares. `tagIds` replaces the entry's tags (an empty list removes them all). `financeSuggestionId` ties the entry to one of your own pending cost suggestions from the finance app as when booking (checked against the amount and currency the entry has after the change; 409 for an entry that is tied to a finance item already, unless it is that very suggestion, which changes nothing). `bookId` moves the entry to another book that is not archived (an entry may stay in an archived book); moving it to a book that is not tax relevant resets its `deductible` to `unknown` unless the request sets it, and `deductible` other than `unknown` (and other than the entry's own) is a 400 there. An entry booked from a finance provider keeps its source; its back-link in the provider is refreshed. An entry a fuel log entry booked (`fuelLogId` is set) keeps its amount, currency, date and device as that entry has them: asking for other values is a 409 `conflict` with `details.fuelLogId` (the first three change with `PATCH /fuel-logs/{id}`, the device is the vehicle and stays); sending the current values is fine, and category, title, notes, payee, payer, split, deductibility, room, defect and service log entry stay editable here. A 409 about the finance link carries `details.code`: `entry_tied` (the entry is tied to a finance item already) or `suggestion_decided` (the suggestion named by `financeSuggestionId` is decided already); the fuel log lock has `details.fuelLogId` instead.
     */
    suspend fun costsUpdate(
        id: String,
        body: CostsUpdateRequest,
    ): CostEntry =
        http.json("PATCH", "/api/v1/costs/${ApiHttp.segment(id)}", emptyList(), CostsUpdateRequest.serializer(), body, CostEntry.serializer())

    /**
     * Delete a cost entry
     *
     * Removes the entry with its comments and attachments, and its back-link in the finance provider. A transaction booked from a provider is not offered again. An entry a fuel log entry booked (`fuelLogId` is set) goes with that entry: 409 `conflict` with `details.fuelLogId`, delete it with `DELETE /fuel-logs/{id}`.
     */
    suspend fun costsDelete(
        id: String,
    ) =
        http.empty("DELETE", "/api/v1/costs/${ApiHttp.segment(id)}", emptyList())

    /**
     * Mark a cost entry as reviewed
     *
     * Clears `reviewNeeded` and records who looked at the entry and when (`reviewedByUserId`, `reviewedAt`). Entries booked from a receipt in the receipt queue (`/ai-tasks`) are flagged until somebody does this. Reviewing an entry nobody has to review changes nothing and answers 200 with the entry as it is (the first reviewer stays), so a retry is harmless. No request body.
     */
    suspend fun costsReview(
        id: String,
    ): CostEntry =
        http.json("POST", "/api/v1/costs/${ApiHttp.segment(id)}/review", emptyList(), CostEntry.serializer())

    /**
     * Where everybody stands: running balances and suggested payments
     *
     * All-time balance per household member: paid - share over the split entries with a payer, plus the payments they made (settlements) minus those they received; positive means the others owe this person. Pass `bookId` for one book (its settlements only; payments across all books cannot be attributed and stay out) or `all=true` for every book together, archived ones and payments across all books included; without parameters all books are used. A book together with `all=true`, or `all=false` without a book, is a 400; an unknown `bookId` is a 404. In the view of one book `crossBookSettlements` says how many recorded payments across all books (and for how much, household currency) the view leaves out; in the view of all books it is null. Only the household currency is counted (`otherCurrencyCount` says how many entries and payments were left out). `suggestedPayments` are the fewest payments that square the balances. The per-year settlement in `GET /costs/summary` is separate and does not include recorded payments.
     */
    suspend fun costsBalances(
        bookId: String? = null,
        all: Boolean? = null,
    ): CostBalances =
        http.json("GET", "/api/v1/costs/balances", listOf("bookId" to bookId, "all" to all), CostBalances.serializer())

    /**
     * List cost books
     *
     * The ledgers entries are booked into (by default `Wohnung`, `Haushalt` and `Auto`). Active books by sort order; archived ones only with `includeArchived=true`, after the active ones. `isDefault` marks the book an entry without `bookId` goes to: exactly one book has it, never an archived one, and reordering the books does not move it.
     */
    suspend fun costBooksList(
        cursor: String? = null,
        limit: Long? = null,
        includeArchived: Boolean? = null,
    ): CostBooksListResponse =
        http.json("GET", "/api/v1/cost-books", listOf("cursor" to cursor, "limit" to limit, "includeArchived" to includeArchived), CostBooksListResponse.serializer())

    /**
     * Create a cost book
     *
     * `slug` is derived from the name, `defaultSplitMode` is `ownership` (or `equal`, `none`), `taxRelevant` false (only a tax relevant book takes a `deductible` class on its entries) and the book goes to the end of the list. `isDefault: true` makes it the default book (the previous one stops being it). Names are unique without regard to case, umlauts included (409 `conflict`).
     */
    suspend fun costBooksCreate(
        body: CostBooksCreateRequest,
    ): CostBook =
        http.json("POST", "/api/v1/cost-books", emptyList(), CostBooksCreateRequest.serializer(), body, CostBook.serializer())

    /**
     * Get a cost book
     */
    suspend fun costBooksGet(
        id: String,
    ): CostBook =
        http.json("GET", "/api/v1/cost-books/${ApiHttp.segment(id)}", emptyList(), CostBook.serializer())

    /**
     * Change, archive or restore a cost book
     *
     * `archived` archives (closed to new entries; its entries and payments stay and still count in the balances) or restores. The last book that is not archived cannot be archived (409 `conflict`). `isDefault: true` makes the book the default in the same step the previous default loses it (400 on `isDefault` for an archived book that stays archived; restore and default may be sent together); `isDefault: false` on the default book is a 409, name another default instead. Archiving the default book hands the default to the first book that is still open (by sort order); restoring a book never makes it the default. Switching `taxRelevant` off keeps what its entries say about their tax class; it stays out of the tax breakdown.
     */
    suspend fun costBooksUpdate(
        id: String,
        body: CostBooksUpdateRequest,
    ): CostBook =
        http.json("PATCH", "/api/v1/cost-books/${ApiHttp.segment(id)}", emptyList(), CostBooksUpdateRequest.serializer(), body, CostBook.serializer())

    /**
     * Delete an empty cost book
     *
     * Only a book without entries, payments and recurring costs can be deleted; otherwise 409 `conflict` with `details.entryCount` and `details.settlementCount` (or `details.recurrenceCount`): archive it instead. The last book that is not archived cannot be deleted either. Deleting the default book hands the default to the first book that is still open. The book's budgets go with it.
     */
    suspend fun costBooksDelete(
        id: String,
    ) =
        http.empty("DELETE", "/api/v1/cost-books/${ApiHttp.segment(id)}", emptyList())

    /**
     * List cost tags
     *
     * The labels cost entries carry, by name without regard to case, with the number of entries that carry each. Not paged: there are at most 200.
     */
    suspend fun costTagsList(): CostTagsListResponse =
        http.json("GET", "/api/v1/cost-tags", emptyList(), CostTagsListResponse.serializer())

    /**
     * Create a cost tag
     *
     * `color` is a key the client maps to a colour and defaults to `gray`. Names are unique without regard to case, umlauts included (409 `conflict`), and there are at most 200 tags (409).
     */
    suspend fun costTagsCreate(
        body: CostTagsCreateRequest,
    ): CostTag =
        http.json("POST", "/api/v1/cost-tags", emptyList(), CostTagsCreateRequest.serializer(), body, CostTag.serializer())

    /**
     * Get a cost tag
     */
    suspend fun costTagsGet(
        id: String,
    ): CostTag =
        http.json("GET", "/api/v1/cost-tags/${ApiHttp.segment(id)}", emptyList(), CostTag.serializer())

    /**
     * Rename or recolour a cost tag
     */
    suspend fun costTagsUpdate(
        id: String,
        body: CostTagsUpdateRequest,
    ): CostTag =
        http.json("PATCH", "/api/v1/cost-tags/${ApiHttp.segment(id)}", emptyList(), CostTagsUpdateRequest.serializer(), body, CostTag.serializer())

    /**
     * Delete a cost tag
     *
     * The entries (and recurring costs) that carried the tag stay, without it.
     */
    suspend fun costTagsDelete(
        id: String,
    ) =
        http.empty("DELETE", "/api/v1/cost-tags/${ApiHttp.segment(id)}", emptyList())

    /**
     * List cost budgets
     *
     * What the household wants to spend in a book, a category or both, per calendar month or year, in the order the budgets were made; inactive ones included. Where they stand is `GET /costs/budgets/status`.
     */
    suspend fun costBudgetsList(): CostBudgetsListResponse =
        http.json("GET", "/api/v1/cost-budgets", emptyList(), CostBudgetsListResponse.serializer())

    /**
     * Set a cost budget
     *
     * For a book (`bookId`), a category (`category`) or both (400 on `bookId` when it names neither), per `month` or `year`, in the household currency of the day. One budget per book, category and period (409 `conflict`). Deleting a book deletes its budgets.
     */
    suspend fun costBudgetsCreate(
        body: CostBudgetsCreateRequest,
    ): CostBudget =
        http.json("POST", "/api/v1/cost-budgets", emptyList(), CostBudgetsCreateRequest.serializer(), body, CostBudget.serializer())

    /**
     * Where the active budgets stand
     *
     * For every active budget: what the entries in its scope add up to (entries that count as an expense, refunds netted off, in the budget's currency) in the month `year`/`month` for a monthly budget or in the whole `year` for a yearly one, what is left, the whole percent used and a `state`: `ok`, `warning` from 80 % (`warningPercent`) or `exceeded` from 100 %. `year` and `month` default to today in the household zone, each on its own. Nothing is announced by a notification; a client shows the state.
     */
    suspend fun costBudgetsStatus(
        year: Long? = null,
        month: Long? = null,
    ): CostBudgetStatus =
        http.json("GET", "/api/v1/costs/budgets/status", listOf("year" to year, "month" to month), CostBudgetStatus.serializer())

    /**
     * Get a cost budget
     */
    suspend fun costBudgetsGet(
        id: String,
    ): CostBudget =
        http.json("GET", "/api/v1/cost-budgets/${ApiHttp.segment(id)}", emptyList(), CostBudget.serializer())

    /**
     * Change a cost budget
     *
     * `null` for `bookId` or `category` removes that half of the scope; what is left must name a book or a category (400 on `bookId`). `active: false` keeps the budget but leaves it out of the status. A change that makes it the same as another budget is a 409.
     */
    suspend fun costBudgetsUpdate(
        id: String,
        body: CostBudgetsUpdateRequest,
    ): CostBudget =
        http.json("PATCH", "/api/v1/cost-budgets/${ApiHttp.segment(id)}", emptyList(), CostBudgetsUpdateRequest.serializer(), body, CostBudget.serializer())

    /**
     * Delete a cost budget
     */
    suspend fun costBudgetsDelete(
        id: String,
    ) =
        http.empty("DELETE", "/api/v1/cost-budgets/${ApiHttp.segment(id)}", emptyList())

    /**
     * List recurring costs
     *
     * The costs that repeat (rent, insurance, a subscription): the ones that book first, soonest `nextDate` first, then the paused and finished ones by title. `active=true` lists the ones that book, `active=false` the paused and finished ones; `bookId` narrows to one book. Not paged: there are at most 200.
     */
    suspend fun costRecurrencesList(
        active: Boolean? = null,
        bookId: String? = null,
    ): CostRecurrencesListResponse =
        http.json("GET", "/api/v1/cost-recurrences", listOf("active" to active, "bookId" to bookId), CostRecurrencesListResponse.serializer())

    /**
     * Set up a recurring cost
     *
     * The template of an entry (the fields of `POST /costs` without a date) and a rule: every `interval` months (`monthly`), quarters or years, counted from the month of `startDate`, on `dayOfMonth` (default: the day of `startDate`; a day a shorter month does not have means its last day, so 31 gives 31 January, 28 February, 31 March). The first occurrence is the first one on or after `startDate`; `endDate` (included) closes the series. The template is checked as booking would be (400 on the field for an unknown book, asset, room, payer or tag, a book that is archived, a split that does not fit, a tax class in a book without one; 400 on `endDate` when it leaves no occurrence). A scheduler books each occurrence that falls due, on its date in the household time zone, as an entry with `source: recurring`, `recurrenceId` set and no review flag; an occurrence is booked once even if the run is repeated, and a server that was down books each occurrence it missed. A `startDate` in the past is therefore booked right away, up to 120 occurrences per call. The split is worked out when an entry is booked, so a changed ownership share applies to later entries only.
     */
    suspend fun costRecurrencesCreate(
        body: CostRecurrencesCreateRequest,
    ): CostRecurrence =
        http.json("POST", "/api/v1/cost-recurrences", emptyList(), CostRecurrencesCreateRequest.serializer(), body, CostRecurrence.serializer())

    /**
     * Get a recurring cost
     */
    suspend fun costRecurrencesGet(
        id: String,
    ): CostRecurrence =
        http.json("GET", "/api/v1/cost-recurrences/${ApiHttp.segment(id)}", emptyList(), CostRecurrence.serializer())

    /**
     * Change, pause or resume a recurring cost
     *
     * Changes the template for the entries booked from now on (the ones booked already stay as they are) and the rule. After a change of the rule the series continues after the newest occurrence that was booked. `active: false` pauses it; `active: true` on a paused one resumes it at the first occurrence on or after today, skipping what fell due meanwhile. Touching the template asks for an open book (400 on `bookId` for an archived one: move it to another); pausing or changing only the rule does not. `splitMode` `equal` without `participantIds` splits among everybody again, also for a template that was narrowed to some people. A tax class (`deductible`) means something in a tax relevant book only: moving the template to a book that is not tax relevant resets it to `unknown` unless the request sets it, and a class other than `unknown` (and other than the template's own) is a 400 on `deductible` there; entries booked from a template whose book lost its tax class get `unknown`. A new `category` brings the default of `countsAsExpense` along unless the template's value was set on purpose or the request names it, as for an entry. Occurrences already due after the change are booked right away. Any change clears `lastError`.
     */
    suspend fun costRecurrencesUpdate(
        id: String,
        body: CostRecurrencesUpdateRequest,
    ): CostRecurrence =
        http.json("PATCH", "/api/v1/cost-recurrences/${ApiHttp.segment(id)}", emptyList(), CostRecurrencesUpdateRequest.serializer(), body, CostRecurrence.serializer())

    /**
     * Delete a recurring cost
     *
     * The entries it booked stay (with `source: recurring`, but no longer tied to it: `recurrenceId` becomes null).
     */
    suspend fun costRecurrencesDelete(
        id: String,
    ) =
        http.empty("DELETE", "/api/v1/cost-recurrences/${ApiHttp.segment(id)}", emptyList())

    /**
     * Book the next due occurrence now
     *
     * Books the next occurrence if it is due (on or before today in the household time zone), exactly one, so a series that is behind needs several calls; `entry` is the new entry. Nothing is booked, and `entry` is null, for a paused or finished recurring cost or one whose next occurrence is still ahead. A booking that fails (the book is archived: 400 on `bookId`) is also recorded as `lastError`. No request body.
     */
    suspend fun costRecurrencesRun(
        id: String,
    ): CostRecurrenceRun =
        http.json("POST", "/api/v1/cost-recurrences/${ApiHttp.segment(id)}/run-now", emptyList(), CostRecurrenceRun.serializer())

    /**
     * List recorded payments between the people
     *
     * Newest first by date. Filter by book (`bookId`; payments across all books are not listed then; a book that does not exist is a 404, not an empty list), year or a date range, and by a person who made or received them (`userId`, a user id or `me`).
     */
    suspend fun settlementsList(
        cursor: String? = null,
        limit: Long? = null,
        bookId: String? = null,
        year: Long? = null,
        from: String? = null,
        to: String? = null,
        userId: String? = null,
    ): SettlementsListResponse =
        http.json("GET", "/api/v1/settlements", listOf("cursor" to cursor, "limit" to limit, "bookId" to bookId, "year" to year, "from" to from, "to" to to, "userId" to userId), SettlementsListResponse.serializer())

    /**
     * Record a payment between two people
     *
     * "Ben paid Anna 50": `fromUserId` handed `amountMinor` over to `toUserId`. It is not a cost (no expense total counts it); it moves the balances in `GET /costs/balances`. `bookId` omitted or null settles across all books; a book may be archived (paying back a closed trip is the normal order). `currency` defaults to the household's, `date` to today. The two people must differ and be household members (400 on the field otherwise). A repeated `idempotencyKey` (unique per person who records, whatever credential they use) returns the first payment with status 200 and records nothing; the same key for a different payment (other people, amount, currency or book) is a 409 `conflict` with `details.code` `idempotency_key_reused`; once the payment is deleted its key is free again.
     */
    suspend fun settlementsCreate(
        body: SettlementsCreateRequest,
    ): Settlement =
        http.json("POST", "/api/v1/settlements", emptyList(), SettlementsCreateRequest.serializer(), body, Settlement.serializer())

    /**
     * Get a recorded payment
     */
    suspend fun settlementsGet(
        id: String,
    ): Settlement =
        http.json("GET", "/api/v1/settlements/${ApiHttp.segment(id)}", emptyList(), Settlement.serializer())

    /**
     * Change a recorded payment
     */
    suspend fun settlementsUpdate(
        id: String,
        body: SettlementsUpdateRequest,
    ): Settlement =
        http.json("PATCH", "/api/v1/settlements/${ApiHttp.segment(id)}", emptyList(), SettlementsUpdateRequest.serializer(), body, Settlement.serializer())

    /**
     * Delete a recorded payment
     *
     * The balances move back: the payment counts as never made.
     */
    suspend fun settlementsDelete(
        id: String,
    ) =
        http.empty("DELETE", "/api/v1/settlements/${ApiHttp.segment(id)}", emptyList())
}

@Serializable
data class CostsListResponse(
    val items: List<CostEntry>,
    val nextCursor: String?,
)

@Serializable
data class CostsCreateRequestSharesItem(
    val userId: String,
    val shareBps: Long,
)

@Serializable
data class CostsCreateRequest(
    val bookId: String? = null,
    /** date */
    val date: String? = null,
    val title: String,
    val amountMinor: Long,
    val currency: String? = null,
    /** repair | utilities | renewal_fund | purchase | mortgage_interest | mortgage_principal | insurance | renovation | maintenance | fuel | taxes_fees | groceries | household | dining | leisure | travel | health | gifts | transport | subscriptions | other */
    val category: String,
    val assetId: String? = null,
    val roomId: String? = null,
    val defectId: String? = null,
    val serviceLogId: String? = null,
    val payee: String? = null,
    val notes: String? = null,
    val paidByUserId: String? = null,
    /** ownership | equal | custom | none */
    val splitMode: String? = null,
    val shares: List<CostsCreateRequestSharesItem>? = null,
    val participantIds: List<String>? = null,
    val countsAsExpense: Boolean? = null,
    /** unknown | maintenance | investment | no */
    val deductible: String? = null,
    val tagIds: List<String>? = null,
    val financeSuggestionId: String? = null,
    val receiptTaskId: String? = null,
    val idempotencyKey: String? = null,
) {
    companion object {
        val CATEGORY_VALUES: List<String> = listOf("repair", "utilities", "renewal_fund", "purchase", "mortgage_interest", "mortgage_principal", "insurance", "renovation", "maintenance", "fuel", "taxes_fees", "groceries", "household", "dining", "leisure", "travel", "health", "gifts", "transport", "subscriptions", "other")
        val SPLIT_MODE_VALUES: List<String> = listOf("ownership", "equal", "custom", "none")
        val DEDUCTIBLE_VALUES: List<String> = listOf("unknown", "maintenance", "investment", "no")
    }
}

@Serializable
data class CostsMoveToBookRequest(
    val bookId: String,
    val ids: List<String>? = null,
    val assetId: String? = null,
    val dryRun: Boolean? = null,
)

@Serializable
data class CostsUpdateRequestSharesItem(
    val userId: String,
    val shareBps: Long,
)

@Serializable
data class CostsUpdateRequest(
    val bookId: String? = null,
    /** date */
    val date: String? = null,
    val title: String? = null,
    val amountMinor: Long? = null,
    val currency: String? = null,
    /** repair | utilities | renewal_fund | purchase | mortgage_interest | mortgage_principal | insurance | renovation | maintenance | fuel | taxes_fees | groceries | household | dining | leisure | travel | health | gifts | transport | subscriptions | other */
    val category: String? = null,
    val assetId: Patch<String> = Patch.Keep,
    val roomId: Patch<String> = Patch.Keep,
    val defectId: Patch<String> = Patch.Keep,
    val serviceLogId: Patch<String> = Patch.Keep,
    val payee: Patch<String> = Patch.Keep,
    val notes: Patch<String> = Patch.Keep,
    val paidByUserId: Patch<String> = Patch.Keep,
    /** ownership | equal | custom | none */
    val splitMode: String? = null,
    val shares: List<CostsUpdateRequestSharesItem>? = null,
    val participantIds: List<String>? = null,
    val countsAsExpense: Boolean? = null,
    /** unknown | maintenance | investment | no */
    val deductible: String? = null,
    val tagIds: List<String>? = null,
    val financeSuggestionId: String? = null,
) {
    companion object {
        val CATEGORY_VALUES: List<String> = listOf("repair", "utilities", "renewal_fund", "purchase", "mortgage_interest", "mortgage_principal", "insurance", "renovation", "maintenance", "fuel", "taxes_fees", "groceries", "household", "dining", "leisure", "travel", "health", "gifts", "transport", "subscriptions", "other")
        val SPLIT_MODE_VALUES: List<String> = listOf("ownership", "equal", "custom", "none")
        val DEDUCTIBLE_VALUES: List<String> = listOf("unknown", "maintenance", "investment", "no")
    }
}

@Serializable
data class CostBooksListResponse(
    val items: List<CostBook>,
    val nextCursor: String?,
)

@Serializable
data class CostBooksCreateRequest(
    val name: String,
    val slug: String? = null,
    val icon: String? = null,
    /** ownership | equal | none */
    val defaultSplitMode: String? = null,
    val taxRelevant: Boolean? = null,
    val sortOrder: Long? = null,
    val isDefault: Boolean? = null,
) {
    companion object {
        val DEFAULT_SPLIT_MODE_VALUES: List<String> = listOf("ownership", "equal", "none")
    }
}

@Serializable
data class CostBooksUpdateRequest(
    val name: String? = null,
    val slug: String? = null,
    val icon: Patch<String> = Patch.Keep,
    /** ownership | equal | none */
    val defaultSplitMode: String? = null,
    val taxRelevant: Boolean? = null,
    val sortOrder: Long? = null,
    val archived: Boolean? = null,
    val isDefault: Boolean? = null,
) {
    companion object {
        val DEFAULT_SPLIT_MODE_VALUES: List<String> = listOf("ownership", "equal", "none")
    }
}

@Serializable
data class CostTagsListResponse(
    val items: List<CostTag>,
)

@Serializable
data class CostTagsCreateRequest(
    val name: String,
    /** gray | red | orange | amber | green | teal | blue | violet | pink */
    val color: String? = null,
) {
    companion object {
        val COLOR_VALUES: List<String> = listOf("gray", "red", "orange", "amber", "green", "teal", "blue", "violet", "pink")
    }
}

@Serializable
data class CostTagsUpdateRequest(
    val name: String? = null,
    /** gray | red | orange | amber | green | teal | blue | violet | pink */
    val color: String? = null,
) {
    companion object {
        val COLOR_VALUES: List<String> = listOf("gray", "red", "orange", "amber", "green", "teal", "blue", "violet", "pink")
    }
}

@Serializable
data class CostBudgetsListResponse(
    val items: List<CostBudget>,
)

@Serializable
data class CostBudgetsCreateRequest(
    val bookId: String? = null,
    /** repair | utilities | renewal_fund | purchase | mortgage_interest | mortgage_principal | insurance | renovation | maintenance | fuel | taxes_fees | groceries | household | dining | leisure | travel | health | gifts | transport | subscriptions | other */
    val category: String? = null,
    /** month | year */
    val period: String,
    val amountMinor: Long,
    val active: Boolean? = null,
) {
    companion object {
        val CATEGORY_VALUES: List<String> = listOf("repair", "utilities", "renewal_fund", "purchase", "mortgage_interest", "mortgage_principal", "insurance", "renovation", "maintenance", "fuel", "taxes_fees", "groceries", "household", "dining", "leisure", "travel", "health", "gifts", "transport", "subscriptions", "other")
        val PERIOD_VALUES: List<String> = listOf("month", "year")
    }
}

@Serializable
data class CostBudgetsUpdateRequest(
    val bookId: Patch<String> = Patch.Keep,
    /** repair | utilities | renewal_fund | purchase | mortgage_interest | mortgage_principal | insurance | renovation | maintenance | fuel | taxes_fees | groceries | household | dining | leisure | travel | health | gifts | transport | subscriptions | other */
    val category: Patch<String> = Patch.Keep,
    /** month | year */
    val period: String? = null,
    val amountMinor: Long? = null,
    val active: Boolean? = null,
) {
    companion object {
        val CATEGORY_VALUES: List<String> = listOf("repair", "utilities", "renewal_fund", "purchase", "mortgage_interest", "mortgage_principal", "insurance", "renovation", "maintenance", "fuel", "taxes_fees", "groceries", "household", "dining", "leisure", "travel", "health", "gifts", "transport", "subscriptions", "other")
        val PERIOD_VALUES: List<String> = listOf("month", "year")
    }
}

@Serializable
data class CostRecurrencesListResponse(
    val items: List<CostRecurrence>,
)

@Serializable
data class CostRecurrencesCreateRequestSharesItem(
    val userId: String,
    val shareBps: Long,
)

@Serializable
data class CostRecurrencesCreateRequest(
    val bookId: String? = null,
    val title: String,
    val amountMinor: Long,
    val currency: String? = null,
    /** repair | utilities | renewal_fund | purchase | mortgage_interest | mortgage_principal | insurance | renovation | maintenance | fuel | taxes_fees | groceries | household | dining | leisure | travel | health | gifts | transport | subscriptions | other */
    val category: String,
    val assetId: String? = null,
    val roomId: String? = null,
    val payee: String? = null,
    val notes: String? = null,
    val paidByUserId: String? = null,
    /** ownership | equal | custom | none */
    val splitMode: String? = null,
    val shares: List<CostRecurrencesCreateRequestSharesItem>? = null,
    val participantIds: List<String>? = null,
    val tagIds: List<String>? = null,
    val countsAsExpense: Boolean? = null,
    /** unknown | maintenance | investment | no */
    val deductible: String? = null,
    /** monthly | quarterly | yearly */
    val frequency: String,
    val interval: Long? = null,
    val dayOfMonth: Long? = null,
    /** date */
    val startDate: String,
    /** date */
    val endDate: String? = null,
    val active: Boolean? = null,
) {
    companion object {
        val CATEGORY_VALUES: List<String> = listOf("repair", "utilities", "renewal_fund", "purchase", "mortgage_interest", "mortgage_principal", "insurance", "renovation", "maintenance", "fuel", "taxes_fees", "groceries", "household", "dining", "leisure", "travel", "health", "gifts", "transport", "subscriptions", "other")
        val SPLIT_MODE_VALUES: List<String> = listOf("ownership", "equal", "custom", "none")
        val DEDUCTIBLE_VALUES: List<String> = listOf("unknown", "maintenance", "investment", "no")
        val FREQUENCY_VALUES: List<String> = listOf("monthly", "quarterly", "yearly")
    }
}

@Serializable
data class CostRecurrencesUpdateRequestSharesItem(
    val userId: String,
    val shareBps: Long,
)

@Serializable
data class CostRecurrencesUpdateRequest(
    val bookId: String? = null,
    val title: String? = null,
    val amountMinor: Long? = null,
    val currency: String? = null,
    /** repair | utilities | renewal_fund | purchase | mortgage_interest | mortgage_principal | insurance | renovation | maintenance | fuel | taxes_fees | groceries | household | dining | leisure | travel | health | gifts | transport | subscriptions | other */
    val category: String? = null,
    val assetId: Patch<String> = Patch.Keep,
    val roomId: Patch<String> = Patch.Keep,
    val payee: Patch<String> = Patch.Keep,
    val notes: Patch<String> = Patch.Keep,
    val paidByUserId: Patch<String> = Patch.Keep,
    /** ownership | equal | custom | none */
    val splitMode: String? = null,
    val shares: List<CostRecurrencesUpdateRequestSharesItem>? = null,
    val participantIds: List<String>? = null,
    val tagIds: List<String>? = null,
    val countsAsExpense: Boolean? = null,
    /** unknown | maintenance | investment | no */
    val deductible: String? = null,
    /** monthly | quarterly | yearly */
    val frequency: String? = null,
    val interval: Long? = null,
    val dayOfMonth: Long? = null,
    /** date */
    val startDate: String? = null,
    /** date */
    val endDate: Patch<String> = Patch.Keep,
    val active: Boolean? = null,
) {
    companion object {
        val CATEGORY_VALUES: List<String> = listOf("repair", "utilities", "renewal_fund", "purchase", "mortgage_interest", "mortgage_principal", "insurance", "renovation", "maintenance", "fuel", "taxes_fees", "groceries", "household", "dining", "leisure", "travel", "health", "gifts", "transport", "subscriptions", "other")
        val SPLIT_MODE_VALUES: List<String> = listOf("ownership", "equal", "custom", "none")
        val DEDUCTIBLE_VALUES: List<String> = listOf("unknown", "maintenance", "investment", "no")
        val FREQUENCY_VALUES: List<String> = listOf("monthly", "quarterly", "yearly")
    }
}

@Serializable
data class SettlementsListResponse(
    val items: List<Settlement>,
    val nextCursor: String?,
)

@Serializable
data class SettlementsCreateRequest(
    val bookId: String? = null,
    val fromUserId: String,
    val toUserId: String,
    val amountMinor: Long,
    val currency: String? = null,
    /** date */
    val date: String? = null,
    val note: String? = null,
    val idempotencyKey: String? = null,
)

@Serializable
data class SettlementsUpdateRequest(
    val bookId: Patch<String> = Patch.Keep,
    val fromUserId: String? = null,
    val toUserId: String? = null,
    val amountMinor: Long? = null,
    val currency: String? = null,
    /** date */
    val date: String? = null,
    val note: Patch<String> = Patch.Keep,
)
