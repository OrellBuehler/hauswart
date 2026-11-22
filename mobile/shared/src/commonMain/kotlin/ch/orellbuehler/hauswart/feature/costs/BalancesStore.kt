package ch.orellbuehler.hauswart.feature.costs

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.CostBook
import ch.orellbuehler.hauswart.api.generated.Settlement
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Money
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

data class PersonBalanceView(
    val userId: String,
    val name: String,
    val isYou: Boolean,
    val balance: ToneText,
    val paid: String,
    val share: String,
    val sent: String,
    val received: String,
)

/** A suggested payment; recording it opens the settlement form with these values. */
data class SuggestedPaymentView(
    val sentence: String,
    val amount: String,
    val fromName: String,
    val toName: String,
    val fromUserId: String,
    val toUserId: String,
    /** The amount as the settlement form takes it ("12.50"). */
    val amountInput: String,
)

data class SettlementRowView(
    val id: String,
    val title: String,
    val meta: String,
    val amount: String,
    val fromUserId: String,
    val toUserId: String,
    val fromName: String,
    val toName: String,
)

data class BalancesState(
    val loading: Boolean = true,
    /** True while the balances and payments are being read, also on a reload that keeps showing the old ones. */
    val refreshing: Boolean = true,
    val error: UiError? = null,
    val books: List<BookOption> = emptyList(),
    val bookId: String = ALL_BOOKS,
    val showSwitcher: Boolean = false,
    /** [BALANCE_EMPTY], [BALANCE_SQUARE] or [BALANCE_OPEN]. */
    val status: String = BALANCE_EMPTY,
    val you: ToneText? = null,
    val people: List<PersonBalanceView> = emptyList(),
    val payments: List<SuggestedPaymentView> = emptyList(),
    /** Notes under the balances: payments across all books, entries without a payer, other currencies. */
    val notes: List<String> = emptyList(),
    val scopeNote: String? = null,
    val settlements: List<SettlementRowView> = emptyList(),
    /** "2 Zahlungen". */
    val settlementsCount: String = "",
    /** 0 for every year. */
    val year: Int = 0,
    val years: List<CostOption> = emptyList(),
    /** A user id, or empty for everybody. */
    val person: String = "",
    val persons: List<CostOption> = emptyList(),
    val deleting: Boolean = false,
    /** A failed delete; everything stays shown. */
    val actionError: UiError? = null,
) {
    val settlementsFiltered: Boolean get() = year != 0 || person.isNotEmpty()

    /** Somebody owes somebody: there are payments to suggest. */
    val isOpen: Boolean get() = status == BALANCE_OPEN

    /** Nothing was ever paid, shared or settled. */
    val isNothingYet: Boolean get() = status == BALANCE_EMPTY
}

/** Where everybody stands, the payments that would square it and the recorded payments between the people. */
class BalancesStore(
    private val app: HauswartApp,
    requestedBook: String?,
) : Store<BalancesState>(BalancesState()) {
    private var books: List<CostBook> = emptyList()
    private var chosen: String? = bookOfArg(requestedBook)
    private var rows: List<Settlement> = emptyList()
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
        update { it.copy(bookId = bookId) }
        load()
    }

    /** [value] is a year, or `0` for every year. */
    fun setYear(value: String) {
        update { it.copy(year = value.toIntOrNull() ?: 0) }
        load()
    }

    fun setPerson(userId: String) {
        update { it.copy(person = userId) }
        load()
    }

    fun resetFilters() {
        update { it.copy(year = 0, person = "") }
        load()
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    /** What the delete dialog says for the payment [id]. */
    fun deleteText(id: String): String {
        val settlement = rows.firstOrNull { it.id == id } ?: return ""
        return tr(
            "settlement_delete_description",
            "from" to personName(settlement.fromName),
            "to" to personName(settlement.toName),
            "amount" to Money.format(settlement.amountMinor, settlement.currency),
        )
    }

    fun deleteSettlement(id: String) {
        if (current.deleting) return
        update { it.copy(deleting = true, actionError = null) }
        launch({ e -> update { it.copy(deleting = false, actionError = e) } }) {
            app.api.costs.settlementsDelete(id)
            app.changed("costs")
            update { it.copy(deleting = false) }
        }
    }

    private fun load() {
        job?.cancel()
        update { it.copy(loading = !loadedOnce, refreshing = true, error = null) }
        job =
            launch({ e -> update { it.copy(loading = false, refreshing = false, error = e) } }) {
                val household = app.household.get()
                books =
                    fetchAll { cursor ->
                        val page = app.api.costs.costBooksList(cursor = cursor, limit = 200, includeArchived = true)
                        page.items to page.nextCursor
                    }
                val bookId = chooseBook(chosen, app.rememberedBook(), books)
                chosen = bookId
                val bookFilter = bookId.ifEmpty { null }
                val year = current.year
                val person = current.person
                val (balances, settlements) =
                    coroutineScope {
                        val balances =
                            async {
                                if (bookFilter ==
                                    null
                                ) {
                                    app.api.costs.costsBalances(all = true)
                                } else {
                                    app.api.costs.costsBalances(bookId = bookFilter)
                                }
                            }
                        val settlements =
                            async {
                                fetchAll { cursor ->
                                    val page =
                                        app.api.costs.settlementsList(
                                            cursor = cursor,
                                            limit = 200,
                                            bookId = bookFilter,
                                            year = year.takeIf { it != 0 }?.toLong(),
                                            userId = person.ifEmpty { null },
                                        )
                                    page.items to page.nextCursor
                                }
                            }
                        balances.await() to settlements.await()
                    }
                rows = settlements
                loadedOnce = true
                val me = app.session.user?.id
                val currency = balances.currency
                val switcher = switcherBooks(books, bookId)
                val book = books.firstOrNull { it.id == bookId }
                val cross = crossBookNote(balances)
                val notes = mutableListOf<String>()
                if (balances.unassignedPayerCount > 0) notes += tr("balances_unassigned", "count" to balances.unassignedPayerCount)
                if (balances.otherCurrencyCount > 0) {
                    notes += tr("balances_other_currency", "count" to balances.otherCurrencyCount, "currency" to currency)
                }
                val thisYear = Dates.today(household.timezone).take(4).toInt()
                update {
                    it.copy(
                        loading = false,
                        refreshing = false,
                        bookId = bookId,
                        books = switcher.map(::bookOptionOf),
                        showSwitcher = switcher.size > 1,
                        status = balanceState(balances),
                        you = viewerLine(balances, me),
                        people =
                            balances.people.map { p ->
                                PersonBalanceView(
                                    userId = p.userId,
                                    name = personName(p.userName),
                                    isYou = p.userId == me,
                                    balance = balanceWording(p.balanceMinor, currency),
                                    paid = Money.format(p.paidMinor, currency),
                                    share = Money.format(p.shareMinor, currency),
                                    sent = Money.format(p.sentMinor, currency),
                                    received = Money.format(p.receivedMinor, currency),
                                )
                            },
                        payments =
                            balances.suggestedPayments.map { s ->
                                SuggestedPaymentView(
                                    sentence = tr("costs_settlement_who", "from" to personName(s.fromName), "to" to personName(s.toName)),
                                    amount = Money.format(s.amountMinor, currency),
                                    fromName = personName(s.fromName),
                                    toName = personName(s.toName),
                                    fromUserId = s.fromUserId,
                                    toUserId = s.toUserId,
                                    amountInput = Money.toInput(s.amountMinor, currency),
                                )
                            },
                        notes = notes,
                        scopeNote =
                            book?.let { b ->
                                if (cross !=
                                    null
                                ) {
                                    "${tr("balances_scope_book_only", "name" to b.name)} $cross"
                                } else {
                                    tr(
                                        "balances_scope_book",
                                        "name" to b.name,
                                    )
                                }
                            } ?: cross,
                        settlements = settlements.map { s -> settlementRow(s) },
                        settlementsCount = tr("settlements_count", "count" to settlements.size),
                        years =
                            listOf(CostOption("0", tr("settlements_all_years"))) +
                                (thisYear downTo thisYear - YEARS_BACK).map { y -> CostOption(y.toString(), y.toString()) },
                        persons =
                            listOf(CostOption("", tr("settlements_all_people"))) +
                                app.household.members.map { m -> CostOption(m.id, m.name) },
                    )
                }
            }
    }

    private fun settlementRow(settlement: Settlement): SettlementRowView {
        val from = personName(settlement.fromName)
        val to = personName(settlement.toName)
        return SettlementRowView(
            id = settlement.id,
            title = tr("settlement_paid", "from" to from, "to" to to),
            meta =
                listOfNotNull(
                    Dates.format(settlement.date),
                    settlement.bookName ?: tr("costbook_all"),
                    settlement.note?.takeIf { it.isNotBlank() },
                ).joinToString(" · "),
            amount = Money.format(settlement.amountMinor, settlement.currency),
            fromUserId = settlement.fromUserId,
            toUserId = settlement.toUserId,
            fromName = from,
            toName = to,
        )
    }

    companion object {
        private const val YEARS_BACK = 5
    }
}
