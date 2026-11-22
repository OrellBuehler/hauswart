package ch.orellbuehler.hauswart.feature.parts

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.PartsOrderedRequest
import ch.orellbuehler.hauswart.api.generated.PartsStockRequest
import ch.orellbuehler.hauswart.api.generated.PartsUpdateRequest
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

private const val MOVEMENTS_PAGE = 20L

data class PartDetailState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val view: PartView? = null,
    val movements: List<PartMovementRow> = emptyList(),
    val moreMovements: Boolean = false,
    val loadingMore: Boolean = false,
    /** A write is running. */
    val busy: Boolean = false,
    val actionError: UiError? = null,
    val notice: PartNotice? = null,
    val deleted: Boolean = false,
)

class PartDetailStore(
    private val app: HauswartApp,
    private val id: String,
) : Store<PartDetailState>(PartDetailState()) {
    private var cursor: String? = null
    private var loaded: List<PartMovementRow> = emptyList()

    init {
        onChange(app, "parts", "assets", "tasks") { if (!current.deleted) load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun loadMore() {
        val next = cursor ?: return
        if (current.loadingMore) return
        update { it.copy(loadingMore = true) }
        launch({ e -> update { it.copy(loadingMore = false, actionError = e) } }) {
            val page = app.api.parts.partsMovements(id, cursor = next, limit = MOVEMENTS_PAGE)
            val zone = app.household.timezone
            loaded = loaded + page.items.map { partMovementRow(it, zone) }
            cursor = page.nextCursor
            update { it.copy(loadingMore = false, movements = loaded, moreMovements = cursor != null) }
        }
    }

    /** Books one piece out ([used]) or in; the stock cannot go below zero. */
    fun quick(used: Boolean) {
        val view = current.view ?: return
        if (used && !view.canUseOne) return
        write {
            app.api.parts.partsStock(
                id,
                PartsStockRequest(delta = if (used) -1 else 1, reason = if (used) "used" else "bought"),
            )
            null
        }
    }

    fun clearOrder() {
        write {
            app.api.parts.partsOrdered(id, PartsOrderedRequest(qty = 0))
            tr("part_order_cleared_toast")
        }
    }

    fun toggleArchive() {
        val view = current.view ?: return
        val archive = !view.archived
        write {
            app.api.parts.partsUpdate(id, PartsUpdateRequest(archived = archive))
            tr(if (archive) "part_archived_toast" else "part_restored_toast", "name" to view.name)
        }
    }

    fun unlinkAsset(assetId: String) {
        val name =
            current.view
                ?.assets
                ?.firstOrNull { it.id == assetId }
                ?.name ?: return
        write {
            app.api.parts.assetPartsUnlink(assetId, id)
            tr("part_unlinked_toast", "name" to name)
        }
    }

    fun unlinkTask(taskId: String) {
        val title =
            current.view
                ?.tasks
                ?.firstOrNull { it.id == taskId }
                ?.title ?: return
        write {
            app.api.parts.taskPartsUnlink(taskId, id)
            tr("part_unlinked_toast", "name" to title)
        }
    }

    fun delete() {
        if (current.busy) return
        update { it.copy(busy = true, actionError = null) }
        launch({ e -> update { it.copy(busy = false, actionError = e) } }) {
            app.api.parts.partsDelete(id)
            update { it.copy(busy = false, deleted = true) }
            app.changed("parts", "assets", "tasks")
        }
    }

    fun dismissNotice() {
        update { it.copy(notice = null) }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    private fun write(block: suspend () -> String?) {
        if (current.busy) return
        update { it.copy(busy = true, actionError = null) }
        launch({ e -> update { it.copy(busy = false, actionError = e) } }) {
            val message = block()
            update { it.copy(busy = false, notice = message?.let { m -> PartNotice(m) }) }
            app.changed("parts", "assets", "tasks")
        }
    }

    private fun load() {
        update { it.copy(loading = it.view == null, error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            app.household.get()
            val zone = app.household.timezone
            val (part, movements) =
                coroutineScope {
                    val p = async { app.api.parts.partsGet(id) }
                    val m = async { app.api.parts.partsMovements(id, limit = MOVEMENTS_PAGE) }
                    p.await() to m.await()
                }
            loaded = movements.items.map { partMovementRow(it, zone) }
            cursor = movements.nextCursor
            update {
                it.copy(loading = false, view = partView(part, zone), movements = loaded, moreMovements = cursor != null)
            }
        }
    }
}
