package ch.orellbuehler.hauswart.android.reminders

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Fires when an alarm of [ReminderScheduler] goes off and posts the reminder. */
class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(
        context: Context,
        intent: Intent,
    ) {
        val id = intent.getStringExtra(EXTRA_ID) ?: return
        ReminderNotifier.show(
            context,
            ReminderContent(
                id = id,
                title = intent.getStringExtra(EXTRA_TITLE).orEmpty(),
                body = intent.getStringExtra(EXTRA_BODY).orEmpty(),
                linkKind = intent.getStringExtra(EXTRA_LINK_KIND).orEmpty(),
                linkId = intent.getStringExtra(EXTRA_LINK_ID),
            ),
        )
    }

    companion object {
        const val EXTRA_ID = "reminder_id"
        const val EXTRA_TITLE = "reminder_title"
        const val EXTRA_BODY = "reminder_body"
        const val EXTRA_LINK_KIND = "reminder_link_kind"
        const val EXTRA_LINK_ID = "reminder_link_id"
    }
}
