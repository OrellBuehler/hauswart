package ch.orellbuehler.hauswart.feature.parts

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.OrderNowItem
import ch.orellbuehler.hauswart.api.generated.Part
import ch.orellbuehler.hauswart.api.generated.PartsOrderedRequest
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

data class PartsListState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val query: String = "",
    val lowOnly: Boolean = false,
    val showArchived: Boolean = false,
    val rows: List<PartRow> = emptyList(),
    /** The parts that are not archived. */
    val total: Int = 0,
    /** The part list is empty altogether (archived ones included). */
    val none: Boolean = false,
    val hasArchived: Boolean = false,
    /** Parts that are low or empty. */
    val lowCount: Int = 0,
    val orderNow: List<OrderNowRow> = emptyList(),
    /** The part whose "ordered" tap is running. */
    val busyPartId: String? = null,
    val notice: PartNotice? = null,
    val actionError: UiError? = null,
) {
    val filtered: Boolean get() = lowOnly || query.isNotBlank()
    val shown: Int get() = rows.size
    val countText: String get() = tr("parts_count", "shown" to shown, "total" to total)
}

class PartsListStore(
    private val app: HauswartApp,
) : Store<PartsListState>(PartsListState()) {
    private var all: List<Part> = emptyList()
    private var items: List<OrderNowItem> = emptyList()
    private var today = ""

    init {
        onChange(app, "parts", "tasks") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun search(query: String) {
        update { it.copy(query = query) }
        show()
    }

    fun setLowOnly(value: Boolean) {
        update { it.copy(lowOnly = value) }
        show()
    }

    fun setShowArchived(value: Boolean) {
        update { it.copy(showArchived = value) }
        show()
    }

    fun reset() {
        update { it.copy(query = "", lowOnly = false) }
        show()
    }

    /** Marks the part of [item] as ordered in the quantity the list asks for; the notice offers to take it back. */
    fun markOrdered(partId: String) {
        val item = items.firstOrNull { it.partId == partId } ?: return
        if (current.busyPartId != null) return
        update { it.copy(busyPartId = partId, actionError = null) }
        launch({ e -> update { it.copy(busyPartId = null, actionError = e) } }) {
            app.api.parts.partsOrdered(partId, PartsOrderedRequest(qty = item.quantity))
            update {
                it.copy(
                    busyPartId = null,
                    notice = PartNotice(tr("part_ordered_toast_qty", "name" to item.partName, "qty" to item.quantity), undoPartId = partId),
                )
            }
            app.changed("parts")
        }
    }

    fun undoOrdered(partId: String) {
        update { it.copy(notice = null, actionError = null) }
        launch({ e -> update { it.copy(actionError = e) } }) {
            app.api.parts.partsOrdered(partId, PartsOrderedRequest(qty = 0))
            update { it.copy(notice = PartNotice(tr("toast_undone"))) }
            app.changed("parts")
        }
    }

    fun dismissNotice() {
        update { it.copy(notice = null) }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    private fun load() {
        update { it.copy(loading = all.isEmpty() && it.rows.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            app.household.get()
            today = app.household.today()
            val (parts, order) =
                coroutineScope {
                    val p =
                        async {
                            fetchAll { cursor ->
                                val page = app.api.parts.partsList(cursor = cursor, limit = 200, includeArchived = true)
                                page.items to page.nextCursor
                            }
                        }
                    val o = async { app.api.parts.partsOrderNow() }
                    p.await() to o.await()
                }
            all = parts
            items = order.items
            update { it.copy(loading = false) }
            show()
        }
    }

    private fun show() {
        val state = current
        val needle = state.query.trim().lowercase()
        val active = all.filter { it.archivedAt == null }
        val visible =
            all.filter { part ->
                (part.archivedAt == null || state.showArchived) &&
                    (!state.lowOnly || partStockLevel(part.stockCount, part.minStock) != STOCK_OK) &&
                    (needle.isEmpty() || partSearchable(part).any { it?.lowercase()?.contains(needle) == true })
            }
        update {
            it.copy(
                rows = visible.map(::partRow),
                total = active.size,
                none = all.isEmpty(),
                hasArchived = all.any { p -> p.archivedAt != null },
                lowCount = active.count { p -> partStockLevel(p.stockCount, p.minStock) != STOCK_OK },
                orderNow = items.map { i -> orderNowRow(i, today) },
            )
        }
    }
}
