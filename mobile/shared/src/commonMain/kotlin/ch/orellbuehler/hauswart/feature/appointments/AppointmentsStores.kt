package ch.orellbuehler.hauswart.feature.appointments

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.Appointment
import ch.orellbuehler.hauswart.api.generated.AppointmentsCompleteRequest
import ch.orellbuehler.hauswart.api.generated.AppointmentsUpdateRequest
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.core.relativeDays
import ch.orellbuehler.hauswart.i18n.tr

/** One appointment as a row of a list. */
data class ApptItem(
    val id: String,
    val title: String,
    /** "09:00", "all day", "Ongoing". */
    val timePrimary: String,
    /** "–10:00", "until 23.11."; empty for none. */
    val timeSecondary: String,
    /** The whole span in one line, for places without a time column. */
    val whenText: String,
    val location: String,
    val status: String,
    val statusLabel: String,
    val cancelled: Boolean,
    /** Planned and over: somebody still has to close it. */
    val needsClosing: Boolean,
    val taskTitle: String,
    val assetName: String,
    val contactName: String,
    val commentCount: Int,
)

private fun itemOf(
    a: Appointment,
    timeZone: String,
    today: String,
    day: String? = null,
): ApptItem {
    val span = whenOf(a, timeZone)
    val time = timeColumn(span, timeZone, today, day)
    return ApptItem(
        id = a.id,
        title = a.title,
        timePrimary = time.primary,
        timeSecondary = time.secondary,
        whenText = formatWhen(span, timeZone, today),
        location = a.location.orEmpty(),
        status = a.status,
        statusLabel = appointmentStatusLabel(a.status),
        cancelled = a.status == "cancelled",
        needsClosing = needsClosing(a, today, timeZone),
        taskTitle = a.taskTitle.orEmpty(),
        assetName = a.assetName.orEmpty(),
        contactName = a.contactName.orEmpty(),
        commentCount = a.commentCount.toInt(),
    )
}

/** The appointments that start on one day. */
data class ApptDayGroup(
    val date: String,
    /** "Today · Sa, 21.11." */
    val heading: String,
    val items: List<ApptItem>,
)

data class AppointmentsListState(
    val loading: Boolean = true,
    val error: UiError? = null,
    /** `upcoming` or `past`. */
    val view: String = "upcoming",
    /** The statuses switched on, in the order of [APPOINTMENT_STATUSES]. */
    val statuses: List<String> = listOf("planned"),
    /** Planned and over: still to be closed. Only the upcoming view has them. */
    val stillOpen: List<ApptItem> = emptyList(),
    val days: List<ApptDayGroup> = emptyList(),
    /** How many appointments are shown. */
    val total: Int = 0,
    /** The statuses are not the default of the view. */
    val filtered: Boolean = false,
    /** The past view loaded everything older than its window. */
    val olderLoaded: Boolean = false,
    /** Nothing older exists. */
    val olderNone: Boolean = false,
    val loadingOlder: Boolean = false,
    val olderError: UiError? = null,
)

/**
 * The household's appointments: "upcoming" (the last 30 days on, planned ones that are over first)
 * and "past" (the last 12 months, newest first, with "older" for the rest), filtered by status.
 */
class AppointmentsListStore(
    private val app: HauswartApp,
) : Store<AppointmentsListState>(AppointmentsListState()) {
    private var loaded: List<Appointment> = emptyList()
    private var older: List<Appointment>? = null
    private var generation = 0

    init {
        onChange(app, "appointments") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun setView(view: String) {
        if (view == current.view || view !in APPOINTMENT_VIEWS) return
        loaded = emptyList()
        older = null
        update {
            it.copy(
                view = view,
                statuses = defaultStatuses(view),
                stillOpen = emptyList(),
                days = emptyList(),
                total = 0,
                olderLoaded = false,
                olderNone = false,
            )
        }
        load()
    }

    fun toggleStatus(status: String) {
        update { it.copy(statuses = toggleStatus(it.statuses, status)) }
        show()
    }

    fun resetFilters() {
        update { it.copy(statuses = defaultStatuses(it.view)) }
        show()
    }

    /** Past view: loads what is older than its window. */
    fun loadOlder() {
        if (current.loadingOlder || current.view != "past") return
        update { it.copy(loadingOlder = true, olderError = null) }
        launch({ e -> update { it.copy(loadingOlder = false, olderError = e) } }) {
            app.household.get()
            val to = Dates.addDays(app.household.today(), -PAST_WINDOW_DAYS - 1)
            val items =
                fetchAll { cursor ->
                    val page = app.api.appointments.appointmentsList(cursor = cursor, limit = 200, to = to)
                    page.items to page.nextCursor
                }
            older = items
            show()
            update { it.copy(loadingOlder = false) }
        }
    }

    private fun load() {
        val ticket = ++generation
        update { it.copy(loading = loaded.isEmpty(), error = null) }
        launch({ e -> if (ticket == generation) update { it.copy(loading = false, error = e) } }) {
            app.household.get()
            val (from, to) = viewRange(current.view, app.household.today())
            val items =
                fetchAll { cursor ->
                    val page = app.api.appointments.appointmentsList(cursor = cursor, limit = 200, from = from, to = to)
                    page.items to page.nextCursor
                }
            if (ticket != generation) return@launch
            loaded = items
            show()
            update { it.copy(loading = false) }
        }
    }

    private fun show() {
        val zone = app.household.timezone
        val today = app.household.today()
        val state = current
        val all = older?.let { appendById(loaded, it) } ?: loaded
        val sections = sectionsFor(all, state.view, state.statuses, today, zone)
        update {
            it.copy(
                stillOpen = sections.open.map { a -> itemOf(a, zone, today) },
                days =
                    sections.days.map { group ->
                        ApptDayGroup(
                            group.date,
                            appointmentDayHeading(group.date, today),
                            group.items.map { a ->
                                itemOf(a, zone, today, group.date)
                            },
                        )
                    },
                total = sections.count,
                filtered = state.statuses != defaultStatuses(state.view),
                olderLoaded = older != null,
                olderNone = older?.isEmpty() == true,
            )
        }
    }
}

/** One planned appointment in the card of a task, device or contact. */
data class ApptSectionRow(
    val id: String,
    val title: String,
    val whenText: String,
    val location: String,
)

data class AppointmentsSectionState(
    val loading: Boolean = true,
    val error: UiError? = null,
    /** Planned, soonest first. */
    val rows: List<ApptSectionRow> = emptyList(),
    /** What the empty card says: it differs for a task, a device and a contact. */
    val emptyBody: String = "",
)

/**
 * The planned appointments of one owner (give the id of one of [taskId], [assetId], [contactId], the
 * others empty): the card the detail screens of tasks, devices and contacts show. Creating one for the
 * owner is [AppointmentEditStore] with the same ids.
 */
class AppointmentsSectionStore(
    private val app: HauswartApp,
    private val taskId: String,
    private val assetId: String,
    private val contactId: String,
) : Store<AppointmentsSectionState>(
        AppointmentsSectionState(
            emptyBody =
                when {
                    taskId.isNotEmpty() -> tr("appointments_card_empty_task")
                    assetId.isNotEmpty() -> tr("appointments_card_empty_asset")
                    else -> tr("appointments_card_empty_contact")
                },
        ),
    ) {
    init {
        onChange(app, "appointments") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    private fun load() {
        update { it.copy(loading = it.rows.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            app.household.get()
            val items =
                fetchAll { cursor ->
                    val page =
                        app.api.appointments.appointmentsList(
                            cursor = cursor,
                            limit = 200,
                            taskId = taskId.ifEmpty { null },
                            assetId = assetId.ifEmpty { null },
                            contactId = contactId.ifEmpty { null },
                            status = "planned",
                        )
                    page.items to page.nextCursor
                }
            val zone = app.household.timezone
            val today = app.household.today()
            val rows =
                items
                    .sortedWith(compareByStart(zone))
                    .map { ApptSectionRow(it.id, it.title, formatWhen(it, zone, today), it.location.orEmpty()) }
            update { it.copy(loading = false, rows = rows) }
        }
    }
}

/** A task, device or contact an appointment is linked to. [kind] is `task`, `asset` or `contact`. */
data class ApptLinkRef(
    val kind: String,
    val id: String,
    /** "Task", "Device", "Contact". */
    val caption: String,
    val name: String,
)

/** What completing an appointment did to its task (shown on the detail screen until it is left). */
data class ApptCompletion(
    val taskId: String,
    val title: String,
    /** Why: the hint under the title. */
    val hint: String,
    /** The task was completed together with the appointment. */
    val taskDone: Boolean,
)

/** The detail screen's contents, formatted. */
data class ApptDetail(
    val id: String,
    val title: String,
    val status: String,
    val statusLabel: String,
    /** `ok`, `muted` or `due` (planned and over). */
    val statusTone: String,
    /** Planned and over: shown as "still open". */
    val needsClosing: Boolean,
    val whenText: String,
    /** "today", "in 3 days". */
    val relativeText: String,
    val location: String,
    val notes: String,
    val links: List<ApptLinkRef>,
    val createdText: String,
    /** Empty when it was never changed. */
    val updatedText: String,
    val planned: Boolean,
    /** "Also completes the task «X»."; empty when there is no task or the appointment is not planned. */
    val completeHint: String,
    val commentCount: Int,
)

data class AppointmentDetailState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val detail: ApptDetail? = null,
    /** `complete`, `status` or empty. */
    val busy: String = "",
    /** A failed action (complete, cancel, reopen); the appointment is still shown. */
    val actionError: UiError? = null,
    /** A short confirmation of what happened ("Appointment «X» cancelled."); the screen shows it once. */
    val notice: String = "",
    val completion: ApptCompletion? = null,
    val deleting: Boolean = false,
    val deleted: Boolean = false,
)

class AppointmentDetailStore(
    private val app: HauswartApp,
    private val id: String,
) : Store<AppointmentDetailState>(AppointmentDetailState()) {
    private var appointment: Appointment? = null

    init {
        onChange(app, "appointments") { if (!current.deleted) load() }
        load()
    }

    fun refresh() {
        load()
    }

    /** Marks it done and, when it belongs to a task, completes the occurrence it is for. */
    fun complete() {
        if (current.busy.isNotEmpty()) return
        update { it.copy(busy = "complete", actionError = null) }
        launch({ e -> update { it.copy(busy = "", actionError = if (e.code == "conflict") conflict(e) else e) } }) {
            val result = app.api.appointments.appointmentsComplete(id, AppointmentsCompleteRequest())
            appointment = result.appointment
            val task = result.task
            val completion =
                task?.let {
                    if (result.completion != null) {
                        ApptCompletion(
                            it.id,
                            tr("appointment_result_task_done", "title" to it.title),
                            tr("appointment_result_task_done_hint"),
                            true,
                        )
                    } else {
                        val hint = if (it.archivedAt != null) "appointment_result_task_archived" else "appointment_result_task_settled"
                        ApptCompletion(it.id, tr("appointment_result_task_kept", "title" to it.title), tr(hint), false)
                    }
                }
            val notice =
                if (result.replayed) {
                    tr("appointment_already_done_toast")
                } else {
                    tr(
                        "appointment_done_toast",
                        "title" to result.appointment.title,
                    )
                }
            show()
            update { it.copy(busy = "", completion = completion, notice = notice) }
            app.changed("appointments", "tasks")
        }
    }

    fun cancel() {
        setStatus("cancelled", "appointment_cancelled_toast")
    }

    fun reopen() {
        setStatus("planned", "appointment_reopened_toast")
    }

    fun delete() {
        if (current.deleting) return
        update { it.copy(deleting = true, actionError = null) }
        launch({ e -> update { it.copy(deleting = false, actionError = e) } }) {
            val title = appointment?.title.orEmpty()
            app.api.appointments.appointmentsDelete(id)
            update { it.copy(deleting = false, deleted = true, notice = tr("appointment_deleted_toast", "title" to title)) }
            app.changed("appointments")
        }
    }

    fun dismissNotice() {
        update { it.copy(notice = "") }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    private fun conflict(e: UiError): UiError = UiError(tr("appointment_complete_cancelled"), e.code, e.fields, e.detailCode)

    private fun setStatus(
        status: String,
        noticeKey: String,
    ) {
        if (current.busy.isNotEmpty()) return
        update { it.copy(busy = "status", actionError = null) }
        launch({ e -> update { it.copy(busy = "", actionError = e) } }) {
            val saved = app.api.appointments.appointmentsUpdate(id, AppointmentsUpdateRequest(status = status))
            appointment = saved
            show()
            update { it.copy(busy = "", notice = tr(noticeKey, "title" to saved.title)) }
            app.changed("appointments")
        }
    }

    private fun load() {
        update { it.copy(loading = it.detail == null, error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            appointment = app.api.appointments.appointmentsGet(id)
            app.household.get()
            show()
            update { it.copy(loading = false) }
        }
    }

    private fun show() {
        val a = appointment ?: return
        val zone = app.household.timezone
        val today = app.household.today()
        val span = spanOf(a, zone)
        val days =
            when {
                span.last < today -> Dates.diffDays(today, span.last)
                span.first > today -> Dates.diffDays(today, span.first)
                else -> 0
            }
        val open = needsClosing(a, today, zone)
        val planned = a.status == "planned"
        val links =
            listOfNotNull(
                a.taskId?.takeIf { a.taskTitle != null }?.let {
                    ApptLinkRef(
                        "task",
                        it,
                        tr("appointment_task_label"),
                        a.taskTitle.orEmpty(),
                    )
                },
                a.assetId?.takeIf { a.assetName != null }?.let {
                    ApptLinkRef(
                        "asset",
                        it,
                        tr("appointment_asset_label"),
                        a.assetName.orEmpty(),
                    )
                },
                a.contactId?.takeIf { a.contactName != null }?.let {
                    ApptLinkRef(
                        "contact",
                        it,
                        tr("appointment_contact_label"),
                        a.contactName.orEmpty(),
                    )
                },
            )
        val detail =
            ApptDetail(
                id = a.id,
                title = a.title,
                status = a.status,
                statusLabel = if (open) tr("appointment_open_badge") else appointmentStatusLabel(a.status),
                statusTone =
                    when {
                        open -> "due"
                        a.status == "done" -> "ok"
                        a.status == "cancelled" -> "muted"
                        else -> "normal"
                    },
                needsClosing = open,
                whenText = formatWhen(a, zone, today),
                relativeText = relativeDays(days),
                location = a.location.orEmpty(),
                notes = a.notes.orEmpty(),
                links = links,
                createdText = tr("appointment_meta_created", "when" to Dates.dateTime(a.createdAt, zone)),
                updatedText =
                    if (a.updatedAt !=
                        a.createdAt
                    ) {
                        tr("appointment_meta_updated", "when" to Dates.dateTime(a.updatedAt, zone))
                    } else {
                        ""
                    },
                planned = planned,
                completeHint =
                    if (planned &&
                        a.taskTitle != null
                    ) {
                        tr("appointment_complete_task_hint", "task" to a.taskTitle.orEmpty())
                    } else {
                        ""
                    },
                commentCount = a.commentCount.toInt(),
            )
        update { it.copy(detail = detail) }
    }
}

/** A task, device or contact to choose in the form. */
data class ApptChoice(
    val id: String,
    val label: String,
    /** The device or room a task belongs to; the company of a contact. */
    val detail: String,
    /** A task's device, to fill in the form's. */
    val assetId: String,
)

data class AppointmentEditState(
    val isNew: Boolean,
    /** Loading the appointment to edit (or the household of a new one). The form is shown once [initial] is there. */
    val loading: Boolean,
    val loadError: UiError? = null,
    /** The values the form starts with; the screen keeps its own copy while the person types. */
    val initial: AppointmentForm? = null,
    val tasks: List<ApptChoice> = emptyList(),
    val assets: List<ApptChoice> = emptyList(),
    val contacts: List<ApptChoice> = emptyList(),
    /** The choices are still loading. */
    val choicesLoading: Boolean = true,
    val choicesError: UiError? = null,
    val saving: Boolean = false,
    val error: UiError? = null,
    /** Messages per form field (`title`, `startDate`, `startTime`, `endDate`, `endTime`, `location`, `notes`, `taskId`, ...). */
    val fieldErrors: Map<String, String> = emptyMap(),
    /** The id of the saved appointment; the screen closes when it is set. */
    val savedId: String? = null,
)

/**
 * Creates an appointment (`id` empty) or edits one. A new one can start for a task, device or contact
 * (the ids, empty for none; [occurrenceKey] is the occurrence of the task it is for, empty to let the
 * server take the one the task shows).
 */
class AppointmentEditStore(
    private val app: HauswartApp,
    private val id: String,
    private val taskId: String,
    private val assetId: String,
    private val contactId: String,
    private val occurrenceKey: String,
) : Store<AppointmentEditState>(AppointmentEditState(isNew = id.isEmpty(), loading = true)) {
    private var original: Appointment? = null

    init {
        load()
        loadChoices()
    }

    fun retry() {
        load()
        loadChoices()
    }

    /** What the form says in words under its fields. */
    fun preview(form: AppointmentForm): AppointmentPreview = previewOf(form, app.household.timezone, app.household.today())

    /**
     * The form after the person chose a task: it brings its title and its device along when the form
     * has none yet; another task than the prefilled one sends no occurrence (the server takes the one
     * it shows).
     */
    fun taskChosen(
        form: AppointmentForm,
        taskId: String,
    ): AppointmentForm {
        val task = current.tasks.firstOrNull { it.id == taskId }
        return form.copy(
            taskId = taskId,
            occurrenceKey = if (taskId.isNotEmpty() && taskId == this.taskId) pinnableOccurrenceKey(occurrenceKey) else "",
            title = if (task != null && form.title.isBlank()) task.label else form.title,
            assetId = if (task != null && form.assetId.isEmpty() && task.assetId.isNotEmpty()) task.assetId else form.assetId,
        )
    }

    fun save(form: AppointmentForm) {
        if (current.saving) return
        val zone = app.household.timezone
        val base = original
        if (base == null) {
            val built = buildCreateRequest(form, zone)
            val body = built.body
            if (body == null) {
                update { it.copy(fieldErrors = built.errors, error = null) }
                return
            }
            send { createAppointmentRaw(app, body).id }
        } else {
            val built = buildUpdateRequest(form, base, zone)
            val body = built.body
            if (body == null) {
                // Nothing changed (or the form has errors): nothing to send.
                update { it.copy(fieldErrors = built.errors, error = null, savedId = if (built.errors.isEmpty()) base.id else null) }
                return
            }
            send {
                app.api.appointments
                    .appointmentsUpdate(base.id, body)
                    .id
            }
        }
    }

    private fun send(request: suspend () -> String) {
        update { it.copy(saving = true, error = null, fieldErrors = emptyMap()) }
        launch({ e ->
            update { it.copy(saving = false, error = if (e.fields.isEmpty()) e else null, fieldErrors = formFieldErrors(e.fields)) }
        }) {
            val savedId = request()
            app.changed("appointments", "tasks")
            update { it.copy(saving = false, savedId = savedId) }
        }
    }

    private fun load() {
        update { it.copy(loading = true, loadError = null) }
        launch({ e -> update { it.copy(loading = false, loadError = e) } }) {
            app.household.get()
            val zone = app.household.timezone
            val form =
                if (id.isEmpty()) {
                    newForm(app.household.today(), taskId = taskId, assetId = assetId, contactId = contactId, occurrenceKey = occurrenceKey)
                } else {
                    val a = app.api.appointments.appointmentsGet(id)
                    original = a
                    formOf(a, zone)
                }
            update { it.copy(loading = false, initial = form) }
        }
    }

    private fun loadChoices() {
        update { it.copy(choicesLoading = true, choicesError = null) }
        launch({ e -> update { it.copy(choicesLoading = false, choicesError = e) } }) {
            val tasks =
                fetchAll { cursor ->
                    val page = app.api.tasks.tasksList(cursor = cursor, limit = 200)
                    page.items to page.nextCursor
                }
            val assets =
                fetchAll { cursor ->
                    val page = app.api.assets.assetsList(cursor = cursor, limit = 200)
                    page.items to page.nextCursor
                }
            val contacts =
                fetchAll { cursor ->
                    val page = app.api.contacts.contactsList(cursor = cursor, limit = 200)
                    page.items to page.nextCursor
                }
            update {
                it.copy(
                    choicesLoading = false,
                    tasks =
                        tasks
                            .map { t ->
                                ApptChoice(t.id, t.title, t.assetName ?: t.roomName.orEmpty(), t.assetId.orEmpty())
                            }.sortedBy { c ->
                                c.label.lowercase()
                            },
                    assets =
                        assets
                            .map { a ->
                                ApptChoice(a.id, a.name, a.roomName.orEmpty(), "")
                            }.sortedBy { c -> c.label.lowercase() },
                    contacts =
                        contacts
                            .map { c ->
                                ApptChoice(c.id, c.name, c.company.orEmpty(), "")
                            }.sortedBy { c -> c.label.lowercase() },
                )
            }
        }
    }
}
