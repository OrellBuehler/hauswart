package ch.orellbuehler.hauswart.feature.reminders

import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.feature.applink.AppLink
import ch.orellbuehler.hauswart.feature.applink.LINK_APPOINTMENT
import ch.orellbuehler.hauswart.feature.applink.LINK_NOTIFICATIONS
import ch.orellbuehler.hauswart.feature.applink.LINK_TASK
import ch.orellbuehler.hauswart.feature.applink.LINK_TASKS
import ch.orellbuehler.hauswart.i18n.tr

/**
 * Works out which local notifications the phone should have pending. Pure: the clock, the zone and
 * everything it reads come in through [ReminderPlanInput].
 *
 * - A task reminds at the chosen time of day on the day it is due; an overdue one at the next such
 *   time. With "due soon" on it also reminds the day before.
 * - More than [MAX_INDIVIDUAL_TASKS] tasks that remind at the same time become one notification.
 * - A timed appointment reminds the chosen number of minutes before it starts, an all-day one at the
 *   time of day of its first day.
 * - A new unread notification of the server is shown at once, except those a task reminder already
 *   covers.
 * - Never more than [MAX_PLANNED_REMINDERS], the earliest ones.
 */
object ReminderPlanner {
    const val MAX_INDIVIDUAL_TASKS = 3
    const val HORIZON_DAYS = 30

    /** Kinds of server notification that the task reminders say already. */
    private val coveredKinds = setOf("due_soon", "due", "overdue", "digest")

    fun plan(input: ReminderPlanInput): List<PlannedReminder> {
        if (!input.settings.enabled) return emptyList()
        val all = taskReminders(input) + appointmentReminders(input) + notificationReminders(input)
        return all.sortedWith(compareBy({ it.fireAt }, { it.id })).take(MAX_PLANNED_REMINDERS)
    }

    private data class TaskHit(
        val fireDay: String,
        val soon: Boolean,
        val overdue: Boolean,
        val task: ReminderTask,
        val fireAt: Long,
    )

    private fun taskReminders(input: ReminderPlanInput): List<PlannedReminder> {
        val time = input.settings.timeOfDay
        val zone = input.timeZone
        val todayAt = zonedMillis(input.today, time, zone) ?: return emptyList()
        val hits = mutableListOf<TaskHit>()
        for (task in input.tasks) {
            val diff = Dates.diffDays(input.today, task.date)
            if (Dates.parse(task.date) == null || diff > HORIZON_DAYS) continue
            val dueDay =
                if (diff > 0) {
                    task.date
                } else if (todayAt > input.nowMillis) {
                    input.today
                } else {
                    Dates.addDays(input.today, 1)
                }
            zonedMillis(dueDay, time, zone)?.takeIf { it > input.nowMillis }?.let {
                hits += TaskHit(dueDay, soon = false, overdue = task.date < dueDay, task = task, fireAt = it)
            }
            if (input.settings.dueSoon && diff >= 1) {
                val soonDay = Dates.addDays(task.date, -1)
                zonedMillis(soonDay, time, zone)?.takeIf { it > input.nowMillis }?.let {
                    hits += TaskHit(soonDay, soon = true, overdue = false, task = task, fireAt = it)
                }
            }
        }
        return hits.groupBy { it.fireDay to it.soon }.flatMap { (key, group) ->
            val (day, soon) = key
            val kind = if (soon) "soon" else "due"
            if (group.size > MAX_INDIVIDUAL_TASKS) {
                val titles = group.take(MAX_INDIVIDUAL_TASKS).joinToString(", ") { it.task.title } + " …"
                listOf(
                    PlannedReminder(
                        id = "tasks:$day:$kind",
                        fireAt = group.first().fireAt,
                        title = tr(if (soon) "m_reminder_tasks_soon" else "m_reminder_tasks_due", "count" to group.size),
                        body = titles,
                        link = AppLink(LINK_TASKS, null),
                    ),
                )
            } else {
                group.map {
                    val titleKey =
                        when {
                            soon -> "m_reminder_task_soon"
                            it.overdue -> "m_reminder_task_overdue"
                            else -> "m_reminder_task_due"
                        }
                    PlannedReminder("task:${it.task.id}:$day:$kind", it.fireAt, tr(titleKey), it.task.title, AppLink(LINK_TASK, it.task.id))
                }
            }
        }
    }

    private fun appointmentReminders(input: ReminderPlanInput): List<PlannedReminder> =
        input.appointments.mapNotNull { a ->
            val link = AppLink(LINK_APPOINTMENT, a.id)
            if (a.allDay) {
                val day = a.startDate ?: return@mapNotNull null
                if (Dates.diffDays(input.today, day) > HORIZON_DAYS) return@mapNotNull null
                val at =
                    zonedMillis(day, input.settings.timeOfDay, input.timeZone)?.takeIf { it > input.nowMillis } ?: return@mapNotNull null
                val body = listOfNotNull(tr("m_reminder_all_day"), a.location?.takeIf { it.isNotBlank() }).joinToString(" · ")
                PlannedReminder("appt:${a.id}:$day", at, tr("m_reminder_appointment", "title" to a.title), body, link)
            } else {
                val start = a.startsAt ?: return@mapNotNull null
                val at = (start - input.settings.appointmentLeadMinutes * 60_000L).takeIf { it > input.nowMillis } ?: return@mapNotNull null
                val day = dateOfMillis(start, input.timeZone)
                if (Dates.diffDays(input.today, day) > HORIZON_DAYS) return@mapNotNull null
                val time = timeOfMillis(start, input.timeZone)
                val whenText = if (day == input.today) time else Dates.short(day) + " " + time
                val body = listOfNotNull(whenText, a.location?.takeIf { it.isNotBlank() }).joinToString(" · ")
                PlannedReminder("appt:${a.id}:$start", at, tr("m_reminder_appointment", "title" to a.title), body, link)
            }
        }

    private fun notificationReminders(input: ReminderPlanInput): List<PlannedReminder> =
        input.notifications
            .filter { it.kind !in coveredKinds }
            .map {
                PlannedReminder(
                    "note:${it.id}",
                    input.nowMillis,
                    tr("m_reminder_notification"),
                    it.text,
                    it.link ?: AppLink(LINK_NOTIFICATIONS, null),
                )
            }
}
