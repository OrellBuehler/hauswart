package ch.orellbuehler.hauswart.feature.costs

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.CostBook
import ch.orellbuehler.hauswart.api.generated.CostsSummary
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Money
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.core.monthName
import ch.orellbuehler.hauswart.i18n.tr
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToLong

/** One line of a report card: a name, its amount, its share of the whole and a bar. */
data class ReportRow(
    val key: String,
    val label: String,
    val amount: String,
    /** "12.5 %"; empty when there is no whole to measure against. */
    val percent: String,
    /** The length of the bar, 0 to 1. */
    val fraction: Float,
    /** A refund: the bar is drawn in the other tone. */
    val negative: Boolean,
)

data class ReportCard(
    val id: String,
    val title: String,
    val hint: String,
    val rows: List<ReportRow>,
    val emptyText: String,
    /** Under the rows: "Steuerrelevante Bücher zusammen" and its sum. */
    val footerLabel: String? = null,
    val footerValue: String? = null,
)

data class CostsReportState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val books: List<BookOption> = emptyList(),
    /** [ALL_BOOKS] (empty) or the id of the book on screen. */
    val bookId: String = ALL_BOOKS,
    val showSwitcher: Boolean = false,
    val year: Int = 0,
    val yearLabel: String = "",
    val title: String = "",
    /** The year has nothing to evaluate. */
    val empty: Boolean = false,
    val emptyText: String = "",
    val cards: List<ReportCard> = emptyList(),
)

internal const val CARD_MONTH = "month"
internal const val CARD_CATEGORY = "category"
internal const val CARD_ASSET = "asset"
internal const val CARD_TAX = "tax"

/** A part of a whole in basis points, rounded to a tenth of a percent; null without a positive whole. */
internal fun shareBps(
    value: Long,
    whole: Long,
): Long? {
    if (whole <= 0) return null
    val bps = (value.toDouble() / whole * 10_000).roundToLong()
    return (abs(bps) + 5) / 10 * 10 * (if (bps < 0) -1 else 1)
}

private fun percentText(
    value: Long,
    whole: Long,
): String {
    val bps = shareBps(value, whole) ?: return ""
    val text = shareToInput(abs(bps))
    return tr("cost_percent", "value" to (if (bps < 0) "-$text" else text))
}

private fun rowsOf(
    entries: List<Triple<String, String, Long>>,
    currency: String,
    whole: Long,
): List<ReportRow> {
    val biggest = entries.maxOfOrNull { abs(it.third) } ?: 0L
    return entries.map { (key, label, total) ->
        ReportRow(
            key = key,
            label = label,
            amount = Money.format(total, currency),
            percent = percentText(total, whole),
            fraction = if (biggest > 0) max(0.02f, (abs(total).toDouble() / biggest).toFloat()) else 0f,
            negative = total < 0,
        )
    }
}

/** The report cards of a year's summary: by month, category, device and tax class. */
internal fun reportCards(summary: CostsSummary): List<ReportCard> {
    val currency = summary.currency
    val total = summary.expenseTotalMinor
    val taxRows = summary.byDeductible.filter { it.count > 0 || it.totalMinor != 0L }
    val taxSum = summary.byDeductible.sumOf { it.totalMinor }
    return listOf(
        ReportCard(
            id = CARD_MONTH,
            title = tr("costs_by_month"),
            hint = "",
            rows =
                rowsOf(
                    summary.byMonth
                        .filter { it.count > 0 }
                        .map {
                            Triple(
                                it.month,
                                monthName(
                                    it.month
                                        .drop(5)
                                        .take(2)
                                        .toIntOrNull() ?: 1,
                                ),
                                it.totalMinor,
                            )
                        },
                    currency,
                    total,
                ),
            emptyText = tr("costs_nothing_here"),
        ),
        ReportCard(
            id = CARD_CATEGORY,
            title = tr("costs_by_category"),
            hint = "",
            rows = rowsOf(summary.byCategory.map { Triple(it.category, costCategoryLabel(it.category), it.totalMinor) }, currency, total),
            emptyText = tr("costs_nothing_here"),
        ),
        ReportCard(
            id = CARD_ASSET,
            title = tr("costs_by_asset"),
            hint = "",
            rows = rowsOf(summary.byAsset.map { Triple(it.assetId, it.assetName, it.totalMinor) }, currency, total),
            emptyText = tr("costs_nothing_here"),
        ),
        ReportCard(
            id = CARD_TAX,
            title = tr("costs_by_tax"),
            hint = "",
            rows = rowsOf(taxRows.map { Triple(it.deductible, costDeductibleLabel(it.deductible), it.totalMinor) }, currency, taxSum),
            emptyText = tr("costs_nothing_here"),
            footerLabel = if (taxRows.isEmpty()) null else tr("costs_by_tax_total"),
            footerValue = if (taxRows.isEmpty()) null else Money.format(taxSum, currency),
        ),
    )
}

/** The year's costs of a book (or every book) by month, category, device and tax class. */
class CostsReportStore(
    private val app: HauswartApp,
    private val requestedBook: String?,
    private val requestedYear: Int,
) : Store<CostsReportState>(CostsReportState()) {
    private var books: List<CostBook> = emptyList()
    private var chosen: String? = bookOfArg(requestedBook)

    init {
        onChange(app, "costs") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun selectBook(bookId: String) {
        chosen = bookId
        update { it.copy(bookId = bookId) }
        load()
    }

    fun previousYear() = setYear(current.year - 1)

    fun nextYear() = setYear(current.year + 1)

    private fun setYear(year: Int) {
        if (year < CostsListStore.MIN_YEAR || year > CostsListStore.MAX_YEAR) return
        update { it.copy(year = year) }
        load()
    }

    private fun load() {
        update { it.copy(loading = it.cards.isEmpty() && !it.empty, error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            val household = app.household.get()
            books =
                fetchAll { cursor ->
                    val page = app.api.costs.costBooksList(cursor = cursor, limit = 200, includeArchived = true)
                    page.items to page.nextCursor
                }
            val bookId = chooseBook(chosen, app.rememberedBook(), books)
            chosen = bookId
            val year =
                current.year.takeIf { it != 0 } ?: requestedYear.takeIf { it != 0 } ?: Dates.today(household.timezone).take(4).toInt()
            val summary = app.api.costs.costsSummary(year = year.toLong(), bookId = bookId.ifEmpty { null })
            val switcher = switcherBooks(books, bookId)
            val cards = reportCards(summary)
            val empty = summary.byCategory.isEmpty() && summary.byMonth.all { it.count == 0L }
            update {
                it.copy(
                    loading = false,
                    bookId = bookId,
                    books = switcher.map(::bookOptionOf),
                    showSwitcher = switcher.size > 1,
                    year = year,
                    yearLabel = year.toString(),
                    title = books.firstOrNull { b -> b.id == bookId }?.name ?: tr("costbook_all"),
                    empty = empty,
                    emptyText = tr("costs_report_empty", "year" to year),
                    cards = if (empty) emptyList() else cards,
                )
            }
        }
    }
}
