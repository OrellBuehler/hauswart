package ch.orellbuehler.hauswart.android.reminders

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.feature.reminders.PlannedReminder
import ch.orellbuehler.hauswart.feature.reminders.REMINDER_PERMISSION_DENIED
import ch.orellbuehler.hauswart.feature.reminders.REMINDER_PERMISSION_GRANTED
import ch.orellbuehler.hauswart.feature.reminders.REMINDER_PERMISSION_UNDETERMINED
import ch.orellbuehler.hauswart.feature.reminders.ReminderPrefs
import ch.orellbuehler.hauswart.feature.reminders.ReminderSync
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * Keeps the alarms of the reminders in step with the data: plans again when the app comes to the
 * foreground, after tasks or appointments changed and in the background (see [ReminderWork]), and
 * takes everything away when the person signs out.
 */
class RemindersController(
    private val context: Context,
    private val app: HauswartApp,
) {
    private val sync = ReminderSync(app)
    private val prefs = ReminderPrefs(app.settings)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    fun start() {
        scope.launch {
            app.session.state
                .map { it.signedIn }
                .distinctUntilChanged()
                .collect { signedIn -> if (!signedIn) signedOut() }
        }
        sync.watch { plan -> apply(plan) }
    }

    /** Plans from the server's data now and schedules the result. */
    fun sync() {
        scope.launch { syncNow() }
    }

    suspend fun syncNow() {
        apply(sync.plan())
    }

    /** Sets the alarms again from the last plan, without a network. */
    fun restore() {
        apply(sync.stored())
    }

    private fun apply(plan: List<PlannedReminder>) {
        ReminderScheduler.apply(context, plan)
        if (prefs.settings().enabled && app.session.state.value.signedIn) ReminderWork.ensure(context) else ReminderWork.cancel(context)
    }

    private fun signedOut() {
        sync.forget()
        ReminderScheduler.cancelAll(context)
        ReminderWork.cancel(context)
    }

    /** What the system allows, as the settings store names it. */
    fun permission(): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return if (NotificationManagerCompat
                    .from(
                        context,
                    ).areNotificationsEnabled()
            ) {
                REMINDER_PERMISSION_GRANTED
            } else {
                REMINDER_PERMISSION_DENIED
            }
        }
        val granted =
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        return when {
            granted && NotificationManagerCompat.from(context).areNotificationsEnabled() -> REMINDER_PERMISSION_GRANTED
            granted || asked() -> REMINDER_PERMISSION_DENIED
            else -> REMINDER_PERMISSION_UNDETERMINED
        }
    }

    /** Remembers that the system dialog was shown: afterwards "not granted" means "refused". */
    fun markAsked() {
        context
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(ASKED, true)
            .apply()
    }

    private fun asked(): Boolean = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(ASKED, false)

    private companion object {
        const val PREFS = "hauswart_reminders"
        const val ASKED = "permission_asked"
    }
}
