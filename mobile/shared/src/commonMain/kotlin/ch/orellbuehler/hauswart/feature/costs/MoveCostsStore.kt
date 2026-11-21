package ch.orellbuehler.hauswart.feature.costs

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.CostBook
import ch.orellbuehler.hauswart.api.generated.CostsMoveToBookRequest
import ch.orellbuehler.hauswart.api.generated.MoveCostsToBookResult
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.i18n.tr

data class MoveCostsState(
    val loading: Boolean = true,
    val loadError: UiError? = null,
    /** The books that take entries. */
    val books: List<BookOption> = emptyList(),
    val bookId: String = "",
    /** "3 selected entries are moved to the chosen book ..." */
    val description: String = "",
    /** The chosen book is not tax relevant and some entries lose their tax class. */
    val taxNote: String? = null,
    val moving: Boolean = false,
    val error: UiError? = null,
    /** Set when the server refused the book. */
    val bookError: String? = null,
    /** What the move did, in one line; the dialog closes when it is set. */
    val doneText: String? = null,
)

/** What a move did in one line; what is zero is left out. */
fun moveSummary(
    result: MoveCostsToBookResult,
    bookName: String,
): String {
    if (result.moved == 0L && result.unchanged == 0L) return tr("costs_move_nothing")
    val parts = mutableListOf<String>()
    parts +=
        if (result.moved >
            0
        ) {
            tr("costs_move_moved", "count" to result.moved, "book" to bookName)
        } else {
            tr("costs_move_none", "book" to bookName)
        }
    if (result.moved > 0 && result.unchanged > 0) parts += tr("costs_move_unchanged", "count" to result.unchanged)
    if (result.deductibleReset > 0) parts += tr("costs_move_reset", "count" to result.deductibleReset)
    return parts.joinToString(" · ")
}

/** Moves the entries picked in the list into another book (`POST /costs/move-to-book`). */
class MoveCostsStore(
    private val app: HauswartApp,
    private val pick: MovePick,
) : Store<MoveCostsState>(MoveCostsState(description = tr("costs_move_description_ids", "count" to pick.ids.size))) {
    private var books: List<CostBook> = emptyList()

    init {
        load()
    }

    fun retry() {
        load()
    }

    fun chooseBook(id: String) {
        update { it.copy(bookId = id, bookError = null, error = null, taxNote = taxNoteFor(id)) }
    }

    fun move() {
        val bookId = current.bookId
        val book = books.firstOrNull { it.id == bookId }
        if (current.moving) return
        if (book == null) {
            update { it.copy(error = UiError(tr("form_check_fields"), "invalid_request")) }
            return
        }
        update { it.copy(moving = true, error = null, bookError = null) }
        launch({ e -> failed(e) }) {
            val result =
                app.api.costs.costsMoveToBook(CostsMoveToBookRequest(bookId = bookId, ids = pick.ids.distinct()))
            app.changed("costs")
            update { it.copy(moving = false, doneText = moveSummary(result, book.name)) }
        }
    }

    private fun failed(e: UiError) {
        val fields = e.fields
        when {
            e.code == "invalid_request" && "bookId" in fields ->
                update { it.copy(moving = false, bookError = tr("costs_move_book_closed"), error = null) }
            e.code == "invalid_request" && "ids" in fields ->
                update { it.copy(moving = false, error = UiError(tr("costs_move_ids_gone"), e.code)) }
            else -> update { it.copy(moving = false, error = e) }
        }
    }

    private fun taxNoteFor(bookId: String): String? {
        val book = books.firstOrNull { it.id == bookId } ?: return null
        return if (!book.taxRelevant && pick.taxClassed > 0) tr("costs_move_tax_ids", "count" to pick.taxClassed) else null
    }

    private fun load() {
        update { it.copy(loading = true, loadError = null) }
        launch({ e -> update { it.copy(loading = false, loadError = e) } }) {
            books =
                fetchAll { cursor ->
                    val page = app.api.costs.costBooksList(cursor = cursor, limit = 200)
                    page.items to page.nextCursor
                }
            val open = openBooks(books)
            val start = (open.firstOrNull { it.id !in pick.bookIds } ?: open.firstOrNull())?.id ?: ""
            update {
                it.copy(
                    loading = false,
                    books = open.map(::bookOptionOf),
                    bookId = start,
                    taxNote = taxNoteFor(start),
                )
            }
        }
    }
}
