package ch.orellbuehler.hauswart.feature.inventory

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.Patch
import ch.orellbuehler.hauswart.api.generated.Asset
import ch.orellbuehler.hauswart.api.generated.AssetsCreateRequest
import ch.orellbuehler.hauswart.api.generated.AssetsUpdateRequest
import ch.orellbuehler.hauswart.api.generated.Room
import ch.orellbuehler.hauswart.api.generated.RoomsCreateRequest
import ch.orellbuehler.hauswart.api.generated.RoomsUpdateRequest
import ch.orellbuehler.hauswart.api.generated.TasksCreateRequest
import ch.orellbuehler.hauswart.api.generated.Trigger
import ch.orellbuehler.hauswart.api.generated.TriggerIntervalSeasonsItem
import ch.orellbuehler.hauswart.api.generated.Warranty
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

data class WarrantyRow(
    val assetId: String,
    val name: String,
    /** Room, manufacturer and model. */
    val subtitle: String,
    val info: WarrantyInfo,
    /** "Garantie bis 24.11.2026, verlängert bis 24.11.2027"; null when the warranty was not extended. */
    val extendedText: String?,
)

data class WarrantyChip(
    /** "" for all, else valid | expiring | expired. */
    val value: String,
    val label: String,
    val count: Int,
)

data class WarrantiesState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val status: String = "",
    val chips: List<WarrantyChip> = emptyList(),
    val rows: List<WarrantyRow> = emptyList(),
    val total: Int = 0,
)

/** Warranties that need attention first (soonest end first), then valid ones, then expired ones (latest first). */
fun sortWarranties(warranties: List<Warranty>): List<Warranty> =
    warranties.sortedWith(
        Comparator { a, b ->
            val byStatus = warrantyOrder(a.status) - warrantyOrder(b.status)
            when {
                byStatus != 0 -> byStatus
                a.status == "expired" && a.effectiveUntil != b.effectiveUntil -> b.effectiveUntil.compareTo(a.effectiveUntil)
                a.status != "expired" && a.effectiveUntil != b.effectiveUntil -> a.effectiveUntil.compareTo(b.effectiveUntil)
                else -> a.assetName.lowercase().compareTo(b.assetName.lowercase())
            }
        },
    )

private fun warrantyOrder(status: String): Int =
    when (status) {
        "expiring" -> 0
        "valid" -> 1
        else -> 2
    }

class WarrantiesStore(
    private val app: HauswartApp,
) : Store<WarrantiesState>(WarrantiesState()) {
    private var all: List<Warranty> = emptyList()

    init {
        onChange(app, "assets") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun select(status: String) {
        update { it.copy(status = status) }
        show()
    }

    private fun load() {
        update { it.copy(loading = all.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            all =
                sortWarranties(
                    fetchAll { cursor ->
                        val page = app.api.warranties.warrantiesList(cursor = cursor, limit = 200)
                        page.items to page.nextCursor
                    },
                )
            show()
            update { it.copy(loading = false) }
        }
    }

    private fun show() {
        val status = current.status
        val shown = if (status.isEmpty()) all else all.filter { it.status == status }
        val statuses = listOf("valid", "expiring", "expired")
        update {
            it.copy(
                total = all.size,
                chips =
                    listOf(WarrantyChip("", tr("warranties_filter_all"), all.size)) +
                        statuses.map { s -> WarrantyChip(s, tr("warranty_filter_$s"), all.count { w -> w.status == s }) },
                rows =
                    shown.map { w ->
                        val extended = w.warrantyUntil != null && w.warrantyExtendedUntil != null && w.warrantyExtendedUntil > w.warrantyUntil
                        WarrantyRow(
                            assetId = w.assetId,
                            name = w.assetName,
                            subtitle = listOfNotNull(w.roomName, w.manufacturer, w.model).filter { s -> s.isNotBlank() }.joinToString(" · "),
                            info = warrantyInfoOf(w),
                            extendedText =
                                if (extended) {
                                    tr(
                                        "asset_warranty_detail",
                                        "until" to Dates.format(w.warrantyUntil ?: w.effectiveUntil),
                                        "extended" to Dates.format(w.effectiveUntil),
                                    )
                                } else {
                                    null
                                },
                        )
                    },
            )
        }
    }
}

/** What the room form holds. [icon] is a name of [ROOM_ICON_NAMES]; empty for none. */
data class RoomForm(
    val name: String = "",
    val icon: String = "",
    val notes: String = "",
)

data class RoomEditState(
    val isNew: Boolean,
    val loading: Boolean,
    val loadError: UiError? = null,
    val initial: RoomForm? = null,
    val iconOptions: List<RoomIconOption> = roomIconOptions(),
    val saving: Boolean = false,
    val error: UiError? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    val savedId: String? = null,
)

/** Creates a room ([id] null; it goes to the end of the list) or edits one. */
class RoomEditStore(
    private val app: HauswartApp,
    private val id: String?,
) : Store<RoomEditState>(RoomEditState(isNew = id == null, loading = id != null, initial = if (id == null) RoomForm() else null)) {
    init {
        if (id != null) load(id)
    }

    fun retry() {
        if (id != null) load(id)
    }

    fun save(form: RoomForm) {
        if (current.saving) return
        if (form.name.isBlank()) {
            update { it.copy(fieldErrors = mapOf("name" to tr("m_field_required")), error = null) }
            return
        }
        update { it.copy(saving = true, error = null, fieldErrors = emptyMap()) }
        launch({ e ->
            val taken = if (e.code == "conflict") e.copy(message = tr("rooms_error_name_taken")) else e
            update { it.copy(saving = false, error = if (e.fields.isEmpty()) taken else null, fieldErrors = e.fields) }
        }) {
            val icon = form.icon.ifEmpty { null }
            val notes = form.notes.trim().ifEmpty { null }
            val saved =
                if (id == null) {
                    val next = (fetchRooms(app).maxOfOrNull { it.sortOrder } ?: -1) + 1
                    app.api.rooms.roomsCreate(RoomsCreateRequest(name = form.name.trim(), icon = icon, notes = notes, sortOrder = next))
                } else {
                    app.api.rooms.roomsUpdate(id, RoomsUpdateRequest(name = form.name.trim(), icon = Patch.of(icon), notes = Patch.of(notes)))
                }
            update { it.copy(saving = false, savedId = saved.id) }
            app.changed("rooms")
        }
    }

    private fun load(roomId: String) {
        update { it.copy(loading = true, loadError = null) }
        launch({ e -> update { it.copy(loading = false, loadError = e) } }) {
            val room: Room = app.api.rooms.roomsGet(roomId)
            update { it.copy(loading = false, initial = RoomForm(room.name, room.icon ?: "", room.notes ?: "")) }
        }
    }
}

data class AssetFact(
    val label: String,
    val value: String,
)

/** An asset as the detail screen shows it. */
data class AssetView(
    val id: String,
    val name: String,
    val kind: String,
    val kindLabel: String,
    val isPlant: Boolean,
    val isVehicle: Boolean,
    val plate: String?,
    val roomId: String?,
    val roomName: String?,
    val archived: Boolean,
    /** Null for plants. */
    val warranty: WarrantyInfo?,
    val warrantyFromDocument: Boolean,
    /** "Garantie bis …, verlängert bis …" when both dates are set. */
    val warrantyDetail: String?,
    val facts: List<AssetFact>,
    val showOnEmergency: Boolean,
    val notes: String?,
)

fun assetView(
    asset: Asset,
    today: String,
): AssetView {
    fun fact(
        label: String,
        value: String?,
    ) = value?.takeIf { it.isNotBlank() }?.let { AssetFact(label, it) }
    return AssetView(
        id = asset.id,
        name = asset.name,
        kind = asset.kind,
        kindLabel = assetKindLabel(asset.kind),
        isPlant = asset.kind == "plant",
        isVehicle = asset.kind == "vehicle",
        plate = asset.vehicle?.plate?.takeIf { it.isNotBlank() },
        roomId = asset.roomId,
        roomName = asset.roomName,
        archived = asset.archivedAt != null,
        warranty = if (asset.kind == "plant") null else warrantyInfoOf(asset, today),
        warrantyFromDocument = asset.warrantySource == "document" && (asset.warrantyUntil != null || asset.warrantyExtendedUntil != null),
        warrantyDetail =
            if (asset.warrantyUntil != null && asset.warrantyExtendedUntil != null) {
                tr(
                    "asset_warranty_detail",
                    "until" to Dates.format(asset.warrantyUntil),
                    "extended" to Dates.format(asset.warrantyExtendedUntil),
                )
            } else {
                null
            },
        facts =
            listOfNotNull(
                fact(tr("asset_category"), asset.category),
                fact(tr("asset_manufacturer"), asset.manufacturer),
                fact(tr("asset_model"), asset.model),
                fact(tr("asset_serial"), asset.serialNumber),
                fact(tr("asset_species"), asset.species),
                fact(tr("asset_light"), asset.light),
                fact(tr("asset_water_notes"), asset.waterNotes),
                fact(tr("asset_purchase_date"), asset.purchaseDate?.let { Dates.format(it) }),
                fact(tr("asset_installed_date"), asset.installedDate?.let { Dates.format(it) }),
            ),
        showOnEmergency = asset.showOnEmergency,
        notes = asset.notes?.takeIf { it.isNotBlank() },
    )
}

data class AssetDetailState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val asset: AssetView? = null,
    val tasks: List<TaskLine> = emptyList(),
    val busy: Boolean = false,
    val actionError: UiError? = null,
    val notice: InventoryNotice? = null,
    /** True once the asset is gone: the screen closes. */
    val deleted: Boolean = false,
)

class AssetDetailStore(
    private val app: HauswartApp,
    private val id: String,
) : Store<AssetDetailState>(AssetDetailState()) {
    init {
        onChange(app, "assets", "tasks") { if (!current.deleted) load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun toggleArchive() {
        val asset = current.asset ?: return
        if (current.busy) return
        val archive = !asset.archived
        update { it.copy(busy = true, actionError = null) }
        launch({ e -> update { it.copy(busy = false, actionError = e) } }) {
            app.api.assets.assetsUpdate(id, AssetsUpdateRequest(archived = archive))
            update {
                it.copy(
                    busy = false,
                    notice = InventoryNotice(tr(if (archive) "asset_archived_toast" else "asset_restored_toast", "name" to asset.name)),
                )
            }
            app.changed("assets")
        }
    }

    fun delete() {
        val asset = current.asset ?: return
        if (current.busy) return
        update { it.copy(busy = true, actionError = null) }
        launch({ e -> update { it.copy(busy = false, actionError = e) } }) {
            app.api.assets.assetsDelete(id)
            update { it.copy(busy = false, deleted = true, notice = InventoryNotice(tr("asset_deleted_toast", "name" to asset.name))) }
            app.changed("assets")
        }
    }

    fun dismissNotice() {
        update { it.copy(notice = null) }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    private fun load() {
        update { it.copy(loading = it.asset == null, error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            app.household.get()
            val today = app.household.today()
            val (asset, tasks) =
                coroutineScope {
                    val a = async { app.api.assets.assetsGet(id) }
                    val t = async { fetchTasks(app, assetId = id) }
                    a.await() to t.await()
                }
            update { it.copy(loading = false, asset = assetView(asset, today), tasks = sortTasks(tasks).map(::taskLine)) }
        }
    }
}

/** Every field of the asset form as typed; dates are `YYYY-MM-DD` or empty, [roomId] is empty for none. */
data class AssetForm(
    val kind: String = "device",
    val name: String = "",
    val roomId: String = "",
    val category: String = "",
    val manufacturer: String = "",
    val model: String = "",
    val serialNumber: String = "",
    val purchaseDate: String = "",
    val installedDate: String = "",
    val warrantyUntil: String = "",
    val warrantyExtendedUntil: String = "",
    val showOnEmergency: Boolean = false,
    val notes: String = "",
    val species: String = "",
    val light: String = "",
    val waterNotes: String = "",
    /** A new plant: also create the watering task. */
    val makePlan: Boolean = true,
    val everyDays: String = "7",
    val seasonal: Boolean = false,
    val summerEveryDays: String = "3",
)

data class AssetEditState(
    val isNew: Boolean,
    val loading: Boolean,
    val loadError: UiError? = null,
    val initial: AssetForm? = null,
    val kindOptions: List<InventoryChoice> = ASSET_KINDS.map { InventoryChoice(it, assetKindLabel(it)) },
    /** The first choice (empty value) is "no room". */
    val roomOptions: List<InventoryChoice> = emptyList(),
    val saving: Boolean = false,
    val error: UiError? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    val savedId: String? = null,
)

private const val MAX_INTERVAL_DAYS = 3650L

/** Creates an asset ([id] null, with [kind] and [roomId] as the start) or edits one. */
class AssetEditStore(
    private val app: HauswartApp,
    private val id: String?,
    private val kind: String = "device",
    private val roomId: String? = null,
) : Store<AssetEditState>(
        AssetEditState(
            isNew = id == null,
            loading = true,
        ),
    ) {
    private var created: Asset? = null

    init {
        load()
    }

    fun retry() {
        load()
    }

    fun save(form: AssetForm) {
        if (current.saving) return
        val errors = mutableMapOf<String, String>()
        if (form.name.isBlank()) errors["name"] = tr("m_field_required")
        val planned = id == null && created == null && form.kind == "plant" && form.makePlan
        val every = form.everyDays.trim().toLongOrNull()
        val summer = form.summerEveryDays.trim().toLongOrNull()
        if (planned) {
            if (!validInterval(every)) errors["everyDays"] = tr("asset_form_interval_invalid")
            if (form.seasonal && !validInterval(summer)) errors["summerEveryDays"] = tr("asset_form_interval_invalid")
        }
        for ((field, value) in listOf("purchaseDate" to form.purchaseDate, "installedDate" to form.installedDate, "warrantyUntil" to form.warrantyUntil, "warrantyExtendedUntil" to form.warrantyExtendedUntil)) {
            if (value.isNotEmpty() && !Dates.isValid(value)) errors[field] = tr("field_invalid_date")
        }
        if (errors.isNotEmpty()) {
            update { it.copy(fieldErrors = errors, error = null) }
            return
        }
        update { it.copy(saving = true, error = null, fieldErrors = emptyMap()) }
        launch({ e ->
            val taken = if (e.code == "conflict") e.copy(message = tr("asset_error_name_taken")) else e
            update { it.copy(saving = false, error = if (e.fields.isEmpty()) taken else null, fieldErrors = e.fields) }
        }) {
            val existing = id?.let { app.api.assets.assetsGet(it) } ?: created
            val saved = if (existing != null) updateAsset(existing.id, form) else createAsset(form)
            created = saved
            if (planned && every != null) {
                try {
                    app.api.tasks.tasksCreate(planRequest(saved, form, every, summer))
                } catch (e: kotlin.coroutines.cancellation.CancellationException) {
                    throw e
                } catch (e: Exception) {
                    app.changed("assets")
                    val reason = ch.orellbuehler.hauswart.core.uiErrorOf(e).message
                    update { it.copy(saving = false, error = UiError(tr("asset_form_plan_failed", "error" to reason), "plan_failed")) }
                    return@launch
                }
                app.changed("tasks")
            }
            app.changed("assets")
            update { it.copy(saving = false, savedId = saved.id) }
        }
    }

    private fun validInterval(value: Long?): Boolean = value != null && value in 1..MAX_INTERVAL_DAYS

    private suspend fun createAsset(form: AssetForm): Asset =
        app.api.assets.assetsCreate(
            AssetsCreateRequest(
                kind = form.kind,
                name = form.name.trim(),
                roomId = form.roomId.ifEmpty { null },
                category = form.category.clean(),
                manufacturer = form.manufacturer.clean(),
                model = form.model.clean(),
                serialNumber = form.serialNumber.clean(),
                purchaseDate = form.purchaseDate.ifEmpty { null },
                installedDate = form.installedDate.ifEmpty { null },
                warrantyUntil = form.warrantyUntil.ifEmpty { null },
                warrantyExtendedUntil = form.warrantyExtendedUntil.ifEmpty { null },
                showOnEmergency = form.showOnEmergency,
                notes = form.notes.clean(),
                species = form.species.clean(),
                light = form.light.clean(),
                waterNotes = form.waterNotes.clean(),
            ),
        )

    private suspend fun updateAsset(
        assetId: String,
        form: AssetForm,
    ): Asset =
        app.api.assets.assetsUpdate(
            assetId,
            AssetsUpdateRequest(
                kind = form.kind,
                name = form.name.trim(),
                roomId = Patch.of(form.roomId.ifEmpty { null }),
                category = Patch.of(form.category.clean()),
                manufacturer = Patch.of(form.manufacturer.clean()),
                model = Patch.of(form.model.clean()),
                serialNumber = Patch.of(form.serialNumber.clean()),
                purchaseDate = Patch.of(form.purchaseDate.ifEmpty { null }),
                installedDate = Patch.of(form.installedDate.ifEmpty { null }),
                warrantyUntil = Patch.of(form.warrantyUntil.ifEmpty { null }),
                warrantyExtendedUntil = Patch.of(form.warrantyExtendedUntil.ifEmpty { null }),
                showOnEmergency = form.showOnEmergency,
                notes = Patch.of(form.notes.clean()),
                species = Patch.of(form.species.clean()),
                light = Patch.of(form.light.clean()),
                waterNotes = Patch.of(form.waterNotes.clean()),
            ),
        )

    private fun planRequest(
        asset: Asset,
        form: AssetForm,
        every: Long,
        summer: Long?,
    ): TasksCreateRequest =
        TasksCreateRequest(
            title = tr("asset_form_plan_task_title", "name" to asset.name),
            category = "plant",
            assetId = asset.id,
            trigger =
                Trigger.Interval(
                    every = every,
                    unit = "day",
                    anchor = "completion",
                    startDate = app.household.today(),
                    seasons =
                        if (form.seasonal && summer != null) {
                            listOf(TriggerIntervalSeasonsItem(fromMonth = 4, toMonth = 9, every = summer, unit = "day"))
                        } else {
                            null
                        },
                ),
        )

    private fun load() {
        update { it.copy(loading = true, loadError = null) }
        launch({ e -> update { it.copy(loading = false, loadError = e) } }) {
            val (rooms, asset) =
                coroutineScope {
                    val r = async { fetchRooms(app) }
                    val a = async { id?.let { app.api.assets.assetsGet(it) } }
                    r.await() to a.await()
                }
            app.household.get()
            val form =
                if (asset == null) {
                    AssetForm(kind = if (kind in ASSET_KINDS) kind else "device", roomId = rooms.firstOrNull { it.id == roomId }?.id ?: "")
                } else {
                    AssetForm(
                        kind = asset.kind,
                        name = asset.name,
                        roomId = asset.roomId ?: "",
                        category = asset.category ?: "",
                        manufacturer = asset.manufacturer ?: "",
                        model = asset.model ?: "",
                        serialNumber = asset.serialNumber ?: "",
                        purchaseDate = asset.purchaseDate ?: "",
                        installedDate = asset.installedDate ?: "",
                        warrantyUntil = asset.warrantyUntil ?: "",
                        warrantyExtendedUntil = asset.warrantyExtendedUntil ?: "",
                        showOnEmergency = asset.showOnEmergency,
                        notes = asset.notes ?: "",
                        species = asset.species ?: "",
                        light = asset.light ?: "",
                        waterNotes = asset.waterNotes ?: "",
                    )
                }
            update {
                it.copy(
                    loading = false,
                    initial = form,
                    roomOptions = listOf(InventoryChoice("", tr("asset_no_room"))) + rooms.map { r -> InventoryChoice(r.id, r.name) },
                )
            }
        }
    }
}

private fun String.clean(): String? = trim().ifEmpty { null }
