package ch.orellbuehler.hauswart.feature.reminders

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.StoreSubscription
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.core.uiErrorOf
import ch.orellbuehler.hauswart.feature.applink.AppLink
import ch.orellbuehler.hauswart.feature.applink.LINK_TASK
import ch.orellbuehler.hauswart.feature.applink.routeForUrl
import ch.orellbuehler.hauswart.feature.files.nowMillis
import ch.orellbuehler.hauswart.feature.notifications.notificationText
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Fetches what [ReminderPlanner] needs with the signed-in session and returns the plan. The platform
 * code replaces what is pending with it: Android through alarms, iOS through local notifications.
 * The last plan is kept, so that a sync that cannot reach the server still hands back what was
 * planned, and so that the phone can restore its alarms after a restart without a network.
 */
class ReminderSync(
    private val app: HauswartApp,
    private val clock: () -> Long = ::nowMillis,
) {
    /** The sync with the real clock; Swift cannot use the default argument above. */
    constructor(app: HauswartApp) : this(app, ::nowMillis)

    private val prefs = ReminderPrefs(app.settings)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    /** Why the last sync could not reach the server; null after a good one. */
    var lastError: UiError? = null
        private set

    /** Plans from the server's current data. Never throws; on a failure the stored plan comes back and [lastError] is set. */
    suspend fun plan(): List<PlannedReminder> {
        val settings = prefs.settings()
        val now = clock()
        if (!settings.enabled || !app.session.state.value.signedIn) {
            prefs.forget()
            return emptyList()
        }
        try {
            val zone = app.household.get().timezone
            val today = dateOfMillis(now, zone)
            val dashboard = app.api.dashboard.dashboard()
            val upcoming = dashboard.upcoming
            val tasks =
                (upcoming.overdue + upcoming.today + upcoming.thisWeek + upcoming.later)
                    .filter { it.date != null && !it.estimated && it.dueKind != "estimated" && it.status != "snoozed" }
                    .map { ReminderTask(it.taskId, it.title, requireNotNull(it.date)) }
                    .distinctBy { it.id }
            val appointments =
                fetchAll { cursor ->
                    val page =
                        app.api.appointments.appointmentsList(
                            cursor = cursor,
                            limit = 100,
                            from = today,
                            to = Dates.addDays(today, ReminderPlanner.HORIZON_DAYS),
                            status = "planned",
                        )
                    page.items to page.nextCursor
                }.map {
                    ReminderAppointment(it.id, it.title, it.location, it.allDay, it.startsAt?.let(::instantMillis), it.startDate)
                }
            val unread =
                app.api.notifications
                    .notificationsList(limit = 30, unread = true)
                    .items
            val seen = prefs.seen()
            val fresh =
                if (seen == null) {
                    emptyList()
                } else {
                    unread
                        .filter { it.id !in seen && (instantMillis(it.createdAt) ?: 0L) > now - DAY_MS }
                        .sortedByDescending { it.createdAt }
                        .take(MAX_NEW_NOTIFICATIONS)
                }
            prefs.saveSeen(((seen ?: emptySet()) + unread.map { it.id }).toList().takeLast(MAX_SEEN))
            val notifications =
                fresh.map {
                    ReminderServerNotification(
                        id = it.id,
                        kind = it.kind,
                        text = notificationText(it.titleKey, it.params),
                        link = routeForUrl(it.url) ?: it.taskId?.let { id -> AppLink(LINK_TASK, id) },
                    )
                }
            val plan = ReminderPlanner.plan(ReminderPlanInput(tasks, appointments, notifications, settings, today, now, zone))
            prefs.savePlan(plan.filter { it.fireAt > now + IMMEDIATE_MS })
            lastError = null
            return plan
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            lastError = uiErrorOf(e)
            return stored()
        }
    }

    /** What was planned last and has not passed yet; empty when reminders are off. */
    fun stored(): List<PlannedReminder> {
        if (!prefs.settings().enabled) return emptyList()
        val now = clock()
        return prefs.plan().filter { it.fireAt > now + IMMEDIATE_MS }
    }

    /** Plans without suspending: [onDone] gets the plan on the main thread. For Swift, which cannot call [plan]. */
    fun run(onDone: (List<PlannedReminder>) -> Unit) {
        scope.launch { onDone(plan()) }
    }

    /**
     * Plans again, a moment after tasks or appointments changed, and hands each plan to [onPlan]
     * until the subscription is cancelled.
     */
    fun watch(onPlan: (List<PlannedReminder>) -> Unit): StoreSubscription {
        val job =
            scope.launch {
                var pending: Job? = null
                app.changes.collect { topic ->
                    if (topic == "tasks" || topic == "appointments") {
                        pending?.cancel()
                        pending =
                            launch {
                                delay(DEBOUNCE_MS)
                                onPlan(plan())
                            }
                    }
                }
            }
        return StoreSubscription(job)
    }

    /** Forgets the plan and what was shown; the settings stay. Called when the person signs out. */
    fun forget() {
        prefs.forget()
    }

    private companion object {
        const val DAY_MS = 86_400_000L
        const val IMMEDIATE_MS = 1_000L
        const val DEBOUNCE_MS = 2_000L
        const val MAX_NEW_NOTIFICATIONS = 5
        const val MAX_SEEN = 200
    }
}
