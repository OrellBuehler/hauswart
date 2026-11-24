package ch.orellbuehler.hauswart.android.reminders

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import ch.orellbuehler.hauswart.feature.reminders.PlannedReminder

/**
 * Replaces the pending alarms with a plan. Alarms are inexact on purpose (`setAndAllowWhileIdle`: no
 * exact-alarm permission, a few minutes of slack when the phone dozes). A reminder that is due
 * already is posted at once.
 */
object ReminderScheduler {
    private const val PREFS = "hauswart_reminders"
    private const val CODES = "alarm_codes"
    private const val IMMEDIATE_MS = 1_000L

    fun apply(
        context: Context,
        plan: List<PlannedReminder>,
    ) {
        val alarms = context.getSystemService(AlarmManager::class.java) ?: return
        cancelAlarms(context, alarms)
        val now = System.currentTimeMillis()
        val codes = mutableSetOf<String>()
        plan.forEach { reminder ->
            val content = ReminderContent(reminder.id, reminder.title, reminder.body, reminder.link.kind, reminder.link.id)
            if (reminder.fireAt <= now + IMMEDIATE_MS) {
                ReminderNotifier.show(context, content)
            } else {
                alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, reminder.fireAt, pendingIntent(context, content))
                codes += reminder.id.hashCode().toString()
            }
        }
        context
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putStringSet(CODES, codes)
            .apply()
    }

    /** Cancels every alarm and removes the notifications already shown. */
    fun cancelAll(context: Context) {
        context.getSystemService(AlarmManager::class.java)?.let { cancelAlarms(context, it) }
        context
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(CODES)
            .apply()
        val manager = context.getSystemService(android.app.NotificationManager::class.java) ?: return
        // The notice that the session ended is posted while the session is being cleared: it stays.
        manager.activeNotifications
            .filter { it.id != ReminderNotifier.SESSION_ENDED_NOTIFICATION_ID }
            .forEach { manager.cancel(it.id) }
    }

    private fun cancelAlarms(
        context: Context,
        alarms: AlarmManager,
    ) {
        val codes = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getStringSet(CODES, emptySet()).orEmpty()
        codes.mapNotNull { it.toIntOrNull() }.forEach { code ->
            val existing =
                PendingIntent.getBroadcast(
                    context,
                    code,
                    Intent(context, ReminderReceiver::class.java),
                    PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
                )
            if (existing != null) {
                alarms.cancel(existing)
                existing.cancel()
            }
        }
    }

    private fun pendingIntent(
        context: Context,
        content: ReminderContent,
    ): PendingIntent {
        val intent =
            Intent(context, ReminderReceiver::class.java)
                .putExtra(ReminderReceiver.EXTRA_ID, content.id)
                .putExtra(ReminderReceiver.EXTRA_TITLE, content.title)
                .putExtra(ReminderReceiver.EXTRA_BODY, content.body)
                .putExtra(ReminderReceiver.EXTRA_LINK_KIND, content.linkKind)
                .putExtra(ReminderReceiver.EXTRA_LINK_ID, content.linkId)
        return PendingIntent.getBroadcast(
            context,
            content.id.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
