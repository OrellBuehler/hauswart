package ch.orellbuehler.hauswart.feature.vehicles

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.ApiException
import ch.orellbuehler.hauswart.api.generated.Task
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.core.uiErrorOf
import ch.orellbuehler.hauswart.i18n.tr

private const val MAX_MARK_TRIES = 50

/** What the setup holds, as typed: the chosen templates and their parameters. */
data class VehicleSetupForm(
    val selected: List<String> = emptyList(),
    val params: VehicleSetupParams = VehicleSetupParams(),
)

/** One template of the list. [state] is "" until the run reaches it, then `running`, `created`, `exists` or `failed`. */
data class VehicleSetupRow(
    val id: String,
    val title: String,
    /** The title of the task that does this already; the row is locked then. */
    val existingTitle: String?,
    val state: String = "",
    val error: String? = null,
    val preparationErrors: List<String> = emptyList(),
    val preparations: List<String> = emptyList(),
) {
    /** The template has its task now: found, or made just now. */
    val locked: Boolean get() = existingTitle != null || state == "created" || state == "exists"
}

data class VehicleSetupState(
    val loading: Boolean = true,
    val loadError: UiError? = null,
    val assetName: String = "",
    val unit: String = "km",
    val firstRegistration: String? = null,
    val initial: VehicleSetupForm? = null,
    val rows: List<VehicleSetupRow> = emptyList(),
    val running: Boolean = false,
    /** Messages per parameter (`serviceDistance`, `mfkDate`, ...). */
    val fieldErrors: Map<String, String> = emptyMap(),
    /** A message about the whole form: nothing chosen, a parameter wrong, some tasks failed. */
    val message: String? = null,
    /** Set when tasks were created; the toast text. */
    val notice: String? = null,
    /** Nothing is left to offer. */
    val nothingLeft: Boolean = false,
)

/** Creates the recurring tasks of a vehicle (tires, service, inspection, vignette, tax, ...) from templates. */
class VehicleSetupStore(
    private val app: HauswartApp,
    private val assetId: String,
) : Store<VehicleSetupState>(VehicleSetupState()) {
    private var context: VehicleTemplateContext? = null

    init {
        load()
    }

    fun retry() {
        load()
    }

    private fun rowOf(
        id: String,
        existing: Task?,
        ctx: VehicleTemplateContext,
    ): VehicleSetupRow {
        val built = buildVehicleTemplate(id, ctx, defaultSetupParams(ctx)).template
        return VehicleSetupRow(
            id = id,
            title = templateTitle(id),
            existingTitle = existing?.title,
            preparations =
                built?.preparations?.map { p -> tr("vehicle_setup_prep", "title" to p.title, "days" to (p.leadDays ?: 0)) }.orEmpty(),
        )
    }

    private fun load() {
        update { it.copy(loading = true, loadError = null) }
        launch({ e -> update { it.copy(loading = false, loadError = e) } }) {
            app.household.get()
            val asset = app.api.assets.assetsGet(assetId)
            val vehicle = app.api.vehicles.vehiclesGet(assetId)
            val tasks =
                fetchAll { cursor ->
                    val page = app.api.tasks.tasksList(cursor = cursor, limit = 200, assetId = assetId)
                    page.items to page.nextCursor
                }
            val ctx = VehicleTemplateContext(assetId, vehicle.firstRegistration, app.household.today(), vehicle.odometerUnit)
            context = ctx
            val existing = VEHICLE_TEMPLATE_IDS.associateWith { findExistingVehicleTask(it, tasks, assetId) }
            val params = defaultSetupParams(ctx)
            val rows = VEHICLE_TEMPLATE_IDS.map { rowOf(it, existing[it], ctx) }
            update {
                it.copy(
                    loading = false,
                    assetName = asset.name,
                    unit = vehicle.odometerUnit,
                    firstRegistration = vehicle.firstRegistration,
                    rows = rows,
                    nothingLeft = rows.all { r -> r.locked },
                    initial =
                        VehicleSetupForm(
                            selected =
                                VEHICLE_TEMPLATES_DEFAULT.filter { id ->
                                    existing[id] == null &&
                                        (id != "mfk" || params.mfkDate.isNotEmpty())
                                },
                            params = params,
                        ),
                )
            }
        }
    }

    /** The trigger of a template in words with the parameters as they stand now; null while they are not valid. */
    fun summary(
        id: String,
        form: VehicleSetupForm,
    ): String? {
        val ctx = context ?: return null
        return buildVehicleTemplate(id, ctx, form.params).template?.let(::templateSummary)
    }

    fun withSelected(
        form: VehicleSetupForm,
        id: String,
        on: Boolean,
    ): VehicleSetupForm = form.copy(selected = if (on) (form.selected - id) + id else form.selected - id)

    fun dismissNotice() {
        update { it.copy(notice = null) }
    }

    /** Creates the chosen tasks one after the other, then each one's preparations. */
    fun submit(form: VehicleSetupForm) {
        val ctx = context ?: return
        if (current.running) return
        val offered = current.rows.filter { !it.locked }.map { it.id }
        val chosen = offered.filter { it in form.selected }
        if (chosen.isEmpty()) {
            update { it.copy(message = tr("vehicle_setup_none_selected"), fieldErrors = emptyMap()) }
            return
        }
        val errors = mutableMapOf<String, String>()
        val templates = mutableListOf<VehicleTemplate>()
        for (id in chosen) {
            val built = buildVehicleTemplate(id, ctx, form.params)
            errors += built.errors
            built.template?.let { templates += it }
        }
        if (errors.isNotEmpty()) {
            update { it.copy(message = tr("form_check_fields"), fieldErrors = errors) }
            return
        }
        update { it.copy(running = true, message = null, fieldErrors = emptyMap()) }
        launch({ e -> update { it.copy(running = false, message = e.message) } }) {
            var created = 0
            var failed = false
            var changed = false
            for (template in templates) {
                setRow(template.id) { it.copy(state = "running", error = null, preparationErrors = emptyList()) }
                try {
                    val made = createMarked(template)
                    if (made.existingTitle == null) {
                        val problems = mutableListOf<String>()
                        for ((index, prep) in template.preparations.withIndex()) {
                            try {
                                app.api.tasks.preparationsCreate(made.id, prep.copy(sortOrder = index.toLong()))
                            } catch (e: ApiException) {
                                problems += tr("vehicle_setup_prep_failed", "title" to prep.title, "error" to uiErrorOf(e).message)
                            }
                        }
                        created++
                        setRow(template.id) { it.copy(state = "created", preparationErrors = problems) }
                    } else {
                        setRow(template.id) { it.copy(state = "exists", existingTitle = made.existingTitle) }
                    }
                    changed = true
                } catch (e: ApiException) {
                    failed = true
                    setRow(template.id) { it.copy(state = "failed", error = uiErrorOf(e).message) }
                }
            }
            update {
                it.copy(
                    running = false,
                    message = if (failed) tr("vehicle_setup_partial_error") else null,
                    notice = if (created > 0) tr("vehicle_setup_done_toast", "count" to created) else it.notice,
                    nothingLeft = it.rows.all { r -> r.locked },
                )
            }
            if (changed) app.changed("tasks", "vehicles")
        }
    }

    private fun setRow(
        id: String,
        change: (VehicleSetupRow) -> VehicleSetupRow,
    ) {
        update { s -> s.copy(rows = s.rows.map { if (it.id == id) change(it) else it }) }
    }

    private data class Made(
        val id: String,
        val existingTitle: String?,
    )

    /**
     * Creates the task of a template. The server keeps the mark unique, so a refusal (409) says some task carries it already:
     * one that is archived, finished or moved away means the vehicle had the template before and the next number is tried;
     * one that is still there means nothing is made and that task is reported; one that is gone by now is tried again.
     */
    private suspend fun createMarked(template: VehicleTemplate): Made {
        var n = 1
        var tries = 0
        while (true) {
            tries++
            val mark = templateMark(assetId, template.id, n)
            val body =
                if (n ==
                    1
                ) {
                    template.task
                } else {
                    template.task.copy(externalSource = mark.externalSource, externalRef = mark.externalRef)
                }
            try {
                return Made(
                    app.api.tasks
                        .tasksCreate(body)
                        .id,
                    null,
                )
            } catch (e: ApiException) {
                if (e.code != "conflict" || tries >= MAX_MARK_TRIES) throw e
                val holder =
                    app.api.tasks
                        .tasksList(limit = 1, includeArchived = true, externalSource = mark.externalSource, externalRef = mark.externalRef)
                        .items
                        .firstOrNull()
                if (holder != null && isLiveTaskOf(holder, assetId)) return Made(holder.id, holder.title)
                if (holder != null) n++
            }
        }
    }
}
