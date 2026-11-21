package ch.orellbuehler.hauswart.feature.vehicles

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.ApiException
import ch.orellbuehler.hauswart.api.Patch
import ch.orellbuehler.hauswart.api.generated.TireSet
import ch.orellbuehler.hauswart.api.generated.TireSetDetail
import ch.orellbuehler.hauswart.api.generated.TireSetsCreateRequest
import ch.orellbuehler.hauswart.api.generated.TireSetsMountRequest
import ch.orellbuehler.hauswart.api.generated.TireSetsTreadRequest
import ch.orellbuehler.hauswart.api.generated.TireSetsUpdateRequest
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.core.formatNumber
import ch.orellbuehler.hauswart.feature.tasks.readingToSend
import ch.orellbuehler.hauswart.i18n.tr

/** Tread depth in millimetres below which a set should be replaced soon, per season. */
fun treadWarningLimit(season: String): Double = if (season == "summer") 3.0 else 4.0

/** Tires older than this many years should be looked at whatever their tread. */
const val TIRE_AGE_WARNING_YEARS = 6

private val DOT_PATTERN = Regex("^(0[1-9]|[1-4]\\d|5[0-3])(\\d{2})$")

fun isValidDot(dot: String): Boolean = DOT_PATTERN.matches(dot)

fun tireSetTitle(
    season: String,
    size: String?,
): String {
    val label = tireSeasonLabel(season)
    return if (size.isNullOrBlank()) label else "$label $size"
}

/** One tire set as a row. [warnings] are empty for a retired set. */
data class TireSetRow(
    val id: String,
    val season: String,
    val title: String,
    val make: String,
    val mounted: Boolean,
    val retired: Boolean,
    val badge: String?,
    val warnings: List<String>,
    val facts: List<VehicleFact>,
    val notes: String?,
    val canMount: Boolean,
    val canMeasure: Boolean,
    val actionsLabel: String,
)

internal fun TireSetDetail.asTireSet(): TireSet =
    TireSet(
        id = id,
        assetId = assetId,
        season = season,
        brand = brand,
        model = model,
        size = size,
        dot = dot,
        treadDepthMm = treadDepthMm,
        treadMeasuredOn = treadMeasuredOn,
        treadWarning = treadWarning,
        ageYears = ageYears,
        storageLocation = storageLocation,
        storageContactId = storageContactId,
        storageContactName = storageContactName,
        mounted = mounted,
        mountedOn = mountedOn,
        purchasedOn = purchasedOn,
        retiredAt = retiredAt,
        notes = notes,
        distance = distance,
        odometerUnit = odometerUnit,
        createdAt = createdAt,
        updatedAt = updatedAt,
    )

internal fun tireRowOf(set: TireSet): TireSetRow {
    val retired = set.retiredAt != null
    val title = tireSetTitle(set.season, set.size)
    val warnings = mutableListOf<String>()
    val treadBad = set.treadWarning && set.treadDepthMm != null && !retired
    if (treadBad) {
        warnings +=
            tr(
                "tire_warning_tread",
                "depth" to formatNumber(set.treadDepthMm ?: 0.0),
                "limit" to formatNumber(treadWarningLimit(set.season)),
            )
    }
    val age = set.ageYears
    val ageBad = age != null && age >= TIRE_AGE_WARNING_YEARS && !retired
    if (ageBad) warnings += tr("tire_warning_age", "years" to formatNumber(age ?: 0.0), "limit" to TIRE_AGE_WARNING_YEARS)
    val facts = mutableListOf<VehicleFact>()
    facts +=
        if (set.treadDepthMm != null) {
            VehicleFact(
                tr("tire_fact_tread"),
                tr("tire_fact_tread_value", "depth" to formatNumber(set.treadDepthMm)),
                note = set.treadMeasuredOn?.let { tr("tire_fact_tread_date", "date" to Dates.format(it)) },
                warning = treadBad,
            )
        } else {
            VehicleFact(tr("tire_fact_tread"), tr("tire_fact_tread_none"))
        }
    facts +=
        if (age != null) {
            VehicleFact(
                tr("tire_fact_age"),
                tr("tire_fact_age_value", "years" to formatNumber(age)),
                note = set.dot?.let { tr("tire_fact_dot", "dot" to it) },
                warning = ageBad,
            )
        } else {
            VehicleFact(tr("tire_fact_age"), tr("tire_fact_age_none"))
        }
    if (set.mounted && set.mountedOn != null) facts += VehicleFact(tr("tire_fact_mounted_since"), Dates.format(set.mountedOn))
    val distance = set.distance
    if (distance != null && distance > 0) facts += VehicleFact(tr("tire_fact_distance"), odometerText(distance, set.odometerUnit))
    val storage = listOfNotNull(set.storageLocation, set.storageContactName).filter { it.isNotBlank() }
    if (storage.isNotEmpty()) facts += VehicleFact(tr("tire_fact_storage"), storage.joinToString(" · "))
    if (set.purchasedOn != null) facts += VehicleFact(tr("tire_fact_purchased"), Dates.format(set.purchasedOn))
    return TireSetRow(
        id = set.id,
        season = set.season,
        title = title,
        make = listOfNotNull(set.brand, set.model).filter { it.isNotBlank() }.joinToString(" "),
        mounted = set.mounted,
        retired = retired,
        badge =
            if (set.mounted) {
                tr("tire_badge_mounted")
            } else if (retired) {
                tr("tire_badge_retired")
            } else {
                null
            },
        warnings = warnings.map { "$title: $it" },
        facts = facts,
        notes = set.notes?.takeIf { it.isNotBlank() },
        canMount = !set.mounted && !retired,
        canMeasure = !retired,
        actionsLabel = tr("tire_actions_aria", "name" to title),
    )
}

/** What the set form holds, as typed. [storageContactId] is "" for none. */
data class TireSetForm(
    val season: String = "winter",
    val brand: String = "",
    val model: String = "",
    val size: String = "",
    val dot: String = "",
    val treadDepth: String = "",
    val treadMeasuredOn: String = "",
    val storageLocation: String = "",
    val storageContactId: String = "",
    val purchasedOn: String = "",
    val notes: String = "",
)

data class TireMountForm(
    val date: String = "",
    val odometer: String = "",
)

data class TireTreadForm(
    val date: String = "",
    val depth: String = "",
    val odometer: String = "",
)

data class TireSetsState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val unit: String = "km",
    val today: String = "",
    val rows: List<TireSetRow> = emptyList(),
    val retiredCount: Int = 0,
    val showRetired: Boolean = false,
    /** The text of the button that shows or hides the retired sets; empty without any. */
    val retiredToggle: String = "",
    /** "Aufgezogen: Winterreifen 205/55 R16, seit 01.11.2026." */
    val summary: String? = null,
    /** The warnings of every set that is in use, ready to show. */
    val warnings: List<String> = emptyList(),
    /** The day the mounted set was mounted: no other set can be mounted before. */
    val mountedSince: String? = null,
    val readingHint: String = "",
    /** The hint under the tread field: the depths below which a set is flagged. */
    val treadHint: String =
        tr(
            "tire_tread_hint",
            "summer" to treadWarningLimit("summer").toInt(),
            "winter" to treadWarningLimit("winter").toInt(),
        ),
    val contacts: List<VehicleChoice> = emptyList(),
    val saving: Boolean = false,
    /** A failure of the open dialog that belongs to no field. */
    val formError: UiError? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    /** True once the open dialog's action went through; the screen closes it and calls [TireSetsStore.ackDone]. */
    val done: Boolean = false,
    /** A failed action outside a dialog (retire, delete). */
    val actionError: UiError? = null,
    val notice: String? = null,
) {
    /** The rows to show: sets in use and, when switched on, the retired ones. */
    val visible: List<TireSetRow> get() = if (showRetired) rows else rows.filter { !it.retired }
}

/** The tire sets of a vehicle with add, edit, mount, tread measurement, retire and delete. */
class TireSetsStore(
    private val app: HauswartApp,
    private val assetId: String,
) : Store<TireSetsState>(TireSetsState()) {
    private var sets: List<TireSet> = emptyList()
    private var tireSizes: Map<String, String> = emptyMap()
    private var known: Double? = null
    private var contactsLoaded = false

    init {
        onChange(app, "vehicles") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun toggleRetired() {
        update { it.copy(showRetired = !it.showRetired, retiredToggle = retiredToggleText(!it.showRetired, it.retiredCount)) }
    }

    private fun retiredToggleText(
        shown: Boolean,
        count: Int,
    ): String =
        when {
            count == 0 -> ""
            shown -> tr("tire_hide_retired")
            else -> tr("tire_show_retired", "count" to count)
        }

    private fun load() {
        update { it.copy(loading = it.rows.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            app.household.get()
            val vehicle = app.api.vehicles.vehiclesGet(assetId)
            sets =
                fetchAll { cursor ->
                    val page = app.api.vehicles.tireSetsList(assetId, cursor = cursor, limit = 200, includeRetired = true)
                    page.items to page.nextCursor
                }
            tireSizes =
                mapOf(
                    "summer" to vehicle.tireSizeSummer.orEmpty(),
                    "winter" to vehicle.tireSizeWinter.orEmpty(),
                    "all_season" to (vehicle.tireSizeSummer ?: vehicle.tireSizeWinter).orEmpty(),
                )
            known = vehicle.odometer?.value
            val rows = sets.sortedWith(compareBy({ !it.mounted }, { it.retiredAt != null })).map(::tireRowOf)
            val mounted = sets.firstOrNull { it.mounted }
            val latest = vehicle.odometer
            update {
                it.copy(
                    loading = false,
                    unit = vehicle.odometerUnit,
                    today = app.household.today(),
                    rows = rows,
                    retiredCount = rows.count { r -> r.retired },
                    retiredToggle = retiredToggleText(it.showRetired, rows.count { r -> r.retired }),
                    summary =
                        when {
                            sets.isEmpty() -> null
                            mounted != null ->
                                tr(
                                    "tire_card_mounted",
                                    "name" to tireSetTitle(mounted.season, mounted.size),
                                    "date" to (mounted.mountedOn?.let { d -> Dates.format(d) } ?: ""),
                                )
                            else -> tr("tire_card_none_mounted")
                        },
                    warnings = rows.filter { r -> !r.retired }.flatMap { r -> r.warnings },
                    mountedSince = mounted?.mountedOn,
                    readingHint =
                        if (latest != null) {
                            tr(
                                "vehicle_odometer_prefilled",
                                "value" to odometerText(latest.value, latest.unit),
                                "date" to Dates.format(latest.date),
                            )
                        } else {
                            tr("vehicle_odometer_none_hint")
                        },
                )
            }
        }
    }

    /** Loads the contacts a set can be stored with; call it when the set form opens. */
    fun prepareForm() {
        if (contactsLoaded) return
        contactsLoaded = true
        launch({ e ->
            contactsLoaded = false
            update { it.copy(formError = e) }
        }) {
            val contacts =
                fetchAll { cursor ->
                    val page = app.api.contacts.contactsList(cursor = cursor, limit = 200)
                    page.items to page.nextCursor
                }
            update {
                it.copy(
                    contacts =
                        listOf(VehicleChoice("", tr("m_vehicle_none"))) +
                            contacts.map { c ->
                                VehicleChoice(c.id, c.name)
                            },
                )
            }
        }
    }

    /** The form for a new set of [season]; the size comes from the vehicle's details. */
    fun newForm(season: String): TireSetForm =
        TireSetForm(season = season, size = tireSizes[season].orEmpty(), treadMeasuredOn = current.today)

    /** [form] after another season was picked: the size follows unless the person typed one. */
    fun withSeason(
        form: TireSetForm,
        season: String,
    ): TireSetForm {
        val untouched = form.size.isEmpty() || form.size == tireSizes[form.season]
        return form.copy(season = season, size = if (untouched) tireSizes[season].orEmpty() else form.size)
    }

    fun seasonChoices(): List<VehicleChoice> = VEHICLE_TIRE_SEASONS.map { VehicleChoice(it, tireSeasonOptionLabel(it)) }

    fun editForm(id: String): TireSetForm? =
        sets.firstOrNull { it.id == id }?.let { s ->
            TireSetForm(
                season = s.season,
                brand = s.brand.orEmpty(),
                model = s.model.orEmpty(),
                size = s.size.orEmpty(),
                dot = s.dot.orEmpty(),
                treadMeasuredOn = s.treadMeasuredOn.orEmpty(),
                storageLocation = s.storageLocation.orEmpty(),
                storageContactId = s.storageContactId.orEmpty(),
                purchasedOn = s.purchasedOn.orEmpty(),
                notes = s.notes.orEmpty(),
            )
        }

    fun newMountForm(): TireMountForm = TireMountForm(date = current.today, odometer = known?.let { plainReading(it) }.orEmpty())

    fun newTreadForm(): TireTreadForm = TireTreadForm(date = current.today, odometer = known?.let { plainReading(it) }.orEmpty())

    /** The dialog title and text of a set: "Winterreifen 205/55 R16". */
    fun titleOf(id: String): String = sets.firstOrNull { it.id == id }?.let { tireSetTitle(it.season, it.size) }.orEmpty()

    /** Clears the errors of the dialog that was just closed or is about to open. */
    fun clearForm() {
        update { it.copy(formError = null, fieldErrors = emptyMap(), done = false, saving = false) }
    }

    fun ackDone() {
        update { it.copy(done = false) }
    }

    fun dismissNotice() {
        update { it.copy(notice = null) }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    private fun checkDay(
        date: String,
        errors: MutableMap<String, String>,
    ) {
        if (date.isEmpty()) {
            errors["date"] = tr("m_field_required")
        } else if (!Dates.isValid(date)) {
            errors["date"] = tr("field_invalid_date")
        } else if (date > current.today) {
            errors["date"] = tr("vehicle_odometer_date_future")
        }
    }

    private fun readOdometer(
        text: String,
        errors: MutableMap<String, String>,
    ): Double? {
        val input = readingToSend(text, known, VEHICLE_MAX_ODOMETER)
        if (!input.valid) errors["odometer"] = tr("vehicle_odometer_invalid", "max" to formatNumber(VEHICLE_MAX_ODOMETER))
        return input.value
    }

    private fun fail(errors: Map<String, String>) {
        update { it.copy(fieldErrors = errors, formError = UiError(tr("form_check_fields"), "invalid_request")) }
    }

    /** Runs a dialog's request: validation errors from the server go under the fields, a refused reading under the odometer. */
    private fun submit(
        success: String?,
        call: suspend () -> Unit,
    ) {
        update { it.copy(saving = true, formError = null, fieldErrors = emptyMap()) }
        launch({ e ->
            update {
                it.copy(
                    saving = false,
                    formError = if (e.fields.isEmpty()) e else UiError(tr("form_check_fields"), e.code),
                    fieldErrors = e.fields,
                )
            }
        }) {
            try {
                call()
            } catch (e: ApiException) {
                val refusal = odometerRefusalOf(e)?.takeIf { it.field == "odometer" }
                if (refusal != null) {
                    update {
                        it.copy(
                            saving = false,
                            formError = UiError(tr("form_check_fields"), e.code),
                            fieldErrors = mapOf("odometer" to odometerRefusalText(refusal, current.unit, canForce = false)),
                        )
                    }
                    return@launch
                }
                throw e
            }
            update { it.copy(saving = false, done = true, notice = success) }
            app.changed("vehicles", "tasks")
        }
    }

    private fun checkSet(
        form: TireSetForm,
        errors: MutableMap<String, String>,
    ) {
        val dot = form.dot.trim()
        if (dot.isNotEmpty() && !isValidDot(dot)) errors["dot"] = tr("tire_error_dot")
        if (form.purchasedOn.isNotEmpty() && !Dates.isValid(form.purchasedOn)) errors["purchasedOn"] = tr("field_invalid_date")
    }

    /** Adds a set ([id] null) or saves the changes of one. */
    fun save(
        id: String?,
        form: TireSetForm,
    ) {
        if (current.saving) return
        val errors = mutableMapOf<String, String>()
        checkSet(form, errors)
        val depth = parseVehicleDecimal(form.treadDepth, VEHICLE_MAX_TREAD_MM)
        if (id == null) {
            if (!depth.valid) {
                errors["treadDepthMm"] = tr("tire_error_tread", "max" to formatNumber(VEHICLE_MAX_TREAD_MM))
            } else if (depth.value != null) {
                val on = form.treadMeasuredOn.ifEmpty { current.today }
                if (!Dates.isValid(on)) {
                    errors["treadMeasuredOn"] = tr("field_invalid_date")
                } else if (on > current.today) {
                    errors["treadMeasuredOn"] = tr("vehicle_odometer_date_future")
                }
            }
        }
        if (errors.isNotEmpty()) {
            fail(errors)
            return
        }

        fun text(value: String): String? = value.trim().ifEmpty { null }
        submit(tr(if (id == null) "tire_created_toast" else "tire_saved_toast")) {
            if (id == null) {
                app.api.vehicles.tireSetsCreate(
                    assetId,
                    TireSetsCreateRequest(
                        season = form.season,
                        brand = text(form.brand),
                        model = text(form.model),
                        size = text(form.size),
                        dot = text(form.dot),
                        treadDepthMm = depth.value,
                        treadMeasuredOn = if (depth.value != null) form.treadMeasuredOn.ifEmpty { current.today } else null,
                        storageLocation = text(form.storageLocation),
                        storageContactId = form.storageContactId.ifEmpty { null },
                        purchasedOn = form.purchasedOn.ifEmpty { null },
                        notes = text(form.notes),
                    ),
                )
            } else {
                app.api.vehicles.tireSetsUpdate(
                    id,
                    TireSetsUpdateRequest(
                        season = form.season,
                        brand = Patch.of(text(form.brand)),
                        model = Patch.of(text(form.model)),
                        size = Patch.of(text(form.size)),
                        dot = Patch.of(text(form.dot)),
                        storageLocation = Patch.of(text(form.storageLocation)),
                        storageContactId = Patch.of(form.storageContactId.ifEmpty { null }),
                        purchasedOn = Patch.of(form.purchasedOn.ifEmpty { null }),
                        notes = Patch.of(text(form.notes)),
                    ),
                )
            }
        }
    }

    fun mount(
        id: String,
        form: TireMountForm,
    ) {
        if (current.saving) return
        val errors = mutableMapOf<String, String>()
        checkDay(form.date, errors)
        val since = current.mountedSince
        if (errors["date"] == null && since != null && form.date < since) {
            errors["date"] = tr("tire_mount_date_before", "date" to Dates.format(since))
        }
        val odometer = readOdometer(form.odometer, errors)
        if (errors.isNotEmpty()) {
            fail(errors)
            return
        }
        val name = titleOf(id)
        update { it.copy(saving = true, formError = null, fieldErrors = emptyMap()) }
        launch({ e -> update { it.copy(saving = false, formError = mountError(e, since), fieldErrors = mountFields(e, since)) } }) {
            try {
                app.api.vehicles.tireSetsMount(assetId, id, TireSetsMountRequest(date = form.date, odometer = odometer))
            } catch (e: ApiException) {
                val refusal = odometerRefusalOf(e)?.takeIf { it.field == "odometer" } ?: throw e
                update {
                    it.copy(
                        saving = false,
                        formError = UiError(tr("form_check_fields"), e.code),
                        fieldErrors = mapOf("odometer" to odometerRefusalText(refusal, current.unit, canForce = false)),
                    )
                }
                return@launch
            }
            update { it.copy(saving = false, done = true, notice = tr("tire_mounted_toast", "name" to name)) }
            app.changed("vehicles", "tasks")
        }
    }

    private fun mountFields(
        e: UiError,
        since: String?,
    ): Map<String, String> =
        e.fields.mapValues { (field, message) ->
            if (field == "date") {
                if (since != null) tr("tire_mount_date_before", "date" to Dates.format(since)) else tr("tire_mount_date_refused")
            } else {
                message
            }
        }

    private fun mountError(
        e: UiError,
        since: String?,
    ): UiError =
        when {
            e.code == "conflict" -> UiError(tr("tire_error_not_mountable"), e.code)
            e.fields.isNotEmpty() -> UiError(tr("form_check_fields"), e.code, mountFields(e, since))
            else -> e
        }

    fun measure(
        id: String,
        form: TireTreadForm,
    ) {
        if (current.saving) return
        val errors = mutableMapOf<String, String>()
        checkDay(form.date, errors)
        val depth = parseVehicleDecimal(form.depth, VEHICLE_MAX_TREAD_MM)
        if (!depth.valid) {
            errors["treadDepthMm"] = tr("tire_error_tread", "max" to formatNumber(VEHICLE_MAX_TREAD_MM))
        } else if (depth.value == null) {
            errors["treadDepthMm"] = tr("m_field_required")
        }
        val odometer = readOdometer(form.odometer, errors)
        val measured = depth.value
        if (errors.isNotEmpty() || measured == null) {
            fail(errors)
            return
        }
        submit(tr("tire_tread_saved_toast", "depth" to formatNumber(measured))) {
            app.api.vehicles.tireSetsTread(id, TireSetsTreadRequest(date = form.date, treadDepthMm = measured, odometer = odometer))
        }
    }

    fun setRetired(
        id: String,
        retired: Boolean,
    ) {
        update { it.copy(actionError = null) }
        launch({ e -> update { it.copy(actionError = e, saving = false) } }) {
            app.api.vehicles.tireSetsUpdate(id, TireSetsUpdateRequest(retired = retired))
            update { it.copy(notice = tr(if (retired) "tire_retired_toast" else "tire_unretired_toast")) }
            app.changed("vehicles")
        }
    }

    fun delete(id: String) {
        update { it.copy(actionError = null) }
        launch({ e -> update { it.copy(actionError = e) } }) {
            app.api.vehicles.tireSetsDelete(id)
            update { it.copy(notice = tr("tire_deleted_toast")) }
            app.changed("vehicles")
        }
    }
}

private fun plainReading(value: Double): String = vehicleNumberInput(value)

/** One entry of a set's history. */
data class TireEventLine(
    val id: String,
    val title: String,
    val detail: String,
)

data class TireSetDetailState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val row: TireSetRow? = null,
    val events: List<TireEventLine> = emptyList(),
)

/** A tire set with its history; the files of the set hang on this screen. */
class TireSetDetailStore(
    private val app: HauswartApp,
    private val id: String,
) : Store<TireSetDetailState>(TireSetDetailState()) {
    init {
        onChange(app, "vehicles") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    private fun load() {
        update { it.copy(loading = it.row == null, error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            val set = app.api.vehicles.tireSetsGet(id)
            val events =
                set.events.sortedByDescending { it.date }.map { e ->
                    val parts =
                        listOfNotNull(
                            e.treadDepthMm?.let { d -> tr("tire_fact_tread_value", "depth" to formatNumber(d)) },
                            e.odometer?.let { o -> odometerText(o, set.odometerUnit) },
                        )
                    TireEventLine(
                        e.id,
                        tr(if (e.kind in TIRE_EVENT_KINDS) "m_tire_event_${e.kind}" else "m_tire_event_unknown"),
                        (listOf(Dates.format(e.date)) + parts).joinToString(" · "),
                    )
                }
            update { it.copy(loading = false, row = tireRowOf(set.asTireSet()), events = events) }
        }
    }
}

private val TIRE_EVENT_KINDS = listOf("mounted", "unmounted", "tread_measured")
