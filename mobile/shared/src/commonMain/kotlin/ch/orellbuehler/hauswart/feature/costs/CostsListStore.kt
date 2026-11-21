package ch.orellbuehler.hauswart.feature.costs

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.CostBalances
import ch.orellbuehler.hauswart.api.generated.CostBook
import ch.orellbuehler.hauswart.api.generated.CostEntry
import ch.orellbuehler.hauswart.api.generated.CostsSummary
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Money
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.feature.dashboard.TONE_DUE
import ch.orellbuehler.hauswart.feature.dashboard.TONE_MUTED
import ch.orellbuehler.hauswart.feature.dashboard.TONE_OK
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

/** A small label next to an entry: "Zu prüfen", "Rückerstattung", ... */
data class CostBadge(
    val text: String,
    val tone: String,
)

data class TagView(
    val id: String,
    val name: String,
    val color: String,
)

/** One entry of the list, ready to show. */
data class CostRowView(
    val id: String,
    val title: String,
    /** Date, category and payee: "21.11. · Lebensmittel · Beispiel Markt". */
    val meta: String,
    /** Book (when every book is listed), device and room. */
    val place: String,
    val amount: String,
    val refund: Boolean,
    val payer: String,
    val badges: List<CostBadge>,
    val tags: List<TagView>,
    val commentCount: Int,
)

data class CostMonthGroup(
    val key: String,
    val title: String,
    /** What the month's entries that count as an expense add up to. */
    val total: String,
    val rows: List<CostRowView>,
)

/** The year's totals above the list. */
data class CostSummaryView(
    val title: String,
    val total: String,
    val count: String,
    val equity: String?,
    val otherCurrency: String?,
)

/** Where the person stands, from the balances of the book on screen. */
data class CostBalanceView(
    /** "Du bekommst CHF 25.00"; null before anything happened. */
    val you: ToneText?,
    /** Who owes whom, as sentences (at most three). */
    val payments: List<String>,
    /** "Alles ausgeglichen" or "noch nichts zu verrechnen": what to say when nobody owes anything. */
    val status: String,
)

data class CostsListState(
    val loading: Boolean = true,
    val error: UiError? = null,
    /** The books the switcher offers; hidden while there is one at most. */
    val books: List<BookOption> = emptyList(),
    /** [ALL_BOOKS] (empty) or the id of the book on screen. */
    val bookId: String = ALL_BOOKS,
    val showSwitcher: Boolean = false,
    val year: Int = 0,
    val query: String = "",
    val category: String = "",
    val paidBy: String = "",
    val reviewOnly: Boolean = false,
    val groups: List<CostMonthGroup> = emptyList(),
    /** How many entries the year has in this book, before the filters. */
    val total: Int = 0,
    /** How many pass the filters. */
    val shown: Int = 0,
    val summary: CostSummaryView? = null,
    val balance: CostBalanceView? = null,
    val balancesUnavailable: Boolean = false,
    val reviewCount: Int = 0,
    val title: String = "",
    val categories: List<CostOption> = emptyList(),
    val payers: List<CostOption> = emptyList(),
    val yearLabel: String = "",
) {
    val filtered: Boolean get() = query.isNotBlank() || category.isNotEmpty() || paidBy.isNotEmpty() || reviewOnly
}

/** The cost entries of one book (or every book) and year with the year's totals and where the person stands. */
class CostsListStore(
    private val app: HauswartApp,
) : Store<CostsListState>(CostsListState()) {
    private var books: List<CostBook> = emptyList()
    private var entries: List<CostEntry> = emptyList()
    private var chosen: String? = null
    private var job: Job? = null
    private var loadedOnce = false

    init {
        onChange(app, "costs") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun selectBook(bookId: String) {
        chosen = bookId
        app.rememberBook(bookId)
        update { it.copy(bookId = bookId, category = "", paidBy = "", reviewOnly = false) }
        load()
    }

    fun previousYear() = setYear(current.year - 1)

    fun nextYear() = setYear(current.year + 1)

    private fun setYear(year: Int) {
        if (year < MIN_YEAR || year > MAX_YEAR) return
        update { it.copy(year = year) }
        load()
    }

    fun search(query: String) {
        update { it.copy(query = query) }
        show()
    }

    fun setCategory(category: String) {
        update { it.copy(category = category) }
        show()
    }

    fun setPaidBy(userId: String) {
        update { it.copy(paidBy = userId) }
        show()
    }

    fun setReviewOnly(value: Boolean) {
        update { it.copy(reviewOnly = value) }
        show()
    }

    fun resetFilters() {
        update { it.copy(query = "", category = "", paidBy = "", reviewOnly = false) }
        show()
    }

    private fun load() {
        job?.cancel()
        update { it.copy(loading = !loadedOnce, error = null) }
        job =
            launch({ e -> update { it.copy(loading = false, error = e) } }) {
                val household = app.household.get()
                books =
                    fetchAll { cursor ->
                        val page = app.api.costs.costBooksList(cursor = cursor, limit = 200, includeArchived = true)
                        page.items to page.nextCursor
                    }
                val bookId = chooseBook(chosen, app.rememberedBook(), books)
                chosen = bookId
                val year = current.year.takeIf { it != 0 } ?: Dates.today(household.timezone).take(4).toInt()
                val bookFilter = bookId.ifEmpty { null }
                val (list, summary, balances) =
                    coroutineScope {
                        val list =
                            async {
                                fetchAll { cursor ->
                                    val page =
                                        app.api.costs.costsList(cursor = cursor, limit = 200, bookId = bookFilter, year = year.toLong())
                                    page.items to page.nextCursor
                                }
                            }
                        val summary = async { app.api.costs.costsSummary(year = year.toLong(), bookId = bookFilter) }
                        val balances =
                            async {
                                try {
                                    if (bookFilter ==
                                        null
                                    ) {
                                        app.api.costs.costsBalances(all = true)
                                    } else {
                                        app.api.costs.costsBalances(bookId = bookFilter)
                                    }
                                } catch (e: CancellationException) {
                                    throw e
                                } catch (e: Exception) {
                                    null
                                }
                            }
                        Triple(list.await(), summary.await(), balances.await())
                    }
                entries = list
                loadedOnce = true
                val switcher = switcherBooks(books, bookId)
                update {
                    it.copy(
                        loading = false,
                        bookId = bookId,
                        books = switcher.map(::bookOptionOf),
                        showSwitcher = switcher.size > 1,
                        year = year,
                        yearLabel = year.toString(),
                        total = list.size,
                        summary = summaryView(summary, household.currency),
                        balance = balances?.let(::balanceView),
                        balancesUnavailable = balances == null,
                        reviewCount = summary.reviewNeededCount.toInt(),
                        title = books.firstOrNull { b -> b.id == bookId }?.name ?: tr("costbook_all"),
                        categories = costCategoryOptions(),
                        payers = app.household.members.map { m -> CostOption(m.id, m.name) },
                    )
                }
                show()
            }
    }

    private fun show() {
        val state = current
        val needle = state.query.trim().lowercase()
        val currency = app.household.currency
        val matching =
            entries.filter { e ->
                (state.category.isEmpty() || e.category == state.category) &&
                    (state.paidBy.isEmpty() || e.paidByUserId == state.paidBy) &&
                    (!state.reviewOnly || e.reviewNeeded) &&
                    (needle.isEmpty() || listOfNotNull(e.title, e.payee, e.notes).any { it.lowercase().contains(needle) })
            }
        val groups =
            matching
                .groupBy { it.date.take(7) }
                .toSortedMap(compareByDescending { it })
                .map { (month, rows) ->
                    val expenses = rows.filter { it.countsAsExpense && it.currency == currency }.sumOf { it.amountMinor }
                    CostMonthGroup(
                        key = month,
                        title = costMonthTitle(rows.first().date),
                        total = Money.format(expenses, currency),
                        rows = rows.map { rowView(it, state.bookId.isEmpty()) },
                    )
                }
        update { it.copy(groups = groups, shown = matching.size) }
    }

    private fun summaryView(
        summary: CostsSummary,
        currency: String,
    ): CostSummaryView {
        val count = summary.byMonth.sumOf { it.count }
        return CostSummaryView(
            title = tr("costs_expenses_title", "year" to summary.year),
            total = Money.format(summary.expenseTotalMinor, summary.currency),
            count = tr("costs_expenses_count", "count" to count),
            equity = summary.equityTotalMinor.takeIf { it != 0L }?.let { Money.format(it, summary.currency) },
            otherCurrency =
                summary.otherCurrencyCount.takeIf { it > 0 }?.let {
                    tr("costs_other_currency", "count" to it, "currency" to currency)
                },
        )
    }

    private fun balanceView(balances: CostBalances): CostBalanceView {
        val state = balanceState(balances)
        return CostBalanceView(
            you = viewerLine(balances, app.session.user?.id),
            payments = balances.suggestedPayments.take(PAYMENTS_SHOWN).map { paymentSentence(it, balances.currency) },
            status =
                when (state) {
                    BALANCE_SQUARE -> tr("balances_square")
                    BALANCE_EMPTY -> tr("balances_nothing")
                    else -> ""
                },
        )
    }

    companion object {
        const val MIN_YEAR = 2000
        const val MAX_YEAR = 2100
        private const val PAYMENTS_SHOWN = 3
    }
}

internal fun rowView(
    entry: CostEntry,
    withBook: Boolean,
): CostRowView {
    val badges = mutableListOf<CostBadge>()
    if (entry.reviewNeeded) badges += CostBadge(tr("cost_badge_review"), TONE_DUE)
    if (entry.amountMinor < 0) badges += CostBadge(tr("cost_badge_refund"), TONE_OK)
    if (!entry.countsAsExpense) badges += CostBadge(tr("cost_badge_equity"), TONE_MUTED)
    when (entry.source) {
        "recurring" -> badges += CostBadge(tr("cost_badge_recurring"), TONE_MUTED)
        "manual" -> {}
        else -> badges += CostBadge(tr("cost_badge_imported"), TONE_MUTED)
    }
    return CostRowView(
        id = entry.id,
        title = entry.title,
        meta = listOfNotNull(Dates.short(entry.date), costCategoryLabel(entry.category), entry.payee).joinToString(" · "),
        place = listOfNotNull(entry.bookName.takeIf { withBook }, entry.assetName, entry.roomName).joinToString(" · "),
        amount = Money.format(entry.amountMinor, entry.currency),
        refund = entry.amountMinor < 0,
        payer = entry.paidByName ?: tr("cost_payer_open"),
        badges = badges,
        tags = entry.tags.map { TagView(it.id, it.name, it.color) },
        commentCount = entry.commentCount.toInt(),
    )
}
