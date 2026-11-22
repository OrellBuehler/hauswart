package ch.orellbuehler.hauswart.feature.inventory

import ch.orellbuehler.hauswart.api.generated.Asset
import ch.orellbuehler.hauswart.api.generated.AssetsCreateRequest
import ch.orellbuehler.hauswart.api.generated.Task
import ch.orellbuehler.hauswart.api.generated.TaskState
import ch.orellbuehler.hauswart.api.generated.Warranty
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.feature.dashboard.TONE_DUE
import ch.orellbuehler.hauswart.feature.dashboard.TONE_MUTED
import ch.orellbuehler.hauswart.feature.dashboard.TONE_OK
import ch.orellbuehler.hauswart.feature.dashboard.TONE_OVERDUE
import ch.orellbuehler.hauswart.i18n.tr

/** Kinds that belong in the inventory; plants have their own screen. */
val INVENTORY_KINDS: List<String> = listOf("device", "fixture", "vehicle", "other")

val ASSET_KINDS: List<String> = AssetsCreateRequest.KIND_VALUES

const val WARRANTY_EXPIRING_DAYS = 90

val WARRANTY_STATUS_FILTERS: List<String> = listOf("valid", "expiring", "expired", "unknown")

fun assetKindLabel(kind: String): String = if (kind in ASSET_KINDS) tr("asset_kind_$kind") else kind

/** One choice of a dropdown; the empty [value] is the "no filter" or "none" choice. */
data class InventoryChoice(
    val value: String,
    val label: String,
)

/** A short message after an action, shown for a moment. [undo] offers to take the action back; [defectId] offers to open the defect. */
data class InventoryNotice(
    val message: String,
    val undo: Boolean = false,
    val defectId: String? = null,
)

data class WarrantyInfo(
    /** valid | expiring | expired | unknown */
    val status: String,
    /** The day the warranty ends: the later of the two dates. */
    val until: String?,
    val daysLeft: Int?,
    /** "Garantie bis 24.11.2027". */
    val label: String,
    /** "Noch 12 Tage", "Läuft heute ab", "Seit 3 Tagen abgelaufen"; null without a date. */
    val daysText: String?,
    val tone: String,
)

private fun warrantyTone(status: String): String =
    when (status) {
        "valid" -> TONE_OK
        "expiring" -> TONE_DUE
        "expired" -> TONE_OVERDUE
        else -> TONE_MUTED
    }

private fun buildWarranty(
    status: String,
    until: String?,
    daysLeft: Int?,
): WarrantyInfo {
    val date = until?.let { Dates.format(it) } ?: ""
    val label =
        when (status) {
            "valid" -> tr("warranty_valid", "date" to date)
            "expiring" -> tr("warranty_expiring", "date" to date)
            "expired" -> tr("warranty_expired", "date" to date)
            else -> tr("warranty_unknown")
        }
    val daysText =
        when {
            daysLeft == null -> null
            daysLeft < 0 -> tr("warranty_days_ago", "days" to -daysLeft)
            daysLeft == 0 -> tr("warranty_today")
            else -> tr("warranty_days_left", "days" to daysLeft)
        }
    return WarrantyInfo(status, until, daysLeft, label, daysText, warrantyTone(status))
}

/** The traffic light of a warranty as of [today]; the later of the two dates counts. */
fun warrantyInfo(
    warrantyUntil: String?,
    warrantyExtendedUntil: String?,
    today: String,
): WarrantyInfo {
    val until =
        if (warrantyUntil != null &&
            warrantyExtendedUntil != null
        ) {
            maxOf(warrantyUntil, warrantyExtendedUntil)
        } else {
            warrantyExtendedUntil ?: warrantyUntil
        }
    if (until == null) return buildWarranty("unknown", null, null)
    val daysLeft = Dates.diffDays(today, until)
    val status =
        when {
            daysLeft < 0 -> "expired"
            daysLeft <= WARRANTY_EXPIRING_DAYS -> "expiring"
            else -> "valid"
        }
    return buildWarranty(status, until, daysLeft)
}

fun warrantyInfoOf(
    asset: Asset,
    today: String,
): WarrantyInfo = warrantyInfo(asset.warrantyUntil, asset.warrantyExtendedUntil, today)

/** The warranty as the server worked it out (the warranty overview). */
fun warrantyInfoOf(warranty: Warranty): WarrantyInfo =
    buildWarranty(
        if (warranty.status in WARRANTY_STATUS_FILTERS) warranty.status else "unknown",
        warranty.effectiveUntil,
        warranty.daysLeft.toInt(),
    )

/** One line of an asset list. */
data class AssetRow(
    val id: String,
    val kind: String,
    val name: String,
    val subtitle: String,
    val archived: Boolean,
    val commentCount: Int,
    /** Null for plants and archived assets. */
    val warranty: WarrantyInfo?,
)

fun assetRow(
    asset: Asset,
    today: String,
    showRoom: Boolean,
): AssetRow =
    AssetRow(
        id = asset.id,
        kind = asset.kind,
        name = asset.name,
        subtitle =
            listOfNotNull(
                if (showRoom) asset.roomName else null,
                asset.vehicle?.plate,
                asset.manufacturer,
                asset.model,
                asset.species,
            ).filter { it.isNotBlank() }.joinToString(" · "),
        archived = asset.archivedAt != null,
        commentCount = asset.commentCount.toInt(),
        warranty = if (asset.archivedAt == null && asset.kind != "plant") warrantyInfoOf(asset, today) else null,
    )

/** The inventory's search and filters. An empty string means "no filter". */
data class AssetFilter(
    val query: String = "",
    val roomId: String = "",
    val kind: String = "",
    val warranty: String = "",
    val archived: Boolean = false,
) {
    val active: Boolean get() = query.isNotBlank() || roomId.isNotEmpty() || kind.isNotEmpty() || warranty.isNotEmpty() || archived
}

private fun haystack(asset: Asset): String {
    val plate = asset.vehicle?.plate
    return listOfNotNull(
        asset.name,
        asset.roomName,
        asset.category,
        asset.manufacturer,
        asset.model,
        asset.serialNumber,
        asset.species,
        plate,
        plate?.filterNot { it.isWhitespace() },
    ).filter { it.isNotBlank() }.joinToString(" ").lowercase()
}

fun filterAssets(
    assets: List<Asset>,
    filter: AssetFilter,
    today: String,
): List<Asset> {
    val terms =
        filter.query
            .lowercase()
            .split(Regex("\\s+"))
            .filter { it.isNotEmpty() }
    return assets.filter { asset ->
        when {
            !filter.archived && asset.archivedAt != null -> false
            filter.roomId.isNotEmpty() && asset.roomId != filter.roomId -> false
            filter.kind.isNotEmpty() && asset.kind != filter.kind -> false
            filter.warranty.isNotEmpty() && warrantyInfoOf(asset, today).status != filter.warranty -> false
            terms.isEmpty() -> true
            else -> {
                val text = haystack(asset)
                terms.all { text.contains(it) }
            }
        }
    }
}

/** The day a task is shown on: an estimate when that is what the server has, else the due date. */
fun shownDate(state: TaskState): String? =
    if (state.dueKind == "estimated" && state.estimate != null) state.estimate.date else state.dueDate ?: state.estimate?.date

private fun shownDateIsEstimate(state: TaskState): Boolean =
    shownDate(state) != null && (state.dueKind == "estimated" || state.dueDate == null)

/** Tasks the household has to act on: overdue, due or open. */
fun isActionable(task: Task): Boolean = task.state?.status.let { it == "overdue" || it == "due" || it == "open" }

private fun statusRank(status: String?): Int =
    when (status) {
        "overdue" -> 0
        "due" -> 1
        "open" -> 2
        "ok" -> 3
        "snoozed" -> 5
        else -> 4
    }

/** Most urgent first, then by date; tasks without a date last. */
fun sortTasks(tasks: List<Task>): List<Task> =
    tasks.sortedWith(
        compareBy<Task>({ statusRank(it.state?.status) }, { it.state?.let(::shownDate) ?: "9999-12-31" }, { it.title.lowercase() }),
    )

/** A task as one row of a list. */
data class TaskLine(
    val id: String,
    val title: String,
    val assetName: String?,
    val statusLabel: String,
    val tone: String,
    /** The due date as text; "ca. 24.11.2026" for an estimate; null without a date. */
    val dateText: String?,
)

fun taskLine(task: Task): TaskLine {
    val state = task.state
    val status = state?.status ?: "unknown"
    val shown = state?.let(::shownDate)
    return TaskLine(
        id = task.id,
        title = task.title,
        assetName = task.assetName,
        statusLabel =
            when (status) {
                "overdue" -> tr("due_overdue")
                "due" -> tr("due_due")
                "open" -> tr("due_open")
                "ok" -> tr("due_ok")
                "snoozed" -> tr("due_snoozed")
                else -> tr("due_unknown")
            },
        tone =
            when (status) {
                "overdue" -> TONE_OVERDUE
                "due", "open" -> TONE_DUE
                "ok" -> TONE_OK
                else -> TONE_MUTED
            },
        dateText =
            if (state == null || shown == null) {
                null
            } else if (shownDateIsEstimate(state)) {
                tr("due_estimated_date", "date" to Dates.format(shown))
            } else {
                Dates.format(shown)
            },
    )
}

data class RoomStats(
    val assets: Int,
    val actionable: Int,
    val overdue: Int,
)

/** A task belongs to its own room, or else to the room of its asset. */
fun taskRoomId(
    task: Task,
    assetRooms: Map<String, String?>,
): String? = task.roomId ?: task.assetId?.let { assetRooms[it] }

/** Counts per room id from one list of assets and one of tasks. */
fun roomStats(
    assets: List<Asset>,
    tasks: List<Task>,
): Map<String, RoomStats> {
    val counts = mutableMapOf<String, IntArray>()

    fun entry(roomId: String) = counts.getOrPut(roomId) { IntArray(3) }
    val assetRooms = assets.associate { it.id to it.roomId }
    assets.forEach { asset -> asset.roomId?.let { entry(it)[0]++ } }
    tasks.forEach { task ->
        val roomId = taskRoomId(task, assetRooms)
        if (roomId != null && isActionable(task)) {
            val value = entry(roomId)
            value[1]++
            if (task.state?.status == "overdue") value[2]++
        }
    }
    return counts.mapValues { RoomStats(it.value[0], it.value[1], it.value[2]) }
}

/** The room icons a room can be given, by the icon name the server stores. */
data class RoomIconOption(
    val name: String,
    val label: String,
)

private val ROOM_ICON_KEYS: List<Pair<String, String>> =
    listOf(
        "cooking-pot" to "icon_kitchen",
        "bath" to "icon_bath",
        "shower-head" to "icon_shower",
        "toilet" to "icon_toilet",
        "sofa" to "icon_living",
        "armchair" to "icon_armchair",
        "bed" to "icon_bedroom",
        "bed-double" to "icon_bed_double",
        "baby" to "icon_child",
        "tv" to "icon_tv",
        "monitor" to "icon_office",
        "book-open" to "icon_library",
        "shirt" to "icon_wardrobe",
        "washing-machine" to "icon_laundry",
        "warehouse" to "icon_cellar",
        "archive" to "icon_storage",
        "door-open" to "icon_entrance",
        "flower-2" to "icon_balcony",
        "trees" to "icon_garden",
        "car" to "icon_garage",
        "hammer" to "icon_workshop",
        "dumbbell" to "icon_fitness",
        "gamepad-2" to "icon_games",
        "house" to "icon_house",
    )

fun roomIconOptions(): List<RoomIconOption> = ROOM_ICON_KEYS.map { RoomIconOption(it.first, tr(it.second)) }

val ROOM_ICON_NAMES: List<String> = ROOM_ICON_KEYS.map { it.first }

fun stockLevel(
    stockCount: Long,
    minStock: Long,
): String =
    when {
        stockCount <= 0 -> "empty"
        minStock > 0 && stockCount <= minStock -> "low"
        else -> "ok"
    }

fun stockText(
    stockCount: Long,
    minStock: Long,
): String =
    when (stockLevel(stockCount, minStock)) {
        "empty" -> tr("part_stock_empty")
        "low" -> tr("part_stock_low", "count" to stockCount)
        else -> tr("part_stock_ok", "count" to stockCount)
    }

fun stockTone(
    stockCount: Long,
    minStock: Long,
): String =
    when (stockLevel(stockCount, minStock)) {
        "empty" -> TONE_OVERDUE
        "low" -> TONE_DUE
        else -> TONE_OK
    }
