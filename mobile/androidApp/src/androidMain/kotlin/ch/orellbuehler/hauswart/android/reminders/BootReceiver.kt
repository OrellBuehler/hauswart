package ch.orellbuehler.hauswart.android.reminders

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import ch.orellbuehler.hauswart.android.HauswartApplication

/**
 * After a restart or an update the system has dropped the alarms: set them again from the plan
 * that was kept. A changed time zone moves what "08:00" means, so that one plans anew.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(
        context: Context,
        intent: Intent,
    ) {
        val reminders = (context.applicationContext as HauswartApplication).reminders
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> reminders.restore()
            Intent.ACTION_TIMEZONE_CHANGED -> ReminderWork.once(context)
        }
    }
}
