package ch.orellbuehler.hauswart.android.reminders

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import ch.orellbuehler.hauswart.android.MainActivity
import ch.orellbuehler.hauswart.android.R
import ch.orellbuehler.hauswart.i18n.tr

/** What a reminder says and where tapping it leads; travels in the extras of the alarm. */
data class ReminderContent(
    val id: String,
    val title: String,
    val body: String,
    val linkKind: String,
    val linkId: String?,
)

/** Posts the notification of a reminder. Its own channel, so that the person can mute reminders without muting anything else. */
object ReminderNotifier {
    const val CHANNEL_ID = "reminders"

    @SuppressLint("MissingPermission")
    fun show(
        context: Context,
        content: ReminderContent,
    ) {
        val manager = NotificationManagerCompat.from(context)
        // Covers the POST_NOTIFICATIONS permission and the switch in the system settings.
        if (!manager.areNotificationsEnabled()) return
        ensureChannel(context)
        val open =
            Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra(MainActivity.EXTRA_LINK_KIND, content.linkKind)
                .putExtra(MainActivity.EXTRA_LINK_ID, content.linkId)
        val tap =
            PendingIntent.getActivity(
                context,
                content.id.hashCode(),
                open,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        val notification =
            NotificationCompat
                .Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_reminder)
                .setContentTitle(content.title)
                .setContentText(content.body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(content.body))
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setAutoCancel(true)
                .setContentIntent(tap)
                .build()
        manager.notify(content.id.hashCode(), notification)
    }

    /** Creates the channel (again: this also renames it after a change of language). */
    fun ensureChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, tr("m_reminder_channel"), NotificationManager.IMPORTANCE_DEFAULT))
    }
}
