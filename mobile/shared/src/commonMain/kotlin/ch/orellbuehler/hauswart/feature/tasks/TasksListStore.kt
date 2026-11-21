package ch.orellbuehler.hauswart.feature.tasks

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.Task
import ch.orellbuehler.hauswart.api.generated.TaskState
import ch.orellbuehler.hauswart.api.generated.TasksCompleteRequest
import ch.orellbuehler.hauswart.api.generated.TasksSnoozeRequest
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.feature.dashboard.TONE_NORMAL
import ch.orellbuehler.hauswart.feature.dashboard.taskTone
import ch.orellbuehler.hauswart.i18n.tr

const val VIEW_STATUS = "status"
const val VIEW_DUE = "due"
const val VIEW_TITLE = "title"

private val STATUS_ORDER = listOf("overdue", "due", "open", "ok", "unknown", "snoozed")

/** What a screen says after a write: [message] with an optional way back. */
data class TaskNotice(
    val message: String,
    val undo: UndoToken?,
)

/** How to take back a completion (kind `completion`) or a snooze (kind `snooze`, [previous] is the date before). */
data class UndoToken(
    val kind: String,
    val completionId: String,
    val taskId: String,
    val previous: String?,
)

internal suspend fun runUndo(
    app: HauswartApp,
    token: UndoToken,
) {
    if (token.kind == "completion") {
        app.api.tasks.completionsUndo(token.completionId)
    } else {
        app.api.tasks.tasksSnooze(token.taskId, TasksSnoozeRequest(until = token.previous))
    }
    app.changed("tasks", "parts", "assets")
}

/**
 * Completes a task without a dialog (not for one that asks for an odometer reading). [shown] gets the notice with its
 * way back before the other screens are told.
 */
internal suspend fun completeWithoutDialog(
    app: HauswartApp,
    taskId: String,
    title: String,
    shown: (TaskNotice) -> Unit,
) {
    val result = app.api.tasks.tasksComplete(taskId, TasksCompleteRequest(idempotencyKey = newIdempotencyKey()))
    shown(TaskNotice(tr("toast_completed", "title" to title), UndoToken("completion", result.completion.id, taskId, null)))
    app.changed("tasks", "parts")
}

data class TaskGroup(
    val key: String,
    val title: String,
    val tone: String,
    val rows: List<TaskRow>,
)

data class TasksListState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val query: String = "",
    val status: String = "",
    val category: String = "",
    val mine: Boolean = false,
    val roomId: String = "",
    val assetId: String = "",
    val archived: Boolean = false,
    val view: String = VIEW_STATUS,
    val groups: List<TaskGroup> = emptyList(),
    val total: Int = 0,
    val shown: Int = 0,
    val rooms: List<ChoiceOption> = emptyList(),
    val assets: List<ChoiceOption> = emptyList(),
    val today: String = "",
    /** The task a quick action is running for. */
    val busyId: String? = null,
    val notice: TaskNotice? = null,
    val actionError: UiError? = null,
) {
    /** How many of the filters in the filter panel are set. */
    val filterCount: Int
        get() = listOf(status, category, roomId, assetId).count { it.isNotEmpty() } + (if (mine) 1 else 0) + (if (archived) 1 else 0)

    val filtered: Boolean get() = filterCount > 0 || query.isNotBlank()
}

fun taskStatusOptions(): List<ChoiceOption> =
    listOf(ChoiceOption("", tr("tasks_filter_all"))) +
        TaskState.STATUS_VALUES.map {
            ChoiceOption(
                it,
                ch.orellbuehler.hauswart.feature.dashboard
                    .taskStatusLabel(it),
            )
        }

fun taskCategoryFilterOptions(): List<ChoiceOption> = listOf(ChoiceOption("", tr("tasks_filter_all"))) + categoryOptions()

fun taskViewOptions(): List<ChoiceOption> = listOf(VIEW_STATUS, VIEW_DUE, VIEW_TITLE).map { ChoiceOption(it, tr("tasks_view_$it")) }

class TasksListStore(
    private val app: HauswartApp,
) : Store<TasksListState>(TasksListState()) {
    private var all: List<Task> = emptyList()
    private var people: Map<String, String> = emptyMap()
    private var placesLoaded = false

    init {
        onChange(app, "tasks") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun search(query: String) {
        update { it.copy(query = query) }
        show()
    }

    fun setStatus(value: String) = filter { it.copy(status = value) }

    fun setCategory(value: String) = filter { it.copy(category = value) }

    fun setMine(value: Boolean) = filter { it.copy(mine = value) }

    fun setRoom(value: String) = filter { it.copy(roomId = value) }

    fun setAsset(value: String) = filter { it.copy(assetId = value) }

    fun setView(value: String) = filter { it.copy(view = value) }

    fun setArchived(value: Boolean) {
        update { it.copy(archived = value) }
        load()
    }

    fun resetFilters() {
        update { it.copy(query = "", status = "", category = "", mine = false, roomId = "", assetId = "") }
        if (current.archived) setArchived(false) else show()
    }

    private fun filter(transform: (TasksListState) -> TasksListState) {
        update(transform)
        show()
    }

    private fun load() {
        update { it.copy(loading = all.isEmpty() && it.total == 0, error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            val household = app.household.get()
            people = household.members.associate { it.id to it.name }
            val includeArchived = current.archived
            all =
                fetchAll { cursor ->
                    val page = app.api.tasks.tasksList(cursor = cursor, limit = 200, includeArchived = if (includeArchived) true else null)
                    page.items to page.nextCursor
                }
            if (!placesLoaded) {
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
                placesLoaded = true
                update {
                    it.copy(
                        rooms = listOf(ChoiceOption("", tr("tasks_filter_all"))) + rooms.map { r -> ChoiceOption(r.id, r.name) },
                        assets = listOf(ChoiceOption("", tr("tasks_filter_all"))) + assets.map { a -> ChoiceOption(a.id, a.name) },
                    )
                }
            }
            update { it.copy(today = app.household.today()) }
            show()
            update { it.copy(loading = false) }
        }
    }

    private fun show() {
        val s = current
        val today = app.household.today()
        val me = app.session.user?.id
        val needle = s.query.trim().lowercase()
        val rows =
            all
                .filter { t ->
                    (s.status.isEmpty() || (t.state?.status ?: "unknown") == s.status) &&
                        (s.category.isEmpty() || t.category == s.category) &&
                        (!s.mine || (me != null && t.state?.currentAssigneeUserId == me)) &&
                        (s.roomId.isEmpty() || t.roomId == s.roomId) &&
                        (s.assetId.isEmpty() || t.assetId == s.assetId) &&
                        (needle.isEmpty() || t.title.lowercase().contains(needle) || t.descriptionMd.lowercase().contains(needle))
                }.map { taskRowOf(it, today, people, app.household.timezone) }
        val groups =
            when (s.view) {
                VIEW_STATUS ->
                    STATUS_ORDER.mapNotNull { status ->
                        val members = rows.filter { it.status == status }
                        if (members.isEmpty()) {
                            null
                        } else {
                            TaskGroup(
                                status,
                                ch.orellbuehler.hauswart.feature.dashboard
                                    .taskStatusLabel(status),
                                taskTone(status),
                                members,
                            )
                        }
                    }
                VIEW_DUE -> listOf(TaskGroup("all", "", TONE_NORMAL, rows.sortedWith(compareBy({ it.sortDate }, { it.title.lowercase() }))))
                else -> listOf(TaskGroup("all", "", TONE_NORMAL, rows.sortedBy { it.title.lowercase() }))
            }.filter { it.rows.isNotEmpty() }
        update { it.copy(groups = groups, total = all.size, shown = rows.size, today = today) }
    }

    /** Completes the task without a dialog (not for a task that asks for an odometer reading). */
    fun complete(taskId: String) {
        val task = all.firstOrNull { it.id == taskId } ?: return
        if (current.busyId != null) return
        update { it.copy(busyId = taskId, actionError = null) }
        launch({ e -> update { it.copy(busyId = null, actionError = e) } }) {
            completeWithoutDialog(app, taskId, task.title) { notice -> update { it.copy(busyId = null, notice = notice) } }
        }
    }

    fun unsnooze(taskId: String) {
        val task = all.firstOrNull { it.id == taskId } ?: return
        if (current.busyId != null) return
        update { it.copy(busyId = taskId, actionError = null) }
        launch({ e -> update { it.copy(busyId = null, actionError = e) } }) {
            app.api.tasks.tasksSnooze(taskId, TasksSnoozeRequest(until = null))
            update {
                it.copy(
                    busyId = null,
                    notice = TaskNotice(tr("toast_unsnoozed", "title" to task.title), UndoToken("snooze", "", taskId, task.snoozedUntil)),
                )
            }
            app.changed("tasks")
        }
    }

    /** Shows what a dialog did (the dialog's store reports it, the screen hands it on). */
    fun announce(notice: TaskNotice) {
        update { it.copy(notice = notice) }
    }

    fun undo(token: UndoToken) {
        update { it.copy(notice = null) }
        launch({ e -> update { it.copy(actionError = e) } }) {
            runUndo(app, token)
            update { it.copy(notice = TaskNotice(tr("toast_undone"), null)) }
        }
    }

    fun consumeNotice() {
        update { it.copy(notice = null) }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }
}
