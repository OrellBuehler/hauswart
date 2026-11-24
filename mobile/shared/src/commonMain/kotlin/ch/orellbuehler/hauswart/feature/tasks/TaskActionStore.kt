package ch.orellbuehler.hauswart.feature.tasks

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.TaskDetail
import ch.orellbuehler.hauswart.api.generated.TasksCompleteRequest
import ch.orellbuehler.hauswart.api.generated.TasksCompleteRequestServiceLog
import ch.orellbuehler.hauswart.api.generated.TasksSkipRequest
import ch.orellbuehler.hauswart.api.generated.TasksSnoozeRequest
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Money
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.core.formatNumber
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.minus
import kotlinx.datetime.plus
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive

const val ACTION_COMPLETE = "complete"
const val ACTION_SKIP = "skip"
const val ACTION_SNOOZE = "snooze"

data class SnoozePreset(
    val label: String,
    val date: String,
)

/** The fields of the dialog as typed. */
data class TaskActionForm(
    val date: String = "",
    val note: String = "",
    val odometer: String = "",
    val logWork: Boolean = false,
    val logKind: String = "maintenance",
    val logTitle: String = "",
    val logDescription: String = "",
    val logContactId: String = "",
    val logCost: String = "",
    val logNoteIds: List<String> = emptyList(),
) {
    fun valueOf(field: String): String =
        when (field) {
            "date" -> date
            "note" -> note
            "odometer" -> odometer
            "logWork" -> logWork.toString()
            "logKind" -> logKind
            "logTitle" -> logTitle
            "logDescription" -> logDescription
            "logContactId" -> logContactId
            "logCost" -> logCost
            else -> ""
        }

    fun withField(
        field: String,
        text: String,
    ): TaskActionForm =
        when (field) {
            "date" -> copy(date = text)
            "note" -> copy(note = text)
            "odometer" -> copy(odometer = text)
            "logWork" -> copy(logWork = text == "true")
            "logKind" -> copy(logKind = text)
            "logTitle" -> copy(logTitle = text)
            "logDescription" -> copy(logDescription = text)
            "logContactId" -> copy(logContactId = text)
            "logCost" -> copy(logCost = text)
            else -> this
        }

    fun toggleNote(id: String): TaskActionForm = copy(logNoteIds = if (id in logNoteIds) logNoteIds - id else logNoteIds + id)

    fun withAllNotes(ids: List<String>): TaskActionForm = copy(logNoteIds = ids)
}

data class TaskActionState(
    val mode: String,
    val loading: Boolean = true,
    val loadError: UiError? = null,
    val title: String = "",
    val description: String = "",
    val submitLabel: String = "",
    val taskTitle: String = "",
    val initial: TaskActionForm? = null,
    val today: String = "",
    val presets: List<SnoozePreset> = emptyList(),
    /** The task has an asset: the work can be logged in its service log. */
    val canLogWork: Boolean = false,
    val serviceLogHint: String = "",
    /** The label of the odometer field ("Stand (km)"); null for a task that counts no odometer. */
    val odometerLabel: String? = null,
    val odometerHint: String = "",
    val currency: String = "CHF",
    val logLoading: Boolean = false,
    val logError: UiError? = null,
    val contacts: List<ChoiceOption> = emptyList(),
    val notes: List<ChoiceOption> = emptyList(),
    val saving: Boolean = false,
    val error: UiError? = null,
    /** Messages per field: `date`, `odometer`, `logTitle`, `logCost`. */
    val fieldErrors: Map<String, String> = emptyMap(),
    /** Set once the action went through: the screen closes the dialog and shows it. */
    val notice: TaskNotice? = null,
)

private data class Refusal(
    val code: String,
    val value: Double,
    val date: String,
)

private fun refusalOf(e: UiError): Refusal? {
    val details = e.details as? JsonObject ?: return null
    val code = details["code"]?.jsonPrimitive?.content ?: return null
    if (code != "lower_than_previous" && code != "higher_than_next") return null
    if (details["field"]?.jsonPrimitive?.content != "counterValue") return null
    val reading = details["reading"] as? JsonObject ?: return null
    val value = (reading["value"] as? JsonPrimitive)?.doubleOrNull ?: return null
    val date = (reading["date"] as? JsonPrimitive)?.content ?: return null
    return Refusal(code, value, date)
}

/**
 * The dialog that completes ([ACTION_COMPLETE]), skips or snoozes a task. It loads the task itself
 * (a completion needs its trigger, asset and open notes), so any screen can open it with an id.
 */
class TaskActionStore(
    private val app: HauswartApp,
    private val taskId: String,
    mode: String,
) : Store<TaskActionState>(TaskActionState(mode = mode)) {
    private var task: TaskDetail? = null
    private var knownReading: Double? = null
    private var unit: String = "km"
    private var logLoaded = false
    private val idempotencyKey = newIdempotencyKey()

    init {
        load()
    }

    fun retry() {
        load()
    }

    private fun load() {
        update { it.copy(loading = true, loadError = null) }
        launch({ e -> update { it.copy(loading = false, loadError = e) } }) {
            val household = app.household.get()
            val t = app.api.tasks.tasksGet(taskId)
            task = t
            val today = app.household.today()
            val mode = current.mode
            val vehicleId = if (mode == ACTION_COMPLETE) odometerAssetOf(t.trigger) else null
            var odometerLabel: String? = null
            var odometerHint = ""
            var odometerText = ""
            if (vehicleId != null) {
                val vehicle = app.api.vehicles.vehiclesGet(vehicleId)
                unit = vehicle.odometerUnit
                val latest = vehicle.odometer
                knownReading = latest?.value
                odometerLabel = tr("vehicle_odometer_value", "unit" to unit)
                odometerHint =
                    if (latest != null) {
                        tr(
                            "vehicle_odometer_prefilled",
                            "value" to "${formatNumber(latest.value)} $unit",
                            "date" to Dates.format(latest.date),
                        )
                    } else {
                        tr("vehicle_odometer_none_hint")
                    }
                odometerText = latest?.let { plainNumber(it.value) }.orEmpty()
            }
            val notes = t.openNoteCount
            val title: String
            val description: String
            val submit: String
            when (mode) {
                ACTION_COMPLETE -> {
                    title = tr("task_complete_dialog_title")
                    description = tr("task_complete_dialog_description", "title" to t.title)
                    submit = tr("task_complete")
                }
                ACTION_SKIP -> {
                    title = tr("task_skip_dialog_title")
                    description = tr("task_skip_dialog_description", "title" to t.title)
                    submit = tr("task_skip")
                }
                else -> {
                    title = tr("task_snooze_dialog_title")
                    description = tr("task_snooze_dialog_description", "title" to t.title)
                    submit = tr("task_snooze_submit")
                }
            }
            val presets =
                if (mode == ACTION_SNOOZE) {
                    listOf(
                        SnoozePreset(tr("snooze_tomorrow"), Dates.addDays(today, 1)),
                        SnoozePreset(tr("snooze_three_days"), Dates.addDays(today, 3)),
                        SnoozePreset(tr("snooze_next_week"), nextWeekStart(today)),
                        SnoozePreset(tr("snooze_next_month"), addMonth(today)),
                    )
                } else {
                    emptyList()
                }
            update {
                it.copy(
                    loading = false,
                    title = title,
                    description = description,
                    submitLabel = submit,
                    taskTitle = t.title,
                    today = today,
                    presets = presets,
                    canLogWork = mode == ACTION_COMPLETE && t.assetId != null,
                    serviceLogHint =
                        if (notes > 0) {
                            tr("task_service_log_hint") + " " + tr("task_service_log_notes_hint", "count" to notes)
                        } else {
                            tr("task_service_log_hint")
                        },
                    odometerLabel = odometerLabel,
                    odometerHint = odometerHint,
                    currency = household.currency,
                    initial =
                        TaskActionForm(
                            date = if (mode == ACTION_SNOOZE) Dates.addDays(today, 3) else today,
                            odometer = odometerText,
                            logTitle = t.title,
                        ),
                )
            }
        }
    }

    private fun nextWeekStart(today: String): String {
        val weekday = isoWeekdayOf(today)
        return Dates.addDays(today, 8 - weekday)
    }

    private fun addMonth(today: String): String {
        val d = Dates.parse(today) ?: return today
        val first = LocalDate(d.year, d.month, 1).plus(1, DateTimeUnit.MONTH)
        val last = first.plus(1, DateTimeUnit.MONTH).minus(1, DateTimeUnit.DAY).day
        return LocalDate(first.year, first.month, minOf(d.day, last)).toString()
    }

    /** Loads the contacts and open notes the service log part offers; call it when that part is switched on. */
    fun prepareServiceLog() {
        val t = task ?: return
        if (logLoaded) return
        logLoaded = true
        update { it.copy(logLoading = true, logError = null) }
        launch({ e ->
            logLoaded = false
            update { it.copy(logLoading = false, logError = e) }
        }) {
            val contacts =
                fetchAll { cursor ->
                    app.api.contacts
                        .contactsList(cursor = cursor, limit = 200)
                        .let { it.items to it.nextCursor }
                }
            val notes =
                if (t.assetId != null && t.openNoteCount > 0) {
                    fetchAll { cursor ->
                        app.api.assetNotes
                            .assetNotesList(t.assetId, cursor = cursor, limit = 200, status = "open")
                            .let { it.items to it.nextCursor }
                    }
                } else {
                    emptyList()
                }
            update {
                it.copy(
                    logLoading = false,
                    contacts = listOf(ChoiceOption("", tr("m_tasks_no_contact"))) + contacts.map { c -> ChoiceOption(c.id, c.name) },
                    notes = notes.map { n -> ChoiceOption(n.id, n.body) },
                )
            }
        }
    }

    fun save(form: TaskActionForm) {
        val t = task ?: return
        if (current.saving) return
        val s = current
        val errors = mutableMapOf<String, String>()
        val today = s.today
        var reading: Double? = null
        var serviceLog: TasksCompleteRequestServiceLog? = null
        when (s.mode) {
            ACTION_SNOOZE -> if (form.date.isBlank() || form.date <= today) errors["date"] = tr("task_snooze_future")
            ACTION_COMPLETE -> {
                if (form.date > today) errors["date"] = tr("task_complete_future")
                if (s.odometerLabel != null) {
                    val input = readingToSend(form.odometer, knownReading)
                    if (!input.valid) {
                        errors["odometer"] = tr("task_odometer_invalid", "max" to formatNumber(MAX_ODOMETER_VALUE))
                    } else {
                        reading =
                            input.value
                    }
                }
                if (form.logWork && s.canLogWork) {
                    if (form.logTitle.isBlank()) errors["logTitle"] = tr("field_required")
                    var cost = 0L
                    if (form.logCost.isNotBlank()) {
                        val parsed = Money.parse(form.logCost, s.currency)
                        if (parsed == null) errors["logCost"] = tr("field_number") else cost = parsed
                    }
                    if (errors.isEmpty()) {
                        serviceLog =
                            TasksCompleteRequestServiceLog(
                                kind = form.logKind,
                                title = form.logTitle.trim(),
                                descriptionMd = form.logDescription.takeIf { it.isNotBlank() },
                                contactId = form.logContactId.ifEmpty { null },
                                costMinor = cost.takeIf { it != 0L },
                                resolvedNoteIds = form.logNoteIds.ifEmpty { null },
                            )
                    }
                }
            }
        }
        if (errors.isNotEmpty()) {
            update { it.copy(fieldErrors = errors, error = UiError(tr("form_check_fields"), "invalid_request")) }
            return
        }
        update { it.copy(saving = true, error = null, fieldErrors = emptyMap()) }
        launch({ e -> update { refused(it, e) } }) {
            val note = form.note.trim().ifEmpty { null }
            when (s.mode) {
                ACTION_COMPLETE -> {
                    val backdated = form.date.isNotEmpty() && form.date < today
                    val result =
                        app.api.tasks.tasksComplete(
                            taskId,
                            TasksCompleteRequest(
                                note = note,
                                completedAt = if (backdated) noonInstant(form.date, app.household.timezone) else null,
                                idempotencyKey = idempotencyKey,
                                counterValue = reading,
                                serviceLog = serviceLog,
                            ),
                        )
                    val message = tr(if (serviceLog != null) "toast_completed_logged" else "toast_completed", "title" to t.title)
                    update {
                        it.copy(
                            saving = false,
                            notice = TaskNotice(message, UndoToken("completion", result.completion.id, taskId, null)),
                        )
                    }
                    app.changed("tasks", "parts", "assets")
                }
                ACTION_SKIP -> {
                    val result = app.api.tasks.tasksSkip(taskId, TasksSkipRequest(note = note, idempotencyKey = idempotencyKey))
                    update {
                        it.copy(
                            saving = false,
                            notice =
                                TaskNotice(
                                    tr("toast_skipped", "title" to t.title),
                                    UndoToken("completion", result.completion.id, taskId, null),
                                ),
                        )
                    }
                    app.changed("tasks")
                }
                else -> {
                    app.api.tasks.tasksSnooze(taskId, TasksSnoozeRequest(until = form.date))
                    val message = tr("toast_snoozed", "title" to t.title, "date" to Dates.format(form.date))
                    update { it.copy(saving = false, notice = TaskNotice(message, UndoToken("snooze", "", taskId, t.snoozedUntil))) }
                    app.changed("tasks")
                }
            }
        }
    }

    /** A rejected odometer reading names the neighbouring reading in the error's details; it belongs to the odometer field. */
    private fun refused(
        s: TaskActionState,
        e: UiError,
    ): TaskActionState {
        val refusal = refusalOf(e)
        if (refusal == null) return s.copy(saving = false, error = e, fieldErrors = e.fields.filterKeys { k -> k == "date" })
        val value = "${formatNumber(refusal.value)} $unit"
        val key = if (refusal.code == "lower_than_previous") "vehicle_odometer_refused_lower" else "vehicle_odometer_refused_higher"
        return s.copy(
            saving = false,
            error = UiError(tr("form_check_fields"), e.code),
            fieldErrors = mapOf("odometer" to tr(key, "value" to value, "date" to Dates.format(refusal.date))),
        )
    }
}
