package ch.orellbuehler.hauswart.feature.dashboard

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.Dashboard
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.feature.tasks.TaskNotice
import ch.orellbuehler.hauswart.feature.tasks.UndoToken
import ch.orellbuehler.hauswart.feature.tasks.completeWithoutDialog
import ch.orellbuehler.hauswart.feature.tasks.runUndo
import ch.orellbuehler.hauswart.i18n.tr

data class DashboardState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val dashboard: Dashboard? = null,
    val unreadNotifications: Long = 0,
    val householdName: String = "",
    /** "Hallo Anna" */
    val greeting: String = "",
    val laterExpanded: Boolean = false,
    /** What the screen shows of [dashboard]: sections, cards and their texts, ready to render. */
    val view: DashboardView? = null,
    /** The task a quick action is running for. */
    val busyId: String? = null,
    val notice: TaskNotice? = null,
    val actionError: UiError? = null,
)

class DashboardStore(
    private val app: HauswartApp,
) : Store<DashboardState>(DashboardState()) {
    init {
        onChange(app, "tasks", "appointments", "defects", "parts", "costs", "assets", "notifications") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    /** Shows every later task instead of the first few, or folds them again. */
    fun toggleLater() {
        val expanded = !current.laterExpanded
        val dashboard = current.dashboard ?: return
        val view = dashboardView(dashboard, expanded, app.household.timezone)
        update { it.copy(laterExpanded = expanded, view = view) }
    }

    /** Completes the task without a dialog (not for a task whose row says it [TaskItem.needsReading]). */
    fun complete(taskId: String) {
        val title = titleOf(taskId) ?: return
        if (current.busyId != null) return
        update { it.copy(busyId = taskId, actionError = null) }
        launch({ e -> update { it.copy(busyId = null, actionError = e) } }) {
            completeWithoutDialog(app, taskId, title) { notice -> update { it.copy(busyId = null, notice = notice) } }
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

    private fun titleOf(taskId: String): String? =
        current.view
            ?.sections
            ?.filter { it.id != SECTION_PREPARATIONS }
            ?.flatMap { it.items }
            ?.firstOrNull { it.id == taskId }
            ?.title

    private fun load() {
        update { it.copy(loading = it.dashboard == null, error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            val household = app.household.get()
            val dashboard = app.api.dashboard.dashboard()
            val unread =
                app.api.notifications
                    .notificationsUnreadCount()
                    .count
            val user = app.session.user
            val view = dashboardView(dashboard, current.laterExpanded, app.household.timezone)
            update {
                it.copy(
                    loading = false,
                    dashboard = dashboard,
                    unreadNotifications = unread,
                    householdName = household.name,
                    greeting = tr("dashboard_greeting", "name" to (user?.displayName?.ifBlank { null } ?: user?.username ?: "")),
                    view = view,
                )
            }
        }
    }
}
