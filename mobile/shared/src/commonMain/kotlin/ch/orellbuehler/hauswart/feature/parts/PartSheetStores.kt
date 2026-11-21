package ch.orellbuehler.hauswart.feature.parts

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.AssetPartsLinkRequest
import ch.orellbuehler.hauswart.api.generated.PartsOrderedRequest
import ch.orellbuehler.hauswart.api.generated.PartsStockRequest
import ch.orellbuehler.hauswart.api.generated.TaskPartsLinkRequest
import ch.orellbuehler.hauswart.api.generated.TaskPartsUpdateRequest
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.i18n.tr

private fun UiError.mapped(taken: Boolean): UiError = if (taken && code == "conflict") copy(message = tr("part_link_taken")) else this

// ------------------------------------------------------------ stock

/** What the stock sheet holds: [direction] (`more` or `less`) only counts for a correction. */
data class PartStockForm(
    val reason: String = "used",
    val direction: String = "more",
    val qty: String = "1",
    val note: String = "",
)

data class PartStockState(
    val loading: Boolean = true,
    val loadError: UiError? = null,
    val name: String = "",
    val description: String = "",
    val stockCount: Long = 0,
    val initial: PartStockForm? = null,
    val saving: Boolean = false,
    val error: UiError? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    val done: Boolean = false,
)

/** Books a stock movement; the sheet starts with [initialReason] and [initialQty] (the arrival of an order brings its quantity). */
class PartStockStore(
    private val app: HauswartApp,
    private val id: String,
    private val initialReason: String,
    private val initialQty: Long,
) : Store<PartStockState>(PartStockState()) {
    init {
        load()
    }

    fun retry() {
        load()
    }

    /** The change a form makes: negative for used, and for a correction towards less. */
    fun delta(form: PartStockForm): Long {
        val amount = parseCount(form.qty) ?: 0
        return if (form.reason == "used" || (form.reason == "correction" && form.direction == "less")) -amount else amount
    }

    /** "Neuer Bestand: 7". */
    fun resultText(form: PartStockForm): String = tr("part_stock_result", "count" to (current.stockCount + delta(form)))

    /** The form with the quantity moved by [by], kept between 1 and the largest stock. */
    fun step(
        form: PartStockForm,
        by: Int,
    ): PartStockForm {
        val next = ((parseCount(form.qty) ?: 0) + by).coerceIn(1, MAX_PART_STOCK)
        return form.copy(qty = next.toString())
    }

    fun save(form: PartStockForm) {
        if (current.saving) return
        val qty = parseCount(form.qty)
        val error =
            when {
                qty == null || qty < 1 -> tr("field_min", "min" to 1)
                qty > MAX_PART_STOCK -> tr("field_number")
                current.stockCount + delta(form) < 0 -> tr("part_stock_below_zero")
                else -> null
            }
        if (error != null) {
            update { it.copy(fieldErrors = mapOf("delta" to error), error = null) }
            return
        }
        update { it.copy(saving = true, error = null, fieldErrors = emptyMap()) }
        launch({ e -> update { it.copy(saving = false, error = if (e.fields.isEmpty()) e else null, fieldErrors = e.fields) } }) {
            app.api.parts.partsStock(
                id,
                PartsStockRequest(delta = delta(form), reason = form.reason, note = form.note.trim().ifEmpty { null }),
            )
            app.changed("parts")
            update { it.copy(saving = false, done = true) }
        }
    }

    private fun load() {
        update { it.copy(loading = true, loadError = null) }
        launch({ e -> update { it.copy(loading = false, loadError = e) } }) {
            val part = app.api.parts.partsGet(id)
            update {
                it.copy(
                    loading = false,
                    name = part.name,
                    description = tr("part_stock_dialog_description", "name" to part.name, "count" to part.stockCount),
                    stockCount = part.stockCount,
                    initial = PartStockForm(reason = initialReason, qty = initialQty.toString()),
                )
            }
        }
    }
}

// ------------------------------------------------------------ ordered

data class PartOrderedState(
    val loading: Boolean = true,
    val loadError: UiError? = null,
    val description: String = "",
    /** The quantity the field starts with: what is on order, else the reorder quantity. */
    val initialQty: String = "",
    val saving: Boolean = false,
    val error: UiError? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    val done: Boolean = false,
)

/** Marks a part as ordered. */
class PartOrderedStore(
    private val app: HauswartApp,
    private val id: String,
) : Store<PartOrderedState>(PartOrderedState()) {
    init {
        load()
    }

    fun retry() {
        load()
    }

    fun save(qtyText: String) {
        if (current.saving) return
        val qty = parseCount(qtyText)
        if (qty == null || qty < 1 || qty > MAX_PART_STOCK) {
            update { it.copy(fieldErrors = mapOf("qty" to tr("field_min", "min" to 1)), error = null) }
            return
        }
        update { it.copy(saving = true, error = null, fieldErrors = emptyMap()) }
        launch({ e -> update { it.copy(saving = false, error = if (e.fields.isEmpty()) e else null, fieldErrors = e.fields) } }) {
            app.api.parts.partsOrdered(id, PartsOrderedRequest(qty = qty))
            app.changed("parts")
            update { it.copy(saving = false, done = true) }
        }
    }

    private fun load() {
        update { it.copy(loading = true, loadError = null) }
        launch({ e -> update { it.copy(loading = false, loadError = e) } }) {
            val part = app.api.parts.partsGet(id)
            update {
                it.copy(
                    loading = false,
                    description = tr("part_ordered_dialog_description", "name" to part.name),
                    initialQty = (if (part.orderedQty > 0) part.orderedQty else part.reorderQty).toString(),
                )
            }
        }
    }
}

// ------------------------------------------------------------ links

data class PartLinkState(
    val loading: Boolean = true,
    val loadError: UiError? = null,
    /** What can still be linked. */
    val options: List<PartChoice> = emptyList(),
    val saving: Boolean = false,
    val error: UiError? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    val done: Boolean = false,
)

/** Links a part to a device. */
class PartAssetLinkStore(
    private val app: HauswartApp,
    private val partId: String,
) : Store<PartLinkState>(PartLinkState()) {
    init {
        load()
    }

    fun retry() {
        load()
    }

    fun link(assetId: String) {
        if (current.saving) return
        if (assetId.isEmpty()) {
            update { it.copy(fieldErrors = mapOf("choice" to tr("part_link_choose_asset")), error = null) }
            return
        }
        update { it.copy(saving = true, error = null, fieldErrors = emptyMap()) }
        launch({ e -> update { it.copy(saving = false, error = e.mapped(true)) } }) {
            app.api.parts.assetPartsLink(assetId, AssetPartsLinkRequest(partId = partId))
            app.changed("parts", "assets")
            update { it.copy(saving = false, done = true) }
        }
    }

    private fun load() {
        update { it.copy(loading = true, loadError = null) }
        launch({ e -> update { it.copy(loading = false, loadError = e) } }) {
            val part = app.api.parts.partsGet(partId)
            val linked = part.assets.map { it.id }.toSet()
            val assets =
                fetchAll { cursor ->
                    val page = app.api.assets.assetsList(cursor = cursor, limit = 200)
                    page.items to page.nextCursor
                }
            update {
                it.copy(
                    loading = false,
                    options = assets.filter { a -> a.id !in linked }.map { a -> PartChoice(a.id, a.name, a.roomName.orEmpty()) },
                )
            }
        }
    }
}

data class PartTaskLinkState(
    val loading: Boolean = true,
    val loadError: UiError? = null,
    val options: List<PartChoice> = emptyList(),
    val initialQty: String = "1",
    val saving: Boolean = false,
    val error: UiError? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    val done: Boolean = false,
)

/** Links a part to a task with the pieces each completion uses. */
class PartTaskLinkStore(
    private val app: HauswartApp,
    private val partId: String,
) : Store<PartTaskLinkState>(PartTaskLinkState()) {
    init {
        load()
    }

    fun retry() {
        load()
    }

    fun link(
        taskId: String,
        qtyText: String,
    ) {
        if (current.saving) return
        val qty = parseCount(qtyText)
        val errors = mutableMapOf<String, String>()
        if (taskId.isEmpty()) errors["choice"] = tr("part_link_choose_task")
        if (qty == null || qty < 1 || qty > MAX_TASK_PART_QTY) errors["qty"] = tr("field_min", "min" to 1)
        if (errors.isNotEmpty() || qty == null) {
            update { it.copy(fieldErrors = errors, error = null) }
            return
        }
        update { it.copy(saving = true, error = null, fieldErrors = emptyMap()) }
        launch({ e -> update { it.copy(saving = false, error = e.mapped(true)) } }) {
            app.api.parts.taskPartsLink(taskId, TaskPartsLinkRequest(partId = partId, qty = qty))
            app.changed("parts", "tasks")
            update { it.copy(saving = false, done = true) }
        }
    }

    private fun load() {
        update { it.copy(loading = true, loadError = null) }
        launch({ e -> update { it.copy(loading = false, loadError = e) } }) {
            val part = app.api.parts.partsGet(partId)
            val linked = part.tasks.map { it.id }.toSet()
            val tasks =
                fetchAll { cursor ->
                    val page = app.api.tasks.tasksList(cursor = cursor, limit = 200)
                    page.items to page.nextCursor
                }
            update {
                it.copy(
                    loading = false,
                    options =
                        tasks.filter { t -> t.id !in linked }.map { t -> PartChoice(t.id, t.title, t.assetName ?: t.roomName.orEmpty()) },
                )
            }
        }
    }
}

data class PartTaskQtyState(
    val description: String,
    val saving: Boolean = false,
    val error: UiError? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    val done: Boolean = false,
)

/** Changes how many pieces a task uses of the part. */
class PartTaskQtyStore(
    private val app: HauswartApp,
    private val partId: String,
    private val taskId: String,
    title: String,
) : Store<PartTaskQtyState>(PartTaskQtyState(description = tr("task_part_edit_description", "name" to title))) {
    fun save(qtyText: String) {
        if (current.saving) return
        val qty = parseCount(qtyText)
        if (qty == null || qty < 1 || qty > MAX_TASK_PART_QTY) {
            update { it.copy(fieldErrors = mapOf("qty" to tr("field_min", "min" to 1)), error = null) }
            return
        }
        update { it.copy(saving = true, error = null, fieldErrors = emptyMap()) }
        launch({ e -> update { it.copy(saving = false, error = if (e.fields.isEmpty()) e else null, fieldErrors = e.fields) } }) {
            app.api.parts.taskPartsUpdate(taskId, partId, TaskPartsUpdateRequest(qty = qty))
            app.changed("parts", "tasks")
            update { it.copy(saving = false, done = true) }
        }
    }
}
