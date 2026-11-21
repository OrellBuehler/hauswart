package ch.orellbuehler.hauswart.feature.budgets

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.Patch
import ch.orellbuehler.hauswart.api.generated.CostBook
import ch.orellbuehler.hauswart.api.generated.CostBudget
import ch.orellbuehler.hauswart.api.generated.CostBudgetStatusItem
import ch.orellbuehler.hauswart.api.generated.CostBudgetsCreateRequest
import ch.orellbuehler.hauswart.api.generated.CostBudgetsUpdateRequest
import ch.orellbuehler.hauswart.core.Money
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.feature.costs.CostOption
import ch.orellbuehler.hauswart.feature.costs.costCategoryLabel
import ch.orellbuehler.hauswart.feature.costs.parseAmountText
import ch.orellbuehler.hauswart.feature.dashboard.TONE_DUE
import ch.orellbuehler.hauswart.feature.dashboard.TONE_OK
import ch.orellbuehler.hauswart.feature.dashboard.TONE_OVERDUE
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

/** The years the API takes for a budget status. */
const val BUDGET_MIN_YEAR = 1990
const val BUDGET_MAX_YEAR = 2200

const val BUDGET_PERIOD_MONTH = "month"
const val BUDGET_PERIOD_YEAR = "year"

val BUDGET_PERIODS: List<String> = CostBudgetsCreateRequest.PERIOD_VALUES
val BUDGET_CATEGORIES: List<String> = CostBudgetsCreateRequest.CATEGORY_VALUES

fun budgetPeriodLabel(period: String): String = if (period in BUDGET_PERIODS) tr("budget_period_$period") else period

fun budgetStateLabel(state: String): String = if (state in CostBudgetStatusItem.STATE_VALUES) tr("budget_state_$state") else state

/** What a budget is for: the category and book, or one of them and "all of the other". */
fun budgetScope(
    category: String?,
    bookName: String?,
): Pair<String, String> =
    if (category != null) {
        costCategoryLabel(category) to (bookName ?: tr("budget_all_books"))
    } else {
        (bookName ?: tr("budget_all_books")) to tr("budget_all_categories")
    }

private fun toneOf(state: String): String =
    when (state) {
        "exceeded" -> TONE_OVERDUE
        "warning" -> TONE_DUE
        else -> TONE_OK
    }

/**
 * The month or the year a budget list is measured for. A year view keeps [month] for the way back to a month view.
 */
data class BudgetPeriodView(
    val period: String,
    val year: Int,
    /** 1 to 12. */
    val month: Int,
) {
    /** The view one month (or one year) on or back; null beyond the years the API takes. */
    fun shifted(delta: Int): BudgetPeriodView? {
        val next =
            if (period == BUDGET_PERIOD_YEAR) {
                copy(year = year + delta)
            } else {
                val index = year * 12 + (month - 1) + delta
                copy(year = index.floorDiv(12), month = index - index.floorDiv(12) * 12 + 1)
            }
        return if (next.year < BUDGET_MIN_YEAR || next.year > BUDGET_MAX_YEAR) null else next
    }

    /** "November 2026" for a month, "2026" for a year. */
    fun label(): String = if (period == BUDGET_PERIOD_YEAR) year.toString() else "${tr("m_costs_month_$month")} $year"

    /** Whether this view holds [today] (`YYYY-MM-DD`). */
    fun isCurrent(today: String): Boolean {
        val todayYear = today.take(4).toIntOrNull() ?: return false
        val todayMonth = today.drop(5).take(2).toIntOrNull() ?: return false
        return year == todayYear && (period == BUDGET_PERIOD_YEAR || month == todayMonth)
    }

    companion object {
        /** The month that holds [today] (`YYYY-MM-DD`). */
        fun of(
            period: String,
            today: String,
        ): BudgetPeriodView =
            BudgetPeriodView(
                period = period,
                year = today.take(4).toIntOrNull() ?: BUDGET_MIN_YEAR,
                month = (today.drop(5).take(2).toIntOrNull() ?: 1).coerceIn(1, 12),
            )
    }
}

private val stateRank = mapOf("exceeded" to 0, "warning" to 1, "ok" to 2)

/** The statuses of one period type, the ones that need attention first, then the most used. */
internal fun itemsForPeriod(
    items: List<CostBudgetStatusItem>,
    period: String,
): List<CostBudgetStatusItem> =
    items
        .filter { it.budget.period == period }
        .sortedWith(compareBy<CostBudgetStatusItem> { stateRank[it.state] ?: 3 }.thenByDescending { it.percentUsed })

/** One active budget with how far it is used, ready to show. */
data class BudgetRowView(
    val id: String,
    val title: String,
    val subtitle: String,
    /** The scope in one line, for a screen reader and for dialogs. */
    val name: String,
    val spent: String,
    /** "von CHF 500.00". */
    val amountOf: String,
    /** 0 to 100: how full the bar is. */
    val barPercent: Int,
    /** `ok`, `warning`, `exceeded` (or what a newer server sends). */
    val state: String,
    /** A tone name for the colour of the state. */
    val tone: String,
    val stateLabel: String,
    /** "85 %". */
    val percentText: String,
    /** "Noch CHF 60.00" or "CHF 30.00 über dem Budget". */
    val remaining: String,
    val entriesText: String,
    val summary: String,
)

internal fun budgetRow(item: CostBudgetStatusItem): BudgetRowView {
    val budget = item.budget
    val currency = budget.currency
    val percent = maxOf(0L, item.percentUsed)
    val spent = Money.format(item.spentMinor, currency)
    val amount = Money.format(budget.amountMinor, currency)
    val (title, scopeSubtitle) = budgetScope(budget.category, budget.bookName)
    val subtitle = scopeSubtitle + " · " + budgetPeriodLabel(budget.period)
    val remaining =
        if (item.remainingMinor >= 0) {
            tr("budget_remaining", "amount" to Money.format(item.remainingMinor, currency))
        } else {
            tr("budget_over", "amount" to Money.format(-item.remainingMinor, currency))
        }
    val stateLabel = budgetStateLabel(item.state)
    val percentText = tr("budget_percent", "percent" to percent)
    return BudgetRowView(
        id = budget.id,
        title = title,
        subtitle = subtitle,
        name = "$title · $scopeSubtitle",
        spent = spent,
        amountOf = tr("budget_of", "amount" to amount),
        barPercent = minOf(100L, percent).toInt(),
        state = item.state,
        tone = toneOf(item.state),
        stateLabel = stateLabel,
        percentText = percentText,
        remaining = remaining,
        entriesText = tr("budget_entries", "count" to item.entryCount),
        summary = tr("budget_summary", "state" to stateLabel, "percent" to percentText, "spent" to spent, "amount" to amount),
    )
}

/** A paused budget: kept, but neither counted nor warned about. */
data class PausedBudgetView(
    val id: String,
    val title: String,
    /** Scope and period: "Alle Kategorien · Monat". */
    val subtitle: String,
    val name: String,
    val amount: String,
)

internal fun pausedRow(budget: CostBudget): PausedBudgetView {
    val (title, scopeSubtitle) = budgetScope(budget.category, budget.bookName)
    return PausedBudgetView(
        id = budget.id,
        title = title,
        subtitle = scopeSubtitle + " · " + budgetPeriodLabel(budget.period),
        name = "$title · $scopeSubtitle",
        amount = Money.format(budget.amountMinor, budget.currency),
    )
}

data class BudgetsState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val period: String = BUDGET_PERIOD_MONTH,
    val year: Int = 0,
    val month: Int = 0,
    /** "November 2026" or "2026". */
    val periodLabel: String = "",
    /** The shown period is the one that holds today. */
    val isCurrent: Boolean = true,
    val canPrevious: Boolean = true,
    val canNext: Boolean = true,
    /** The label of the button back to today: "Dieser Monat" or "Dieses Jahr". */
    val todayLabel: String = "",
    /** The household has any budget at all, of either period. */
    val hasBudgets: Boolean = false,
    val rows: List<BudgetRowView> = emptyList(),
    val paused: List<PausedBudgetView> = emptyList(),
    val countText: String = "",
    val legend: String = "",
    val emptyTitle: String = "",
    val emptyBody: String = "",
    /** The budget a pause, resume or delete is running for. */
    val busyId: String? = null,
    /** A failed pause, resume or delete; the list is still shown. */
    val actionError: UiError? = null,
    /** What was done ("Budget «Wohnung» pausiert."), shown once. */
    val notice: String? = null,
)

/** The active budgets of a month or a year with how far each is used, and the paused ones. */
class BudgetsStore(
    private val app: HauswartApp,
) : Store<BudgetsState>(BudgetsState()) {
    private var budgets: List<CostBudget> = emptyList()
    private var items: List<CostBudgetStatusItem> = emptyList()
    private var warningPercent = 80L
    private var view = BudgetPeriodView(BUDGET_PERIOD_MONTH, 0, 1)
    private var today = ""
    private var job: Job? = null

    init {
        onChange(app, "costs") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun selectPeriod(period: String) {
        if (period !in BUDGET_PERIODS || period == view.period) return
        view = view.copy(period = period)
        show()
    }

    fun previous() = move(-1)

    fun next() = move(1)

    private fun move(delta: Int) {
        val moved = view.shifted(delta) ?: return
        view = moved
        load()
    }

    fun goToToday() {
        if (today.isEmpty()) return
        view = BudgetPeriodView.of(view.period, today)
        load()
    }

    fun pause(id: String) = setActive(id, false)

    fun resume(id: String) = setActive(id, true)

    private fun setActive(
        id: String,
        active: Boolean,
    ) {
        val budget = budgets.firstOrNull { it.id == id } ?: return
        if (current.busyId != null) return
        update { it.copy(busyId = id, actionError = null) }
        launch({ e -> update { it.copy(busyId = null, actionError = e) } }) {
            app.api.costs.costBudgetsUpdate(id, CostBudgetsUpdateRequest(active = active))
            val name = nameOf(budget)
            update {
                it.copy(
                    busyId = null,
                    notice = tr(if (active) "budget_resumed_toast" else "budget_paused_toast", "name" to name),
                )
            }
            app.changed("costs")
        }
    }

    fun delete(id: String) {
        val budget = budgets.firstOrNull { it.id == id } ?: return
        if (current.busyId != null) return
        update { it.copy(busyId = id, actionError = null) }
        launch({ e -> update { it.copy(busyId = null, actionError = e) } }) {
            app.api.costs.costBudgetsDelete(id)
            update { it.copy(busyId = null, notice = tr("budget_deleted_toast", "name" to nameOf(budget))) }
            app.changed("costs")
        }
    }

    /** What the delete dialog says. */
    fun deleteText(id: String): String =
        tr(
            "budget_delete_description",
            "name" to (budgets.firstOrNull { it.id == id }?.let(::nameOf) ?: ""),
        )

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    fun dismissNotice() {
        update { it.copy(notice = null) }
    }

    private fun nameOf(budget: CostBudget): String {
        val (title, subtitle) = budgetScope(budget.category, budget.bookName)
        return "$title · $subtitle"
    }

    private fun load() {
        job?.cancel()
        update { it.copy(loading = !it.hasBudgets, error = null) }
        job =
            launch({ e -> update { it.copy(loading = false, error = e) } }) {
                app.household.get()
                today = app.household.today()
                if (view.year == 0) view = BudgetPeriodView.of(view.period, today)
                val wanted = view
                val (list, status) =
                    coroutineScope {
                        val listed = async { app.api.costs.costBudgetsList() }
                        val measured = async { app.api.costs.costBudgetsStatus(year = wanted.year.toLong(), month = wanted.month.toLong()) }
                        listed.await() to measured.await()
                    }
                budgets = list.items
                items = status.items
                warningPercent = status.warningPercent
                show()
                update { it.copy(loading = false) }
            }
    }

    private fun show() {
        val rows = itemsForPeriod(items, view.period).map(::budgetRow)
        val paused = budgets.filter { !it.active && it.period == view.period }.map(::pausedRow)
        val year = view.period == BUDGET_PERIOD_YEAR
        update {
            it.copy(
                period = view.period,
                year = view.year,
                month = view.month,
                periodLabel = view.label(),
                isCurrent = view.isCurrent(today),
                canPrevious = view.shifted(-1) != null,
                canNext = view.shifted(1) != null,
                todayLabel = tr(if (year) "budgets_today_year" else "budgets_today_month"),
                hasBudgets = budgets.isNotEmpty(),
                rows = rows,
                paused = paused,
                countText = tr("budgets_count", "count" to rows.size),
                legend = tr("budgets_legend", "percent" to warningPercent),
                emptyTitle = tr(if (year) "budgets_empty_year_title" else "budgets_empty_month_title"),
                emptyBody = tr(if (year) "budgets_empty_year_body" else "budgets_empty_month_body"),
            )
        }
    }
}

/** What the budget form holds, as typed. [bookId] and [category] are empty for "all". */
data class BudgetForm(
    val bookId: String = "",
    val category: String = "",
    val period: String = BUDGET_PERIOD_MONTH,
    val amount: String = "",
    val active: Boolean = true,
)

data class BudgetEditState(
    val isNew: Boolean,
    val loading: Boolean,
    val loadError: UiError? = null,
    val initial: BudgetForm? = null,
    /** "Alle Bücher" first, then the books that take entries (and the one the budget has). */
    val books: List<CostOption> = emptyList(),
    /** "Alle Kategorien" first. */
    val categories: List<CostOption> = emptyList(),
    val periods: List<CostOption> = emptyList(),
    /** The budget's currency, behind the amount. */
    val currency: String = "",
    val saving: Boolean = false,
    val error: UiError? = null,
    /** Messages per field (`bookId`, `amountMinor`). */
    val fieldErrors: Map<String, String> = emptyMap(),
    val savedId: String? = null,
)

/** Makes a budget ([id] null) or changes one. */
class BudgetEditStore(
    private val app: HauswartApp,
    private val id: String?,
    private val requestedPeriod: String? = null,
) : Store<BudgetEditState>(BudgetEditState(isNew = id == null, loading = true)) {
    private var saved: CostBudget? = null
    private var currency = "CHF"

    init {
        load()
    }

    fun retry() {
        load()
    }

    fun save(form: BudgetForm) {
        if (current.saving) return
        val errors = check(form)
        if (errors.isNotEmpty()) {
            update { it.copy(fieldErrors = errors, error = null) }
            return
        }
        val amount = requireNotNull(parseAmountText(form.amount, currency).minor)
        update { it.copy(saving = true, error = null, fieldErrors = emptyMap()) }
        launch({ e -> failed(e) }) {
            val before = saved
            val result =
                if (before == null) {
                    app.api.costs.costBudgetsCreate(
                        CostBudgetsCreateRequest(
                            bookId = form.bookId.ifEmpty { null },
                            category = form.category.ifEmpty { null },
                            period = form.period,
                            amountMinor = amount,
                            active = form.active,
                        ),
                    )
                } else {
                    val request = updateRequest(form, before, amount)
                    if (request == CostBudgetsUpdateRequest()) before else app.api.costs.costBudgetsUpdate(before.id, request)
                }
            app.changed("costs")
            update { it.copy(saving = false, savedId = result.id) }
        }
    }

    private fun updateRequest(
        form: BudgetForm,
        before: CostBudget,
        amount: Long,
    ): CostBudgetsUpdateRequest =
        CostBudgetsUpdateRequest(
            bookId = if (form.bookId.ifEmpty { null } != before.bookId) Patch.of(form.bookId.ifEmpty { null }) else Patch.Keep,
            category = if (form.category.ifEmpty { null } != before.category) Patch.of(form.category.ifEmpty { null }) else Patch.Keep,
            period = form.period.takeIf { it != before.period },
            amountMinor = amount.takeIf { it != before.amountMinor },
            active = form.active.takeIf { it != before.active },
        )

    private fun failed(e: UiError) {
        val fields =
            when {
                e.code == "conflict" -> mapOf("bookId" to tr("budget_error_exists"))
                e.code == "invalid_request" && "bookId" in e.fields -> e.fields + ("bookId" to tr("budget_error_scope"))
                else -> e.fields
            }
        update { it.copy(saving = false, error = if (fields.isEmpty()) e else null, fieldErrors = fields) }
    }

    private fun check(form: BudgetForm): Map<String, String> {
        val errors = mutableMapOf<String, String>()
        if (form.bookId.isEmpty() && form.category.isEmpty()) errors["bookId"] = tr("budget_error_scope")
        val amount = parseAmountText(form.amount, currency)
        if (amount.error != null) {
            errors["amountMinor"] = amount.error
        } else if ((amount.minor ?: 0L) < 0) {
            errors["amountMinor"] = tr("budget_error_amount")
        }
        return errors
    }

    private fun load() {
        update { it.copy(loading = true, loadError = null) }
        launch({ e -> update { it.copy(loading = false, loadError = e) } }) {
            val household = app.household.get()
            val (books, existing) =
                coroutineScope {
                    val bookList =
                        async {
                            fetchAll { cursor ->
                                val page = app.api.costs.costBooksList(cursor = cursor, limit = 200, includeArchived = true)
                                page.items to page.nextCursor
                            }
                        }
                    val budget = id?.let { wanted -> async { app.api.costs.costBudgetsGet(wanted) } }
                    bookList.await() to budget?.await()
                }
            saved = existing
            currency = existing?.currency ?: household.currency
            val form =
                if (existing == null) {
                    BudgetForm(period = requestedPeriod?.takeIf { it in BUDGET_PERIODS } ?: BUDGET_PERIOD_MONTH)
                } else {
                    BudgetForm(
                        bookId = existing.bookId ?: "",
                        category = existing.category ?: "",
                        period = existing.period,
                        amount = Money.toInput(existing.amountMinor, existing.currency),
                        active = existing.active,
                    )
                }
            update {
                it.copy(
                    loading = false,
                    initial = form,
                    currency = currency,
                    books = bookChoices(books, existing?.bookId),
                    categories =
                        listOf(CostOption("", tr("budget_all_categories"))) +
                            BUDGET_CATEGORIES.map { c -> CostOption(c, costCategoryLabel(c)) },
                    periods = BUDGET_PERIODS.map { p -> CostOption(p, budgetPeriodLabel(p)) },
                )
            }
        }
    }

    private fun bookChoices(
        books: List<CostBook>,
        currentId: String?,
    ): List<CostOption> =
        listOf(CostOption("", tr("budget_all_books"))) +
            books
                .filter { it.archivedAt == null || it.id == currentId }
                .map { CostOption(it.id, if (it.archivedAt != null) tr("cost_book_archived_option", "name" to it.name) else it.name) }
}
