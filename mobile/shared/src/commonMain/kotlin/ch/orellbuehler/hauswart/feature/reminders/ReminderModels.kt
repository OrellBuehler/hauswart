package ch.orellbuehler.hauswart.feature.reminders

import ch.orellbuehler.hauswart.feature.applink.AppLink

const val DEFAULT_REMINDER_TIME = "08:00"
const val DEFAULT_APPOINTMENT_LEAD_MINUTES = 60

/** iOS keeps 64 pending notifications; the plan stays below that. */
const val MAX_PLANNED_REMINDERS = 60

/** What the person chose for the reminders of this device. */
data class ReminderSettings(
    val enabled: Boolean = false,
    /** `HH:mm` in the household time zone: when tasks and all-day appointments remind. */
    val timeOfDay: String = DEFAULT_REMINDER_TIME,
    /** Also remind the day before a task is due. */
    val dueSoon: Boolean = false,
    /** How long before it starts a timed appointment reminds. */
    val appointmentLeadMinutes: Int = DEFAULT_APPOINTMENT_LEAD_MINUTES,
)

/**
 * A notification to show at [fireAt] (milliseconds since the epoch). The [id] is stable: planning
 * again replaces what is pending instead of adding to it. A [fireAt] that is not in the future means
 * "now". Tapping it opens [link].
 */
data class PlannedReminder(
    val id: String,
    val fireAt: Long,
    val title: String,
    val body: String,
    val link: AppLink,
)

/** A task with a known due [date] (`YYYY-MM-DD`). */
data class ReminderTask(
    val id: String,
    val title: String,
    val date: String,
)

/** A planned appointment: all-day ones carry [startDate], timed ones [startsAt]. */
data class ReminderAppointment(
    val id: String,
    val title: String,
    val location: String?,
    val allDay: Boolean,
    val startsAt: Long?,
    val startDate: String?,
)

/** An unread notification of the server that was not shown on the phone yet, already worded. */
data class ReminderServerNotification(
    val id: String,
    /** `prep`, `due_soon`, `due`, `overdue`, `digest`, `info`, `comment` or `hint`. */
    val kind: String,
    val text: String,
    val link: AppLink?,
)

data class ReminderPlanInput(
    val tasks: List<ReminderTask>,
    val appointments: List<ReminderAppointment>,
    val notifications: List<ReminderServerNotification>,
    val settings: ReminderSettings,
    /** Today in the household time zone. */
    val today: String,
    val nowMillis: Long,
    val timeZone: String,
)
