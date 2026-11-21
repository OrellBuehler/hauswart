package ch.orellbuehler.hauswart.feature.costbooks

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.ApiException
import ch.orellbuehler.hauswart.api.Patch
import ch.orellbuehler.hauswart.api.generated.CostBook
import ch.orellbuehler.hauswart.api.generated.CostBooksCreateRequest
import ch.orellbuehler.hauswart.api.generated.CostBooksUpdateRequest
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.feature.costs.CostOption
import ch.orellbuehler.hauswart.feature.costs.costSplitLabel
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull

const val COST_BOOK_NAME_MAX = 60

/** The icons a book can carry, keyed by the name stored on the book, with the key of the label. */
private val ICON_LABELS: List<Pair<String, String>> =
    listOf(
        "house" to "house",
        "shopping-basket" to "shopping",
        "car" to "car",
        "plane" to "travel",
        "tent" to "camping",
        "users" to "group",
        "utensils" to "food",
        "party-popper" to "party",
        "gift" to "gifts",
        "heart" to "heart",
        "baby" to "child",
        "paw-print" to "pet",
        "bike" to "bike",
        "graduation-cap" to "education",
        "briefcase" to "work",
        "hammer" to "renovation",
        "piggy-bank" to "savings",
        "wallet" to "wallet",
    )

/** The icon choices of the book form. */
fun bookIconOptions(): List<CostOption> = ICON_LABELS.map { (key, label) -> CostOption(key, tr("costbook_icon_$label")) }

/** The label of a stored icon name; null for none or one this build does not know. */
fun bookIconLabel(icon: String?): String? = ICON_LABELS.firstOrNull { it.first == icon }?.let { tr("costbook_icon_${it.second}") }

private val BOOK_SPLITS: List<String> = CostBooksCreateRequest.DEFAULT_SPLIT_MODE_VALUES

fun bookSplitOptions(): List<CostOption> = BOOK_SPLITS.map { CostOption(it, costSplitLabel(it)) }

fun bookSplitHint(mode: String): String = if (mode in BOOK_SPLITS) tr("costbook_split_${mode}_hint") else ""

/** One book of the list. */
data class BookRowView(
    val id: String,
    val name: String,
    val icon: String?,
    val isDefault: Boolean,
    val archived: Boolean,
    val taxRelevant: Boolean,
    /** "Nach Eigentumsanteilen · 12 Einträge · 2 Zahlungen". */
    val meta: String,
    val canMakeDefault: Boolean,
    val canMoveUp: Boolean,
    val canMoveDown: Boolean,
)

data class CostBooksState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val open: List<BookRowView> = emptyList(),
    val archived: List<BookRowView> = emptyList(),
    val total: Int = 0,
    val busyId: String? = null,
    val actionError: UiError? = null,
    val notice: String? = null,
)

/** The reason a book could not be deleted or archived, in words; null for any other error. */
internal fun bookConflictMessage(
    e: ApiException,
    name: String,
): String? {
    if (e.code != "conflict") return null
    val details = e.details as? JsonObject
    val entries = (details?.get("entryCount") as? JsonPrimitive)?.longOrNull
    val payments = (details?.get("settlementCount") as? JsonPrimitive)?.longOrNull
    return if (entries != null && payments != null) {
        tr(
            "costbook_error_in_use",
            "name" to name,
            "entries" to tr("costbook_entry_count", "count" to entries),
            "payments" to tr("costbook_payment_count", "count" to payments),
        )
    } else {
        tr("costbook_error_last")
    }
}

/** Why a book could not be made the default, in words; null for any other error. */
internal fun bookDefaultMessage(
    e: ApiException,
    name: String,
): String? =
    when {
        e.code == "invalid_request" && "isDefault" in e.fieldErrors -> tr("costbook_error_default_archived", "name" to name)
        e.code == "conflict" -> tr("costbook_error_default_conflict")
        else -> null
    }

/** The cost books: the ones that take entries (in order), and the archived ones. */
class CostBooksStore(
    private val app: HauswartApp,
) : Store<CostBooksState>(CostBooksState()) {
    private var books: List<CostBook> = emptyList()

    init {
        onChange(app, "costs") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun archive(id: String) = setArchived(id, true)

    fun restore(id: String) = setArchived(id, false)

    private fun setArchived(
        id: String,
        archive: Boolean,
    ) {
        val book = books.firstOrNull { it.id == id } ?: return
        run(id, { e -> bookConflictMessage(e, book.name) }) {
            app.api.costs.costBooksUpdate(id, CostBooksUpdateRequest(archived = archive))
            tr(if (archive) "costbook_archived_toast" else "costbook_restored_toast", "name" to book.name)
        }
    }

    fun makeDefault(id: String) {
        val book = books.firstOrNull { it.id == id } ?: return
        run(id, { e -> bookDefaultMessage(e, book.name) }) {
            app.api.costs.costBooksUpdate(id, CostBooksUpdateRequest(isDefault = true))
            tr("costbook_default_toast", "name" to book.name)
        }
    }

    fun delete(id: String) {
        val book = books.firstOrNull { it.id == id } ?: return
        run(id, { e -> bookConflictMessage(e, book.name) }) {
            app.api.costs.costBooksDelete(id)
            tr("costbook_deleted_toast", "name" to book.name)
        }
    }

    fun deleteText(id: String): String = tr("costbook_delete_description", "name" to (books.firstOrNull { it.id == id }?.name ?: ""))

    /** Moves an open book one place up (-1) or down (1); the order is kept by every book's `sortOrder`. */
    fun move(
        id: String,
        delta: Int,
    ) {
        val open = books.filter { it.archivedAt == null }
        val from = open.indexOfFirst { it.id == id }
        val to = from + delta
        if (from < 0 || to !in open.indices || current.busyId != null) return
        val order = open.toMutableList().also { it.add(to, it.removeAt(from)) }
        update { it.copy(busyId = id, actionError = null) }
        launch({ e ->
            update { it.copy(busyId = null, actionError = e) }
            app.changed("costs")
        }) {
            order.forEachIndexed { position, book ->
                if (book.sortOrder != position.toLong()) {
                    app.api.costs.costBooksUpdate(book.id, CostBooksUpdateRequest(sortOrder = position.toLong()))
                }
            }
            update { it.copy(busyId = null) }
            app.changed("costs")
        }
    }

    private fun run(
        id: String,
        explain: (ApiException) -> String?,
        block: suspend () -> String,
    ) {
        if (current.busyId != null) return
        update { it.copy(busyId = id, actionError = null) }
        launch({ e ->
            update { it.copy(busyId = null, actionError = e) }
            app.changed("costs")
        }) {
            try {
                val message = block()
                update { it.copy(busyId = null, notice = message) }
                app.changed("costs")
            } catch (e: ApiException) {
                val text = explain(e)
                if (text == null) throw e
                update { it.copy(busyId = null, actionError = UiError(text, e.code)) }
                app.changed("costs")
            }
        }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    fun dismissNotice() {
        update { it.copy(notice = null) }
    }

    private fun load() {
        update { it.copy(loading = books.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            books =
                fetchAll { cursor ->
                    val page = app.api.costs.costBooksList(cursor = cursor, limit = 200, includeArchived = true)
                    page.items to page.nextCursor
                }
            val open = books.filter { it.archivedAt == null }
            update {
                it.copy(
                    loading = false,
                    open = open.mapIndexed { i, b -> row(b, i > 0, i < open.size - 1) },
                    archived = books.filter { b -> b.archivedAt != null }.map { b -> row(b, false, false) },
                    total = books.size,
                )
            }
        }
    }

    private fun row(
        b: CostBook,
        up: Boolean,
        down: Boolean,
    ) = BookRowView(
        id = b.id,
        name = b.name,
        icon = b.icon,
        isDefault = b.isDefault,
        archived = b.archivedAt != null,
        taxRelevant = b.taxRelevant,
        meta =
            listOf(
                costSplitLabel(b.defaultSplitMode),
                tr("costbook_entry_count", "count" to b.entryCount),
                tr("costbook_payment_count", "count" to b.settlementCount),
            ).joinToString(" · "),
        canMakeDefault = b.archivedAt == null && !b.isDefault,
        canMoveUp = up,
        canMoveDown = down,
    )
}

/** What the book form holds. [icon] is empty for none. */
data class BookForm(
    val name: String = "",
    val icon: String = "",
    val defaultSplitMode: String = "ownership",
    val taxRelevant: Boolean = false,
)

data class BookEditState(
    val isNew: Boolean,
    val loading: Boolean,
    val loadError: UiError? = null,
    val initial: BookForm? = null,
    val icons: List<CostOption> = emptyList(),
    val splits: List<CostOption> = emptyList(),
    val saving: Boolean = false,
    val error: UiError? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    val savedId: String? = null,
)

/** Makes a book ([id] null) or changes one. */
class BookEditStore(
    private val app: HauswartApp,
    private val id: String?,
) : Store<BookEditState>(
        BookEditState(
            isNew = id == null,
            loading = id != null,
            initial = if (id == null) BookForm() else null,
            icons = bookIconOptions(),
            splits = bookSplitOptions(),
        ),
    ) {
    private var book: CostBook? = null

    init {
        if (id != null) load(id)
    }

    fun retry() {
        if (id != null) load(id)
    }

    fun splitHint(mode: String): String = tr("costbook_default_split_hint") + " " + bookSplitHint(mode)

    fun save(form: BookForm) {
        if (current.saving) return
        val name = form.name.trim()
        if (name.isEmpty()) {
            update { it.copy(fieldErrors = mapOf("name" to tr("m_field_required")), error = null) }
            return
        }
        if (name.length > COST_BOOK_NAME_MAX) {
            update { it.copy(fieldErrors = mapOf("name" to tr("field_too_long", "max" to COST_BOOK_NAME_MAX)), error = null) }
            return
        }
        update { it.copy(saving = true, error = null, fieldErrors = emptyMap()) }
        launch({ e ->
            val fields = if (e.code == "conflict") mapOf("name" to tr("costbook_error_name_taken")) else e.fields
            update { it.copy(saving = false, error = if (fields.isEmpty()) e else null, fieldErrors = fields) }
        }) {
            val before = book
            val saved =
                if (before == null) {
                    app.api.costs.costBooksCreate(
                        CostBooksCreateRequest(
                            name = name,
                            icon = form.icon.ifEmpty { null },
                            defaultSplitMode = form.defaultSplitMode,
                            taxRelevant = form.taxRelevant,
                        ),
                    )
                } else {
                    val request =
                        CostBooksUpdateRequest(
                            name = name.takeIf { it != before.name },
                            icon = if (form.icon.ifEmpty { null } != before.icon) Patch.of(form.icon.ifEmpty { null }) else Patch.Keep,
                            defaultSplitMode = form.defaultSplitMode.takeIf { it != before.defaultSplitMode },
                            taxRelevant = form.taxRelevant.takeIf { it != before.taxRelevant },
                        )
                    if (request == CostBooksUpdateRequest()) before else app.api.costs.costBooksUpdate(before.id, request)
                }
            app.changed("costs")
            update { it.copy(saving = false, savedId = saved.id) }
        }
    }

    private fun load(bookId: String) {
        update { it.copy(loading = true, loadError = null) }
        launch({ e -> update { it.copy(loading = false, loadError = e) } }) {
            val b = app.api.costs.costBooksGet(bookId)
            book = b
            update {
                it.copy(
                    loading = false,
                    initial = BookForm(b.name, b.icon ?: "", b.defaultSplitMode, b.taxRelevant),
                )
            }
        }
    }
}
