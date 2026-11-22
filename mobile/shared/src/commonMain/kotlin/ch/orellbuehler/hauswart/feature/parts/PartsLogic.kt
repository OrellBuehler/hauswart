package ch.orellbuehler.hauswart.feature.parts

import ch.orellbuehler.hauswart.api.generated.OrderNowItem
import ch.orellbuehler.hauswart.api.generated.Part
import ch.orellbuehler.hauswart.api.generated.PartDetail
import ch.orellbuehler.hauswart.api.generated.PartMovement
import ch.orellbuehler.hauswart.api.generated.PartsStockRequest
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Money
import ch.orellbuehler.hauswart.core.shortDate
import ch.orellbuehler.hauswart.feature.dashboard.TONE_DUE
import ch.orellbuehler.hauswart.feature.dashboard.TONE_OK
import ch.orellbuehler.hauswart.feature.dashboard.TONE_OVERDUE
import ch.orellbuehler.hauswart.i18n.tr

/** The largest stock, order or minimum the server takes. */
const val MAX_PART_STOCK = 100_000L

/** The most pieces one task uses per completion. */
const val MAX_TASK_PART_QTY = 999L

val PART_MOVEMENT_REASONS: List<String> = PartsStockRequest.REASON_VALUES

const val STOCK_EMPTY = "empty"
const val STOCK_LOW = "low"
const val STOCK_OK = "ok"

/** One choice of a list a part is linked from; the empty [value] stands for none. */
data class PartChoice(
    val value: String,
    val label: String,
    /** A second line (part number and supplier, the room of a device). */
    val detail: String = "",
)

/** A short message after an action, with a way back when [undoPartId] is set (a part that was marked as ordered). */
data class PartNotice(
    val message: String,
    val undoPartId: String? = null,
)

/** Empty at zero, low once the stock is at or below a set minimum, otherwise fine. */
fun partStockLevel(
    stockCount: Long,
    minStock: Long,
): String =
    when {
        stockCount <= 0 -> STOCK_EMPTY
        minStock > 0 && stockCount <= minStock -> STOCK_LOW
        else -> STOCK_OK
    }

fun partStockLabel(
    stockCount: Long,
    minStock: Long,
): String =
    when (partStockLevel(stockCount, minStock)) {
        STOCK_EMPTY -> tr("part_stock_empty")
        STOCK_LOW -> tr("part_stock_low", "count" to stockCount)
        else -> tr("part_stock_ok", "count" to stockCount)
    }

fun partStockTone(level: String): String =
    when (level) {
        STOCK_EMPTY -> TONE_OVERDUE
        STOCK_LOW -> TONE_DUE
        else -> TONE_OK
    }

fun partMovementReasonLabel(reason: String): String = if (reason in PART_MOVEMENT_REASONS) tr("part_reason_$reason") else reason

fun partSubtitle(
    partNumber: String?,
    supplier: String?,
): String = listOfNotNull(partNumber, supplier).filter { it.isNotBlank() }.joinToString(" · ")

fun priceText(
    unitPriceMinor: Long?,
    currency: String,
): String? = unitPriceMinor?.let { Money.format(it, currency) }

/** One part as a line of the list. */
data class PartRow(
    val id: String,
    val name: String,
    val subtitle: String,
    val stockLevel: String,
    val stockLabel: String,
    val stockTone: String,
    /** "Bestellt: 4"; null when nothing is on order. */
    val orderedLabel: String?,
    val archived: Boolean,
    val priceText: String?,
)

fun partRow(part: Part): PartRow {
    val level = partStockLevel(part.stockCount, part.minStock)
    return PartRow(
        id = part.id,
        name = part.name,
        subtitle = partSubtitle(part.partNumber, part.supplier),
        stockLevel = level,
        stockLabel = partStockLabel(part.stockCount, part.minStock),
        stockTone = partStockTone(level),
        orderedLabel = if (part.orderedAt != null) tr("part_on_order", "qty" to part.orderedQty) else null,
        archived = part.archivedAt != null,
        priceText = priceText(part.unitPriceMinor, part.currency),
    )
}

/** A part to order now for a task. */
data class OrderNowRow(
    val id: String,
    val partId: String,
    val taskId: String,
    val partName: String,
    val taskTitle: String,
    val quantity: Long,
    val quantityText: String,
    val neededByText: String,
    val late: Boolean,
    val lateHint: String,
    val stockText: String,
    val supplier: String?,
    val shopUrl: String?,
    /** Price of the whole quantity; null without a unit price. */
    val priceText: String?,
)

fun orderNowRow(
    item: OrderNowItem,
    today: String,
): OrderNowRow =
    OrderNowRow(
        id = item.id,
        partId = item.partId,
        taskId = item.taskId,
        partName = item.partName,
        taskTitle = item.taskTitle,
        quantity = item.quantity,
        quantityText = tr("order_now_qty", "qty" to item.quantity),
        neededByText = tr("order_now_needed_by", "date" to shortDate(item.neededBy, today)),
        late = item.late,
        lateHint = tr("order_now_late_hint", "date" to shortDate(item.orderBy, today)),
        stockText = tr("order_now_stock", "count" to item.stockCount),
        supplier = item.supplier?.takeIf { it.isNotBlank() },
        shopUrl = item.shopUrl?.takeIf { it.isNotBlank() },
        priceText = item.unitPriceMinor?.let { Money.format(it * item.quantity, item.currency) },
    )

data class PartAssetLink(
    val id: String,
    val name: String,
)

data class PartTaskLink(
    val id: String,
    val title: String,
    val qty: Long,
    /** "2 ×". */
    val qtyText: String,
)

/** The part as the detail screen shows it. */
data class PartView(
    val id: String,
    val name: String,
    val stockCount: Long,
    val stockLevel: String,
    val stockLabel: String,
    val stockTone: String,
    val orderedLabel: String?,
    val archived: Boolean,
    val minStock: Long,
    val reorderQty: Long,
    val leadTimeDays: Long,
    /** Taking one out is possible. */
    val canUseOne: Boolean,
    val onOrder: Boolean,
    val orderedQty: Long,
    /** "4 Stk. bestellt am 12.01.2027, 10:00"; empty when nothing is on order. */
    val onOrderText: String,
    val partNumber: String?,
    val supplier: String?,
    val priceText: String?,
    val shopUrl: String?,
    val notes: String?,
    val assets: List<PartAssetLink>,
    val tasks: List<PartTaskLink>,
    val deleteText: String,
)

fun partView(
    part: PartDetail,
    timeZone: String,
): PartView {
    val level = partStockLevel(part.stockCount, part.minStock)
    return PartView(
        id = part.id,
        name = part.name,
        stockCount = part.stockCount,
        stockLevel = level,
        stockLabel = partStockLabel(part.stockCount, part.minStock),
        stockTone = partStockTone(level),
        orderedLabel = if (part.orderedAt != null) tr("part_on_order", "qty" to part.orderedQty) else null,
        archived = part.archivedAt != null,
        minStock = part.minStock,
        reorderQty = part.reorderQty,
        leadTimeDays = part.leadTimeDays,
        canUseOne = part.stockCount >= 1,
        onOrder = part.orderedAt != null,
        orderedQty = part.orderedQty,
        onOrderText =
            part.orderedAt?.let { tr("part_on_order_since", "qty" to part.orderedQty, "date" to Dates.dateTime(it, timeZone)) }.orEmpty(),
        partNumber = part.partNumber?.takeIf { it.isNotBlank() },
        supplier = part.supplier?.takeIf { it.isNotBlank() },
        priceText = priceText(part.unitPriceMinor, part.currency),
        shopUrl = part.shopUrl?.takeIf { it.isNotBlank() },
        notes = part.notes?.takeIf { it.isNotBlank() },
        assets = part.assets.map { PartAssetLink(it.id, it.name) },
        tasks = part.tasks.map { PartTaskLink(it.id, it.title, it.qty, tr("task_part_qty_each", "qty" to it.qty)) },
        deleteText = tr("part_delete_description", "name" to part.name),
    )
}

/** One booking of the stock history. */
data class PartMovementRow(
    val id: String,
    /** "+3" or "−1". */
    val deltaText: String,
    val positive: Boolean,
    val reasonLabel: String,
    /** Who booked it and when. */
    val byText: String,
    val note: String?,
)

fun partMovementRow(
    movement: PartMovement,
    timeZone: String,
): PartMovementRow {
    val who = if (movement.completionId != null) tr("part_movement_by_task") else movement.userName ?: tr("completion_unknown_user")
    val sign = if (movement.delta > 0) "+" else "−"
    return PartMovementRow(
        id = movement.id,
        deltaText = sign + kotlin.math.abs(movement.delta),
        positive = movement.delta > 0,
        reasonLabel = partMovementReasonLabel(movement.reason),
        byText = who + " · " + Dates.dateTime(movement.at, timeZone),
        note = movement.note?.takeIf { it.isNotBlank() },
    )
}

internal fun partSearchable(part: Part): List<String?> = listOf(part.name, part.partNumber, part.supplier, part.notes)
