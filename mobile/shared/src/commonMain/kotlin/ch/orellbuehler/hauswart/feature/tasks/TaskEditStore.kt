package ch.orellbuehler.hauswart.feature.tasks

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.Patch
import ch.orellbuehler.hauswart.api.generated.PreparationsCreateRequest
import ch.orellbuehler.hauswart.api.generated.PreparationsUpdateRequest
import ch.orellbuehler.hauswart.api.generated.TaskDetail
import ch.orellbuehler.hauswart.api.generated.TasksCreateRequest
import ch.orellbuehler.hauswart.api.generated.TasksPreviewRequest
import ch.orellbuehler.hauswart.api.generated.TasksUpdateRequest
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.core.formatNumber
import ch.orellbuehler.hauswart.feature.dashboard.TONE_MUTED
import ch.orellbuehler.hauswart.feature.dashboard.taskStatusLabel
import ch.orellbuehler.hauswart.feature.dashboard.taskTone
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay

const val TASK_TITLE_MAX = 200

/** An asset to pick for the task; a vehicle can be the source of an odometer counter. */
data class AssetOption(
    val id: String,
    val label: String,
    val isVehicle: Boolean,
    val odometerUnit: String,
)

/** What the live preview of the rhythm says. */
data class PreviewState(
    val loading: Boolean = false,
    /** The rhythm is not complete yet, so there is nothing to preview. */
    val incomplete: Boolean = true,
    val summary: String = "",
    val statusLabel: String = "",
    val tone: String = TONE_MUTED,
    val dueText: String = "",
    val progress: ProgressInfo? = null,
    val reasons: List<String> = emptyList(),
    val error: String? = null,
)

data class TaskEditState(
    val isNew: Boolean,
    val loading: Boolean = true,
    val loadError: UiError? = null,
    val initial: TaskForm? = null,
    val rooms: List<ChoiceOption> = emptyList(),
    val assets: List<AssetOption> = emptyList(),
    val people: List<ChoiceOption> = emptyList(),
    val today: String = "",
    val dueSoonDefault: Long = 7,
    /** False for a rhythm this build cannot edit (a bill's, a newer server's): it is shown and left as it is. */
    val triggerEditable: Boolean = true,
    val triggerSummary: String = "",
    /** The task comes from a bill in the finance app: its title and date are overwritten at the next sync. */
    val billManaged: Boolean = false,
    val saving: Boolean = false,
    val error: UiError? = null,
    /** Messages per field: `title`, `effortMinutes`, `assigneeUserId`, `rotationOrder`, `graceDays`, `dueSoonDays`, `trigger.<field>`, `prep.<key>.title`. */
    val fieldErrors: Map<String, String> = emptyMap(),
    val savedId: String? = null,
    val preview: PreviewState = PreviewState(),
    val preparationsFailed: Boolean = false,
) {
    fun triggerError(field: String): String? = fieldErrors["trigger.$field"] ?: if (field.isEmpty()) fieldErrors["trigger"] else null

    fun vehicleOf(assetId: String): AssetOption? = assets.firstOrNull { it.id == assetId && it.isVehicle }
}

/** Creates a task ([id] null, optionally for [assetId]) or edits one. */
class TaskEditStore(
    private val app: HauswartApp,
    private val id: String?,
    private val assetId: String?,
) : Store<TaskEditState>(TaskEditState(isNew = id == null)) {
    private var original: TaskDetail? = null
    private var previewJob: Job? = null

    /** The pause after the last change before the preview is asked for; tests set it to zero. */
    internal var previewDelayMs: Long = 400

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
            val today = app.household.today()
            val settings =
                app.api.household
                    .householdGet()
                    .settings
            val rooms =
                fetchAll { cursor ->
                    app.api.rooms
                        .roomsList(cursor = cursor, limit = 200)
                        .let { it.items to it.nextCursor }
                }
            val assets =
                fetchAll { cursor ->
                    app.api.assets
                        .assetsList(cursor = cursor, limit = 200)
                        .let { it.items to it.nextCursor }
                }
            val t = id?.let { app.api.tasks.tasksGet(it) }
            original = t
            val editable = t?.let { triggerFormOf(it.trigger) }
            val form =
                if (t == null) {
                    TaskForm(assetId = assetId.orEmpty(), trigger = defaultTriggerForm(TRIGGER_INTERVAL, today))
                } else {
                    TaskForm(
                        title = t.title,
                        description = t.descriptionMd,
                        category = t.category,
                        priority = t.priority,
                        effort = t.effortMinutes?.toString().orEmpty(),
                        assetId = t.assetId.orEmpty(),
                        roomId = t.roomId.orEmpty(),
                        trigger = editable ?: defaultTriggerForm(TRIGGER_INTERVAL, today),
                        assignMode = t.assignMode,
                        assigneeUserId = t.assigneeUserId.orEmpty(),
                        rotationOrder = t.rotationOrder,
                        rotationStrategy = t.rotationStrategy,
                        notifyMode = t.notifyMode,
                        graceDays = t.graceDays.toString(),
                        dueSoonDays = t.dueSoonDays?.toString().orEmpty(),
                        preparations =
                            t.preparations.mapIndexed { i, p ->
                                PreparationForm("p$i", p.id, p.title, p.kind, p.leadDays?.toString().orEmpty())
                            },
                    )
                }
            update {
                it.copy(
                    loading = false,
                    initial = form,
                    today = today,
                    dueSoonDefault = settings.dueSoonDays,
                    rooms = listOf(ChoiceOption("", tr("task_no_room"))) + rooms.map { r -> ChoiceOption(r.id, r.name) },
                    assets =
                        assets.map { a ->
                            AssetOption(
                                a.id,
                                if (a.roomName != null) "${a.name} (${a.roomName})" else a.name,
                                a.kind == "vehicle",
                                a.vehicle?.odometer?.unit ?: "km",
                            )
                        },
                    people = household.members.map { m -> ChoiceOption(m.id, m.name) },
                    triggerEditable = t == null || editable != null,
                    triggerSummary = t?.let { describeTrigger(it.trigger) }.orEmpty(),
                    billManaged = t?.externalSource == FINANCE_BILL_SOURCE,
                )
            }
            preview(form)
        }
    }

    /** Asks the server what the rhythm of [form] would give, a moment after the last change. */
    fun preview(form: TaskForm) {
        previewJob?.cancel()
        if (!current.triggerEditable) {
            update { it.copy(preview = PreviewState(incomplete = true)) }
            return
        }
        val built = form.trigger.toTrigger()
        val trigger = built.trigger
        val grace = parseWhole(form.graceDays)?.takeIf { it in 0..365 }
        val soon = parseWhole(form.dueSoonDays)?.takeIf { it in 0..365 }
        if (trigger == null) {
            update { it.copy(preview = PreviewState(incomplete = true)) }
            return
        }
        val summary = describeTrigger(trigger)
        update { it.copy(preview = PreviewState(loading = true, incomplete = false, summary = summary)) }
        previewJob =
            launch({ e -> update { it.copy(preview = PreviewState(incomplete = false, summary = summary, error = e.message)) } }) {
                delay(previewDelayMs)
                val result = app.api.tasks.tasksPreview(TasksPreviewRequest(trigger = trigger, graceDays = grace, dueSoonDays = soon))
                val estimated = result.dueKind == "estimated" || result.dueDate == null
                val date =
                    if (result.dueKind == "estimated" &&
                        result.estimate != null
                    ) {
                        result.estimate.date
                    } else {
                        result.dueDate ?: result.estimate?.date
                    }
                val odometer = odometerAssetOf(trigger) != null
                val progress = result.progress
                update {
                    it.copy(
                        preview =
                            PreviewState(
                                incomplete = false,
                                summary = summary,
                                statusLabel = taskStatusLabel(result.status),
                                tone = taskTone(result.status),
                                dueText =
                                    date
                                        ?.let { d ->
                                            ch.orellbuehler.hauswart.core
                                                .dueText(d, app.household.today(), estimated)
                                        }.orEmpty(),
                                progress =
                                    progress?.let { p ->
                                        ProgressInfo(
                                            formatNumber(p.current) + "/" + formatNumber(p.target) + (p.unit?.let { u -> " $u" } ?: ""),
                                            if (p.target > 0) (minOf(p.current, p.target) / p.target).toFloat() else 0f,
                                            p.current >= p.target,
                                        )
                                    },
                                reasons = result.reasons.filter { r -> !(r == "signal_missing" && odometer) }.map { r -> reasonLabel(r) },
                            ),
                    )
                }
            }
    }

    private fun validate(form: TaskForm): Pair<TaskForm, Map<String, String>> {
        val errors = mutableMapOf<String, String>()
        if (form.title.isBlank()) {
            errors["title"] = tr("field_required")
        } else if (form.title.trim().length > TASK_TITLE_MAX) {
            errors["title"] = tr("field_too_long", "max" to TASK_TITLE_MAX)
        }
        if (form.description.length > 50_000) errors["descriptionMd"] = tr("field_too_long", "max" to 50_000)
        if (form.effort.isNotBlank()) {
            val n = parseWhole(form.effort)
            if (n ==
                null
            ) {
                errors["effortMinutes"] = tr("field_number")
            } else if (n <
                1
            ) {
                errors["effortMinutes"] = tr("field_min", "min" to 1)
            } else if (n >
                10_080
            ) {
                errors["effortMinutes"] = tr("field_max", "max" to 10_080)
            }
        }
        if (form.assignMode == "fixed" && form.assigneeUserId.isEmpty()) errors["assigneeUserId"] = tr("field_required")
        if (form.assignMode == "rotate" && form.rotationOrder.isEmpty()) errors["rotationOrder"] = tr("field_choose_one")
        val grace = if (form.graceDays.isBlank()) 0L else parseWhole(form.graceDays)
        if (grace ==
            null
        ) {
            errors["graceDays"] = tr("field_number")
        } else if (grace !in 0..365) {
            errors["graceDays"] = tr("field_max", "max" to 365)
        }
        if (form.dueSoonDays.isNotBlank()) {
            val n = parseWhole(form.dueSoonDays)
            if (n ==
                null
            ) {
                errors["dueSoonDays"] = tr("field_number")
            } else if (n !in
                0..365
            ) {
                errors["dueSoonDays"] = tr("field_max", "max" to 365)
            }
        }
        form.preparations.forEach { p ->
            if (p.title.isBlank()) errors["prep.${p.key}.title"] = tr("field_required")
            if (p.leadDays.isNotBlank()) {
                val n = parseWhole(p.leadDays)
                if (n == null || n !in 0..3650) errors["prep.${p.key}.leadDays"] = tr("field_min", "min" to 0)
            }
        }
        if (current.triggerEditable) {
            form.trigger
                .toTrigger()
                .errors
                .forEach { (k, v) -> errors["trigger.$k"] = v }
        }
        return form to errors
    }

    fun save(form: TaskForm) {
        if (current.saving) return
        val (_, errors) = validate(form)
        if (errors.isNotEmpty()) {
            update { it.copy(fieldErrors = errors, error = UiError(tr("task_form_fix_errors"), "invalid_request")) }
            return
        }
        val trigger = if (current.triggerEditable) form.trigger.toTrigger().trigger else null
        update { it.copy(saving = true, error = null, fieldErrors = emptyMap()) }
        launch({ e -> update { it.copy(saving = false, error = e, fieldErrors = e.fields.mapKeys { (k, _) -> k }) } }) {
            val effort = parseWhole(form.effort)
            val grace = if (form.graceDays.isBlank()) 0L else parseWhole(form.graceDays) ?: 0L
            val soon = parseWhole(form.dueSoonDays)
            val assignee = if (form.assignMode == "fixed") form.assigneeUserId.ifEmpty { null } else null
            val rotation = if (form.assignMode == "rotate") form.rotationOrder else emptyList()
            val saved =
                if (id == null) {
                    app.api.tasks.tasksCreate(
                        TasksCreateRequest(
                            title = form.title.trim(),
                            descriptionMd = form.description,
                            category = form.category,
                            priority = form.priority,
                            effortMinutes = effort,
                            assetId = form.assetId.ifEmpty { null },
                            roomId = form.roomId.ifEmpty { null },
                            trigger = checkNotNull(trigger),
                            assignMode = form.assignMode,
                            assigneeUserId = assignee,
                            rotationOrder = rotation,
                            rotationStrategy = form.rotationStrategy,
                            notifyMode = form.notifyMode,
                            graceDays = grace,
                            dueSoonDays = soon,
                        ),
                    )
                } else {
                    app.api.tasks.tasksUpdate(
                        id,
                        TasksUpdateRequest(
                            title = form.title.trim(),
                            descriptionMd = form.description,
                            category = form.category,
                            priority = form.priority,
                            effortMinutes = Patch.of(effort),
                            assetId = Patch.of(form.assetId.ifEmpty { null }),
                            roomId = Patch.of(form.roomId.ifEmpty { null }),
                            trigger = trigger,
                            assignMode = form.assignMode,
                            assigneeUserId = Patch.of(assignee),
                            rotationOrder = rotation,
                            rotationStrategy = form.rotationStrategy,
                            notifyMode = form.notifyMode,
                            graceDays = grace,
                            dueSoonDays = Patch.of(soon),
                        ),
                    )
                }
            val prepsOk = savePreparations(saved.id, form)
            app.changed("tasks")
            update { it.copy(saving = false, savedId = saved.id, preparationsFailed = !prepsOk) }
        }
    }

    private suspend fun savePreparations(
        taskId: String,
        form: TaskForm,
    ): Boolean {
        var failed = false

        suspend fun run(call: suspend () -> Unit) {
            try {
                call()
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                failed = true
            }
        }
        val before = original?.preparations.orEmpty().associateBy { it.id }
        before.keys.filter { existing -> form.preparations.none { it.id == existing } }.forEach { gone ->
            run { app.api.tasks.preparationsDelete(taskId, gone) }
        }
        form.preparations.forEachIndexed { index, prep ->
            val lead = parseWhole(prep.leadDays)
            val old = before[prep.id]
            if (old != null) {
                if (old.title != prep.title.trim() || old.kind != prep.kind || old.leadDays != lead) {
                    run {
                        app.api.tasks.preparationsUpdate(
                            taskId,
                            old.id,
                            PreparationsUpdateRequest(title = prep.title.trim(), kind = prep.kind, leadDays = Patch.of(lead)),
                        )
                    }
                }
            } else {
                run {
                    app.api.tasks.preparationsCreate(
                        taskId,
                        PreparationsCreateRequest(title = prep.title.trim(), kind = prep.kind, leadDays = lead, sortOrder = index.toLong()),
                    )
                }
            }
        }
        return !failed
    }
}
