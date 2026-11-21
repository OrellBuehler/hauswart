package ch.orellbuehler.hauswart.feature.costs

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.CostBook
import ch.orellbuehler.hauswart.api.generated.CostEntry
import ch.orellbuehler.hauswart.api.generated.CostsCreateRequest
import ch.orellbuehler.hauswart.core.monthName
import ch.orellbuehler.hauswart.i18n.tr

/** A value and the text to show for it: the choices of a dropdown or a row of chips. */
data class CostOption(
    val value: String,
    val label: String,
)

val COST_CATEGORIES: List<String> = CostsCreateRequest.CATEGORY_VALUES
val COST_SPLIT_MODES: List<String> = CostsCreateRequest.SPLIT_MODE_VALUES
val COST_DEDUCTIBLES: List<String> = CostsCreateRequest.DEDUCTIBLE_VALUES

/** A category the server sends that this build does not know shows as it is. */
fun costCategoryLabel(category: String): String = if (category in COST_CATEGORIES) tr("cost_category_$category") else category

fun costSplitLabel(mode: String): String = if (mode in COST_SPLIT_MODES) tr("cost_split_$mode") else mode

fun costSplitHint(mode: String): String = if (mode in COST_SPLIT_MODES) tr("cost_split_${mode}_hint") else ""

fun costDeductibleLabel(deductible: String): String = if (deductible in COST_DEDUCTIBLES) tr("cost_deductible_$deductible") else deductible

fun costCategoryOptions(): List<CostOption> = COST_CATEGORIES.map { CostOption(it, costCategoryLabel(it)) }

/** What the server counts as an expense by default for a category: everything but the repayment of a mortgage. */
fun countsAsExpenseByDefault(category: String): Boolean = category != "mortgage_principal"

const val MAX_COST_MINOR: Long = 100_000_000_000L
const val SHARE_BPS_TOTAL: Long = 10_000L
const val COST_TITLE_MAX: Int = 200
const val COST_NOTES_MAX: Int = 4000
const val COST_PAYEE_MAX: Int = 200

/** The key of the book the costs tab shows, per device: a book id, or [ALL_BOOKS]. */
internal const val BOOK_MEMORY = "costs.book"

/** The key of the book the last quick entry went to. */
internal const val QUICK_BOOK_MEMORY = "costs.quickBook"

/** The book value for "every book". */
const val ALL_BOOKS = ""

private const val ALL_MARKER = "all"

internal fun HauswartApp.rememberedBook(): String? = settings.load(BOOK_MEMORY)?.let { if (it == ALL_MARKER) ALL_BOOKS else it }

internal fun HauswartApp.rememberBook(bookId: String) {
    settings.save(BOOK_MEMORY, if (bookId == ALL_BOOKS) ALL_MARKER else bookId)
}

/** Books that take new entries. */
fun openBooks(books: List<CostBook>): List<CostBook> = books.filter { it.archivedAt == null }

/** The book an entry without a choice goes to. */
fun defaultBook(books: List<CostBook>): CostBook? = books.firstOrNull { it.isDefault } ?: openBooks(books).firstOrNull()

/**
 * The books the switcher offers: those that take entries, and archived ones that still hold something
 * (they count in the balances) or are the one on screen.
 */
fun switcherBooks(
    books: List<CostBook>,
    selectedId: String,
): List<CostBook> = books.filter { it.archivedAt == null || it.id == selectedId || it.entryCount > 0 || it.settlementCount > 0 }

/**
 * Which book a screen shows: the one asked for, else the remembered one; an id no book has means every book. The result
 * is [ALL_BOOKS] or the id of a book in [books].
 */
fun chooseBook(
    requested: String?,
    remembered: String?,
    books: List<CostBook>,
): String {
    fun known(id: String?) = id != null && id != ALL_BOOKS && books.any { it.id == id }
    if (requested != null) return if (known(requested)) requested else ALL_BOOKS
    return if (known(remembered)) remembered!! else ALL_BOOKS
}

/** The book a quick entry starts in: the one asked for, the one of the last quick entry, the one the list showed, the default. */
fun chooseQuickBook(
    requested: String?,
    lastUsed: String?,
    remembered: String?,
    books: List<CostBook>,
): String {
    val open = openBooks(books)
    for (id in listOf(requested, lastUsed, remembered)) {
        if (!id.isNullOrEmpty() && open.any { it.id == id }) return id
    }
    return defaultBook(books)?.id ?: ""
}

/** One person of the household as the forms need them. */
data class PersonOption(
    val id: String,
    val name: String,
    val ownershipBps: Long,
)

/** A book as the forms and the switcher show it. */
data class BookOption(
    val id: String,
    val name: String,
    val icon: String?,
    val archived: Boolean,
    val taxRelevant: Boolean,
    val defaultSplitMode: String,
)

fun bookOptionOf(book: CostBook): BookOption =
    BookOption(
        id = book.id,
        name = if (book.archivedAt != null) tr("cost_book_archived_option", "name" to book.name) else book.name,
        icon = book.icon,
        archived = book.archivedAt != null,
        taxRelevant = book.taxRelevant,
        defaultSplitMode = book.defaultSplitMode,
    )

/** A tag as the forms show it. */
data class TagOption(
    val id: String,
    val name: String,
    val color: String,
)

/** The month heading of a `YYYY-MM-DD` date: "November 2026". */
fun costMonthTitle(date: String): String {
    val year = date.take(4)
    val month = date.drop(5).take(2).toIntOrNull() ?: return date
    return if (month in 1..12) "${monthName(month)} $year" else date
}

internal fun CostEntry.isRefund(): Boolean = amountMinor < 0

/** The value of a navigation argument that names a book: `all` for every book. */
fun bookArgOf(bookId: String): String = bookId.ifEmpty { ALL_MARKER }

/** The book a navigation argument names: [ALL_BOOKS] for `all`, null when there is none (the remembered book applies). */
fun bookOfArg(arg: String?): String? =
    when {
        arg.isNullOrEmpty() -> null
        arg == ALL_MARKER -> ALL_BOOKS
        else -> arg
    }
