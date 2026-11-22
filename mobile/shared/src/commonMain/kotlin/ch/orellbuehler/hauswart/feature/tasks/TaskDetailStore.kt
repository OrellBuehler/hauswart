package ch.orellbuehler.hauswart.feature.tasks

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.Completion
import ch.orellbuehler.hauswart.api.generated.PreparationsCompleteRequest
import ch.orellbuehler.hauswart.api.generated.TaskDetail
import ch.orellbuehler.hauswart.api.generated.TaskPart
import ch.orellbuehler.hauswart.api.generated.TaskPartsLinkRequest
import ch.orellbuehler.hauswart.api.generated.TaskPartsUpdateRequest
import ch.orellbuehler.hauswart.api.generated.TasksCompleteRequest
import ch.orellbuehler.hauswart.api.generated.TasksSnoozeRequest
import ch.orellbuehler.hauswart.api.generated.TasksUpdateRequest
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.i18n.tr
import kotlin.time.Clock
import kotlin.time.ExperimentalTime

private const val HISTORY_PAGE = 20L

data class TaskDetailState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val view: TaskDetailView? = null,
    val today: String = "",
    val moreHistory: Boolean = false,
    val loadingMore: Boolean = false,
    /** A write is running (archive, delete, a preparation, a quick completion). */
    val busy: Boolean = false,
    val actionError: UiError? = null,
    val notice: TaskNotice? = null,
    val deleted: Boolean = false,
    /** The spare parts the picker offers (those not linked yet); filled by [TaskDetailStore.loadPartChoices]. */
    val partChoices: List<ChoiceOption> = emptyList(),
    val partChoicesLoading: Boolean = false,
    val partChoicesError: UiError? = null,
    val partSaving: Boolean = false,
    val partError: String? = null,
    /** True once a part was linked or its quantity changed; the screen closes its dialog and calls [TaskDetailStore.partDialogClosed]. */
    val partSaved: Boolean = false,
)

@OptIn(ExperimentalTime::class)
class TaskDetailStore(
    private val app: HauswartApp,
    private val id: String,
) : Store<TaskDetailState>(TaskDetailState()) {
    private var task: TaskDetail? = null
    private var history: List<Completion> = emptyList()
    private var historyCursor: String? = null
    private var parts: List<TaskPart> = emptyList()
    private var people: Map<String, String> = emptyMap()

    init {
        onChange(app, "tasks", "parts") { if (!current.deleted) load() }
        load()
    }

    fun refresh() {
        load()
    }

    private fun load() {
        update { it.copy(loading = it.view == null, error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            val household = app.household.get()
            people = household.members.associate { it.id to it.name }
            task = app.api.tasks.tasksGet(id)
            val page = app.api.tasks.completionsList(taskId = id, limit = HISTORY_PAGE)
            history = page.items
            historyCursor = page.nextCursor
            parts =
                fetchAll { cursor ->
                    app.api.parts
                        .taskPartsList(id, cursor = cursor, limit = 200)
                        .let { it.items to it.nextCursor }
                }
            rebuild()
            update { it.copy(loading = false) }
        }
    }

    private fun rebuild() {
        val t = task ?: return
        val today = app.household.today()
        val view = taskDetailView(t, history, parts, people, today, app.household.timezone, Clock.System.now().toEpochMilliseconds())
        update { it.copy(view = view, today = today, moreHistory = historyCursor != null) }
    }

    fun loadMoreHistory() {
        val cursor = historyCursor ?: return
        if (current.loadingMore) return
        update { it.copy(loadingMore = true) }
        launch({ e -> update { it.copy(loadingMore = false, actionError = e) } }) {
            val page = app.api.tasks.completionsList(taskId = id, limit = HISTORY_PAGE, cursor = cursor)
            history = history + page.items
            historyCursor = page.nextCursor
            rebuild()
            update { it.copy(loadingMore = false) }
        }
    }

    private fun write(block: suspend () -> Unit) {
        if (current.busy) return
        update { it.copy(busy = true, actionError = null) }
        launch({ e -> update { it.copy(busy = false, actionError = e) } }) {
            block()
            update { it.copy(busy = false) }
        }
    }

    /** Completes the task without a dialog (not for a task that asks for an odometer reading). */
    fun complete() {
        val title = task?.title ?: return
        write {
            val result = app.api.tasks.tasksComplete(id, TasksCompleteRequest(idempotencyKey = newIdempotencyKey()))
            update {
                it.copy(
                    notice = TaskNotice(tr("toast_completed", "title" to title), UndoToken("completion", result.completion.id, id, null)),
                )
            }
            app.changed("tasks", "parts")
        }
    }

    fun unsnooze() {
        val t = task ?: return
        write {
            app.api.tasks.tasksSnooze(id, TasksSnoozeRequest(until = null))
            update {
                it.copy(notice = TaskNotice(tr("toast_unsnoozed", "title" to t.title), UndoToken("snooze", "", id, t.snoozedUntil)))
            }
            app.changed("tasks")
        }
    }

    fun toggleArchive() {
        val t = task ?: return
        val archive = t.archivedAt == null
        write {
            app.api.tasks.tasksUpdate(id, TasksUpdateRequest(archived = archive))
            update {
                it.copy(notice = TaskNotice(tr(if (archive) "task_archived_toast" else "task_restored_toast", "title" to t.title), null))
            }
            app.changed("tasks")
        }
    }

    fun delete() {
        write {
            app.api.tasks.tasksDelete(id)
            update { it.copy(deleted = true) }
            app.changed("tasks", "parts")
        }
    }

    fun completePreparation(prepId: String) {
        val title = task?.preparations?.firstOrNull { it.id == prepId }?.title ?: return
        write {
            app.api.tasks.preparationsComplete(id, prepId, PreparationsCompleteRequest())
            update { it.copy(notice = TaskNotice(tr("toast_prep_done", "title" to title), null)) }
            app.changed("tasks")
        }
    }

    fun undoCompletion(completionId: String) = undo(UndoToken("completion", completionId, id, null))

    fun undo(token: UndoToken) {
        update { it.copy(notice = null) }
        write {
            runUndo(app, token)
            update { it.copy(notice = TaskNotice(tr("toast_undone"), null)) }
        }
    }

    /** Shows what a dialog did (the dialog's store reports it, the screen hands it on). */
    fun announce(notice: TaskNotice) {
        update { it.copy(notice = notice) }
    }

    fun consumeNotice() {
        update { it.copy(notice = null) }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    fun loadPartChoices() {
        update { it.copy(partChoicesLoading = true, partChoicesError = null, partError = null) }
        launch({ e -> update { it.copy(partChoicesLoading = false, partChoicesError = e) } }) {
            val linked = parts.map { it.partId }.toSet()
            val all =
                fetchAll { cursor ->
                    app.api.parts
                        .partsList(cursor = cursor, limit = 200)
                        .let { it.items to it.nextCursor }
                }
            val choices =
                all.filter { it.id !in linked }.map { p ->
                    ChoiceOption(
                        p.id,
                        listOfNotNull(
                            p.name,
                            listOfNotNull(p.partNumber, p.supplier).joinToString(" · ").ifEmpty { null },
                        ).joinToString("  "),
                    )
                }
            update { it.copy(partChoicesLoading = false, partChoices = choices) }
        }
    }

    private fun qtyOf(text: String): Long? {
        val n = parseWhole(text)
        return if (n == null || n < 1 || n > 999) null else n
    }

    /** Links a spare part; [qty] is how many pieces each completion uses. */
    fun linkPart(
        partId: String,
        qty: String,
    ) {
        if (partId.isEmpty()) {
            update { it.copy(partError = tr("part_link_choose")) }
            return
        }
        val n = qtyOf(qty) ?: return update { it.copy(partError = tr("field_min", "min" to 1)) }
        savePart(partId) { app.api.parts.taskPartsLink(id, TaskPartsLinkRequest(partId = partId, qty = n)) }
    }

    fun setPartQty(
        partId: String,
        qty: String,
    ) {
        val n = qtyOf(qty) ?: return update { it.copy(partError = tr("field_min", "min" to 1)) }
        savePart(partId) { app.api.parts.taskPartsUpdate(id, partId, TaskPartsUpdateRequest(qty = n)) }
    }

    private fun savePart(
        partId: String,
        call: suspend () -> Unit,
    ) {
        if (current.partSaving) return
        update { it.copy(partSaving = true, partError = null) }
        launch({ e ->
            update { it.copy(partSaving = false, partError = if (e.code == "conflict") tr("part_link_taken") else e.message) }
        }) {
            call()
            update { it.copy(partSaving = false, partSaved = true) }
            app.changed("tasks", "parts")
        }
    }

    fun partDialogClosed() {
        update { it.copy(partSaved = false, partError = null) }
    }

    fun unlinkPart(partId: String) {
        val name = parts.firstOrNull { it.partId == partId }?.part?.name ?: return
        write {
            app.api.parts.taskPartsUnlink(id, partId)
            update { it.copy(notice = TaskNotice(tr("part_unlinked_toast", "name" to name), null)) }
            app.changed("tasks", "parts")
        }
    }
}
