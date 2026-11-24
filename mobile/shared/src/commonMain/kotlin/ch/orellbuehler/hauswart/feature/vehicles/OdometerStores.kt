package ch.orellbuehler.hauswart.feature.vehicles

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.ApiException
import ch.orellbuehler.hauswart.api.generated.OdometerCreateRequest
import ch.orellbuehler.hauswart.api.generated.OdometerReading
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.formatNumber
import ch.orellbuehler.hauswart.feature.tasks.parseOdometer
import ch.orellbuehler.hauswart.i18n.tr

const val ODOMETER_NOTE_MAX = 500
private const val ODOMETER_PAGE = 20L

/** What the record dialog holds, as typed. */
data class OdometerForm(
    val value: String = "",
    val date: String = "",
    val note: String = "",
)

data class OdometerRecordState(
    val loading: Boolean = false,
    val loadError: UiError? = null,
    val unit: String = "km",
    val today: String = "",
    /** The reference under the field: the latest reading, or why a first one helps. */
    val hint: String = "",
    /** The values the dialog starts with; null until the vehicle is loaded. */
    val initial: OdometerForm? = null,
    val saving: Boolean = false,
    val error: UiError? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    /** The server refused exactly this entry as lower or higher than a neighbour; sending it again forces it. */
    val refusedFor: OdometerForm? = null,
    /** The long explanation of a refusal, shown above the form. */
    val refusalText: String? = null,
    /** Set once the reading is saved: the text for the toast; the dialog closes. */
    val savedText: String? = null,
)

/**
 * The dialog that records an odometer reading of a vehicle. Call [reset] when it opens: it loads the vehicle's
 * unit and latest reading and starts a new form.
 */
class OdometerRecordStore(
    private val app: HauswartApp,
    private val assetId: String,
) : Store<OdometerRecordState>(OdometerRecordState()) {
    fun reset() {
        update { OdometerRecordState(loading = true) }
        launch({ e -> update { it.copy(loading = false, loadError = e) } }) {
            val vehicle = app.api.vehicles.vehiclesGet(assetId)
            app.household.get()
            val today = app.household.today()
            val latest = vehicle.odometer
            val hint =
                if (latest != null) {
                    tr(
                        "vehicle_odometer_latest",
                        "value" to odometerText(latest.value, latest.unit),
                        "date" to Dates.format(latest.date),
                    )
                } else {
                    tr("vehicle_odometer_none_hint")
                }
            update {
                it.copy(
                    loading = false,
                    unit = vehicle.odometerUnit,
                    today = today,
                    hint = hint,
                    initial = OdometerForm(date = today),
                )
            }
        }
    }

    /** True when saving [form] sends `force`: the person has seen the warning for exactly this entry. */
    fun isForced(form: OdometerForm): Boolean = current.refusedFor == form

    fun save(form: OdometerForm) {
        val s = current
        if (s.saving || s.initial == null) return
        val errors = mutableMapOf<String, String>()
        val input = parseOdometer(form.value, VEHICLE_MAX_ODOMETER)
        if (!input.valid) {
            errors["value"] = tr("vehicle_odometer_invalid", "max" to formatNumber(VEHICLE_MAX_ODOMETER))
        } else if (input.value == null) {
            errors["value"] = tr("m_field_required")
        }
        if (form.date.isEmpty()) {
            errors["date"] = tr("m_field_required")
        } else if (!Dates.isValid(form.date)) {
            errors["date"] = tr("field_invalid_date")
        } else if (form.date > s.today) {
            errors["date"] = tr("vehicle_odometer_date_future")
        }
        if (form.note.trim().length > ODOMETER_NOTE_MAX) errors["note"] = tr("field_too_long", "max" to ODOMETER_NOTE_MAX)
        val reading = input.value
        if (errors.isNotEmpty() || reading == null) {
            update { it.copy(fieldErrors = errors, error = UiError(tr("form_check_fields"), "invalid_request")) }
            return
        }
        val force = isForced(form)
        update { it.copy(saving = true, error = null, fieldErrors = emptyMap()) }
        launch({ e ->
            update {
                it.copy(
                    saving = false,
                    error = if (e.fields.isEmpty()) e else UiError(tr("form_check_fields"), e.code),
                    fieldErrors = e.fields,
                )
            }
        }) {
            try {
                val saved =
                    app.api.vehicles.odometerCreate(
                        assetId,
                        OdometerCreateRequest(
                            date = form.date,
                            value = reading,
                            note = form.note.trim().ifEmpty { null },
                            force = if (force) true else null,
                        ),
                    )
                update {
                    it.copy(
                        saving = false,
                        refusedFor = null,
                        refusalText = null,
                        savedText = tr("vehicle_odometer_saved_toast", "value" to odometerText(saved.value, s.unit)),
                    )
                }
                app.changed("vehicles", "tasks", "assets")
            } catch (e: ApiException) {
                val refusal = odometerRefusalOf(e)?.takeIf { it.field == "value" } ?: throw e
                update {
                    it.copy(
                        saving = false,
                        refusedFor = form,
                        refusalText = odometerRefusalText(refusal, s.unit, canForce = true),
                        fieldErrors = mapOf("value" to odometerRefusalShort(refusal)),
                        error = null,
                    )
                }
            }
        }
    }

    fun ackSaved() {
        update { it.copy(savedText = null) }
    }
}

/** One reading of the history. */
data class OdometerLine(
    val id: String,
    val dateText: String,
    val valueText: String,
    /** Where the reading came from; null for one typed in by hand. */
    val sourceLabel: String?,
    val note: String?,
    val deleteLabel: String,
    val confirmText: String,
)

data class OdometerState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val unit: String = "km",
    val lines: List<OdometerLine> = emptyList(),
    val hasMore: Boolean = false,
    val loadingMore: Boolean = false,
    val deleting: Boolean = false,
    /** A failed delete; the list stays. */
    val actionError: UiError? = null,
    val notice: String? = null,
)

/** The odometer history of a vehicle, newest first, with delete. */
class OdometerStore(
    private val app: HauswartApp,
    private val assetId: String,
) : Store<OdometerState>(OdometerState()) {
    private var readings: List<OdometerReading> = emptyList()
    private var cursor: String? = null

    init {
        onChange(app, "vehicles") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    private fun line(
        reading: OdometerReading,
        unit: String,
    ): OdometerLine {
        val value = odometerText(reading.value, unit)
        val date = Dates.format(reading.date)
        return OdometerLine(
            id = reading.id,
            dateText = date,
            valueText = value,
            sourceLabel = if (reading.source == "manual") null else odometerSourceLabel(reading.source),
            note = reading.note?.takeIf { it.isNotBlank() },
            deleteLabel = tr("vehicle_history_delete_aria", "value" to value, "date" to date),
            confirmText = tr("vehicle_history_delete_description", "value" to value, "date" to date),
        )
    }

    private fun show(unit: String) {
        update { it.copy(unit = unit, lines = readings.map { r -> line(r, unit) }, hasMore = cursor != null) }
    }

    private fun load() {
        update { it.copy(loading = it.lines.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            val vehicle = app.api.vehicles.vehiclesGet(assetId)
            val page = app.api.vehicles.odometerList(assetId, limit = ODOMETER_PAGE)
            readings = page.items
            cursor = page.nextCursor
            show(vehicle.odometerUnit)
            update { it.copy(loading = false) }
        }
    }

    fun loadMore() {
        val next = cursor ?: return
        if (current.loadingMore) return
        update { it.copy(loadingMore = true) }
        launch({ e -> update { it.copy(loadingMore = false, actionError = e) } }) {
            val page = app.api.vehicles.odometerList(assetId, cursor = next, limit = ODOMETER_PAGE)
            readings = readings + page.items
            cursor = page.nextCursor
            show(current.unit)
            update { it.copy(loadingMore = false) }
        }
    }

    fun delete(id: String) {
        if (current.deleting) return
        update { it.copy(deleting = true, actionError = null) }
        launch({ e -> update { it.copy(deleting = false, actionError = e) } }) {
            try {
                app.api.vehicles.odometerDelete(id)
            } catch (e: ApiException) {
                val owner = odometerOwnerOf(e) ?: throw e
                update { it.copy(deleting = false, actionError = UiError(odometerOwnerMessage(owner), e.code)) }
                return@launch
            }
            update { it.copy(deleting = false, notice = tr("vehicle_history_deleted_toast")) }
            app.changed("vehicles", "tasks", "assets")
        }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    fun dismissNotice() {
        update { it.copy(notice = null) }
    }
}
