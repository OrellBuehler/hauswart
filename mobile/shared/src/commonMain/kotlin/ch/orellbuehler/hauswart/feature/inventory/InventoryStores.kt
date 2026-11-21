package ch.orellbuehler.hauswart.feature.inventory

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.Asset
import ch.orellbuehler.hauswart.api.generated.Hint
import ch.orellbuehler.hauswart.api.generated.Room
import ch.orellbuehler.hauswart.api.generated.RoomsUpdateRequest
import ch.orellbuehler.hauswart.api.generated.Task
import ch.orellbuehler.hauswart.api.generated.TasksCompleteRequest
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

internal suspend fun fetchAssets(
    app: HauswartApp,
    roomId: String? = null,
    kind: String? = null,
    includeArchived: Boolean? = null,
): List<Asset> =
    fetchAll { cursor ->
        val page = app.api.assets.assetsList(cursor = cursor, limit = 200, kind = kind, roomId = roomId, includeArchived = includeArchived)
        page.items to page.nextCursor
    }

internal suspend fun fetchRooms(app: HauswartApp): List<Room> =
    fetchAll { cursor ->
        val page = app.api.rooms.roomsList(cursor = cursor, limit = 200)
        page.items to page.nextCursor
    }.sortedWith(compareBy({ it.sortOrder }, { it.name.lowercase() }))

internal suspend fun fetchTasks(
    app: HauswartApp,
    assetId: String? = null,
    category: String? = null,
): List<Task> =
    fetchAll { cursor ->
        val page = app.api.tasks.tasksList(cursor = cursor, limit = 200, assetId = assetId, category = category)
        page.items to page.nextCursor
    }

data class InventoryState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val filter: AssetFilter = AssetFilter(),
    val roomOptions: List<InventoryChoice> = emptyList(),
    val kindOptions: List<InventoryChoice> = emptyList(),
    val warrantyOptions: List<InventoryChoice> = emptyList(),
    val rows: List<AssetRow> = emptyList(),
    /** Every asset that is not a plant, archived ones included: zero means the inventory is empty. */
    val assetCount: Int = 0,
    /** Assets that are not archived. */
    val total: Int = 0,
    val hasArchived: Boolean = false,
    /** "12 Einträge" or "3 von 12 Einträgen". */
    val countText: String = "",
) {
    val filtered: Boolean get() = filter.active
}

/** The inventory: every asset but the plants, with search and filters. */
class InventoryStore(
    private val app: HauswartApp,
) : Store<InventoryState>(
        InventoryState(
            kindOptions =
                listOf(InventoryChoice("", tr("inventory_filter_all_kinds"))) +
                    INVENTORY_KINDS.map { InventoryChoice(it, assetKindLabel(it)) },
            warrantyOptions =
                listOf(InventoryChoice("", tr("inventory_filter_all_warranties"))) +
                    WARRANTY_STATUS_FILTERS.map { InventoryChoice(it, tr("warranty_filter_$it")) },
        ),
    ) {
    private var all: List<Asset> = emptyList()
    private var today = ""

    init {
        onChange(app, "assets", "rooms") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun search(query: String) = setFilter { it.copy(query = query) }

    fun setRoom(roomId: String) = setFilter { it.copy(roomId = roomId) }

    fun setKind(kind: String) = setFilter { it.copy(kind = kind) }

    fun setWarranty(status: String) = setFilter { it.copy(warranty = status) }

    fun setShowArchived(value: Boolean) = setFilter { it.copy(archived = value) }

    fun resetFilter() = setFilter { AssetFilter() }

    private fun setFilter(change: (AssetFilter) -> AssetFilter) {
        update { it.copy(filter = change(it.filter)) }
        show()
    }

    private fun load() {
        update { it.copy(loading = all.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            app.household.get()
            today = app.household.today()
            val (assets, rooms) =
                coroutineScope {
                    val a = async { fetchAssets(app, includeArchived = true) }
                    val r = async { fetchRooms(app) }
                    a.await() to r.await()
                }
            all = assets.filter { it.kind != "plant" }
            update {
                it.copy(
                    roomOptions =
                        listOf(InventoryChoice("", tr("inventory_filter_all_rooms"))) + rooms.map { r -> InventoryChoice(r.id, r.name) },
                )
            }
            show()
            update { it.copy(loading = false) }
        }
    }

    private fun show() {
        val filter = current.filter
        val visible = filterAssets(all, filter, today).sortedBy { it.name.lowercase() }
        val total = all.count { it.archivedAt == null }
        update {
            it.copy(
                rows = visible.map { a -> assetRow(a, today, showRoom = true) },
                assetCount = all.size,
                total = total,
                hasArchived = all.any { a -> a.archivedAt != null },
                countText =
                    if (filter.active) {
                        tr("inventory_result_count", "shown" to visible.size, "total" to total)
                    } else {
                        tr("inventory_count", "count" to total)
                    },
            )
        }
    }
}

data class PlantHint(
    val id: String,
    val kind: String,
    val title: String,
)

data class PlantItem(
    val id: String,
    val name: String,
    val species: String?,
    /** "Küche · hell" or "Kein Raum". */
    val place: String,
    /** The first two hints. */
    val hints: List<PlantHint>,
    /** "+ 3 weitere"; null when there are at most two. */
    val moreHints: String?,
    /** The task that waters the plant; null when there is no plan. */
    val taskId: String?,
    val statusLabel: String?,
    val tone: String?,
    val dateText: String?,
)

data class PlantsState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val plants: List<PlantItem> = emptyList(),
    /** The plant that is being watered right now. */
    val wateringId: String? = null,
    val actionError: UiError? = null,
    /** "«Ficus» gegossen." with an undo; the screen shows it for a moment and calls [PlantsStore.dismissNotice]. */
    val notice: InventoryNotice? = null,
)

/** The plant view of the assets: care hints and a "water" button that completes the watering task. */
class PlantsStore(
    private val app: HauswartApp,
) : Store<PlantsState>(PlantsState()) {
    private var lastCompletionId: String? = null
    private var loaded = false

    init {
        onChange(app, "assets", "tasks") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun water(plantId: String) {
        val item = current.plants.firstOrNull { it.id == plantId } ?: return
        val taskId = item.taskId ?: return
        if (current.wateringId != null) return
        update { it.copy(wateringId = plantId, actionError = null) }
        launch({ e -> update { it.copy(wateringId = null, actionError = e) } }) {
            val done = app.api.tasks.tasksComplete(taskId, TasksCompleteRequest(source = "manual"))
            lastCompletionId = done.completion.id
            update { it.copy(wateringId = null, notice = InventoryNotice(tr("plants_watered_toast", "name" to item.name), undo = true)) }
            app.changed("tasks")
        }
    }

    fun undo() {
        val id = lastCompletionId ?: return
        lastCompletionId = null
        update { it.copy(notice = null) }
        launch({ e -> update { it.copy(actionError = e) } }) {
            app.api.tasks.completionsUndo(id)
            update { it.copy(notice = InventoryNotice(tr("toast_undone"))) }
            app.changed("tasks")
        }
    }

    fun dismissNotice() {
        update { it.copy(notice = null) }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    private fun load() {
        update { it.copy(loading = !loaded, error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            val (plants, tasks, hints) =
                coroutineScope {
                    val p = async { fetchAssets(app, kind = "plant") }
                    val t = async { fetchTasks(app, category = "plant") }
                    val h =
                        async {
                            fetchAll { cursor ->
                                val page = app.api.hints.hintsList(cursor = cursor, limit = 200)
                                page.items to page.nextCursor
                            }
                        }
                    Triple(p.await(), t.await(), h.await())
                }
            loaded = true
            update { it.copy(loading = false, plants = plantItems(plants, tasks, hints)) }
        }
    }
}

internal fun plantItems(
    plants: List<Asset>,
    tasks: List<Task>,
    hints: List<Hint>,
): List<PlantItem> {
    val waterTasks = mutableMapOf<String, Task>()
    sortTasks(tasks).forEach { task -> task.assetId?.let { waterTasks.getOrPut(it) { task } } }
    val hintsByAsset = hints.groupBy { it.assetId }

    fun rank(id: String): Int =
        when (waterTasks[id]?.state?.status) {
            "overdue" -> 0
            "due", "open" -> 1
            else -> 2
        }
    return plants.sortedWith(compareBy({ rank(it.id) }, { it.name.lowercase() })).map { plant ->
        val task = waterTasks[plant.id]
        val line = task?.let { taskLine(it) }
        val plantHints = hintsByAsset[plant.id].orEmpty()
        PlantItem(
            id = plant.id,
            name = plant.name,
            species = plant.species?.takeIf { it.isNotBlank() },
            place =
                listOfNotNull(
                    plant.roomName,
                    plant.light,
                ).filter { it.isNotBlank() }.joinToString(" · ").ifEmpty { tr("plants_no_room") },
            hints = plantHints.take(2).map { PlantHint(it.id, it.kind, it.title) },
            moreHints = if (plantHints.size > 2) tr("plants_hints_more", "count" to plantHints.size - 2) else null,
            taskId = task?.id,
            statusLabel = line?.statusLabel,
            tone = line?.tone,
            dateText = line?.dateText,
        )
    }
}

data class RoomItem(
    val id: String,
    val name: String,
    /** The stored icon name (see [ROOM_ICON_NAMES]); null for none. */
    val icon: String?,
    val assetsText: String,
    /** "2 offene Aufgaben"; null when there are none. */
    val tasksText: String?,
    val hasOverdue: Boolean,
    val canMoveUp: Boolean,
    val canMoveDown: Boolean,
)

data class RoomsState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val rooms: List<RoomItem> = emptyList(),
    val busy: Boolean = false,
    val actionError: UiError? = null,
    val notice: InventoryNotice? = null,
)

/** The room list with counts, moving up and down, and deleting. Creating and editing is [RoomEditStore]. */
class RoomsStore(
    private val app: HauswartApp,
) : Store<RoomsState>(RoomsState()) {
    private var rooms: List<Room> = emptyList()
    private var loaded = false

    init {
        onChange(app, "rooms", "assets", "tasks") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun move(
        roomId: String,
        delta: Int,
    ) {
        if (current.busy) return
        val index = rooms.indexOfFirst { it.id == roomId }
        val target = index + delta
        if (index < 0 || target < 0 || target >= rooms.size) return
        val order = rooms.toMutableList().also { it.add(target, it.removeAt(index)) }
        update { it.copy(busy = true, actionError = null) }
        launch({ e ->
            update { it.copy(busy = false, actionError = e) }
            app.changed("rooms")
        }) {
            order.forEachIndexed { position, room ->
                if (room.sortOrder != position.toLong()) {
                    app.api.rooms.roomsUpdate(room.id, RoomsUpdateRequest(sortOrder = position.toLong()))
                }
            }
            update { it.copy(busy = false) }
            app.changed("rooms")
        }
    }

    fun delete(roomId: String) {
        if (current.busy) return
        val name = rooms.firstOrNull { it.id == roomId }?.name ?: return
        update { it.copy(busy = true, actionError = null) }
        launch({ e -> update { it.copy(busy = false, actionError = e) } }) {
            app.api.rooms.roomsDelete(roomId)
            update { it.copy(busy = false, notice = InventoryNotice(tr("rooms_deleted_toast", "name" to name))) }
            app.changed("rooms")
        }
    }

    fun dismissNotice() {
        update { it.copy(notice = null) }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    private fun load() {
        update { it.copy(loading = !loaded, error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            val (loadedRooms, assets, tasks) =
                coroutineScope {
                    val r = async { fetchRooms(app) }
                    val a = async { fetchAssets(app) }
                    val t = async { fetchTasks(app) }
                    Triple(r.await(), a.await(), t.await())
                }
            rooms = loadedRooms
            loaded = true
            val stats = roomStats(assets, tasks)
            update {
                it.copy(
                    loading = false,
                    rooms =
                        loadedRooms.mapIndexed { index, room ->
                            val s = stats[room.id]
                            RoomItem(
                                id = room.id,
                                name = room.name,
                                icon = room.icon,
                                assetsText = tr("rooms_count_assets", "count" to (s?.assets ?: 0)),
                                tasksText = s?.actionable?.takeIf { n -> n > 0 }?.let { n -> tr("rooms_count_tasks", "count" to n) },
                                hasOverdue = (s?.overdue ?: 0) > 0,
                                canMoveUp = index > 0,
                                canMoveDown = index < loadedRooms.size - 1,
                            )
                        },
                )
            }
        }
    }
}

data class RoomDetailState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val room: Room? = null,
    val assets: List<AssetRow> = emptyList(),
    val tasks: List<TaskLine> = emptyList(),
    val deleting: Boolean = false,
    val actionError: UiError? = null,
    val deleted: Boolean = false,
)

class RoomDetailStore(
    private val app: HauswartApp,
    private val id: String,
) : Store<RoomDetailState>(RoomDetailState()) {
    init {
        onChange(app, "rooms", "assets", "tasks") { if (!current.deleted) load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun delete() {
        if (current.room == null || current.deleting) return
        update { it.copy(deleting = true, actionError = null) }
        launch({ e -> update { it.copy(deleting = false, actionError = e) } }) {
            app.api.rooms.roomsDelete(id)
            update { it.copy(deleting = false, deleted = true) }
            app.changed("rooms")
        }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    private fun load() {
        update { it.copy(loading = it.room == null, error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            app.household.get()
            val today = app.household.today()
            val data =
                coroutineScope {
                    val room = async { app.api.rooms.roomsGet(id) }
                    val inRoom = async { fetchAssets(app, roomId = id) }
                    val allAssets = async { fetchAssets(app) }
                    val tasks = async { fetchTasks(app) }
                    RoomData(room.await(), inRoom.await(), allAssets.await(), tasks.await())
                }
            val room = data.room
            val inRoom = data.inRoom
            val allAssets = data.allAssets
            val tasks = data.tasks
            val assetRooms = allAssets.associate { it.id to it.roomId }
            update {
                it.copy(
                    loading = false,
                    room = room,
                    assets =
                        inRoom
                            .filter { a ->
                                a.archivedAt == null
                            }.sortedBy { a -> a.name.lowercase() }
                            .map { a -> assetRow(a, today, showRoom = false) },
                    tasks = sortTasks(tasks.filter { t -> taskRoomId(t, assetRooms) == room.id }).map(::taskLine),
                )
            }
        }
    }
}

private class RoomData(
    val room: Room,
    val inRoom: List<Asset>,
    val allAssets: List<Asset>,
    val tasks: List<Task>,
)
