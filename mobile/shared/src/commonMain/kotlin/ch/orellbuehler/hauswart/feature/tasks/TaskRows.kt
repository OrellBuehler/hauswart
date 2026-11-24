package ch.orellbuehler.hauswart.feature.tasks

import ch.orellbuehler.hauswart.api.generated.Task
import ch.orellbuehler.hauswart.api.generated.TaskState
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.dueText
import ch.orellbuehler.hauswart.core.formatNumber
import ch.orellbuehler.hauswart.core.shortDate
import ch.orellbuehler.hauswart.feature.appointments.AppointmentChip
import ch.orellbuehler.hauswart.feature.appointments.appointmentChipOf
import ch.orellbuehler.hauswart.feature.dashboard.taskStatusLabel
import ch.orellbuehler.hauswart.feature.dashboard.taskTone
import ch.orellbuehler.hauswart.i18n.tr

/** The date a task is shown with: the estimate while the counter is expected to get there first, else the due date. */
fun shownDate(state: TaskState): String? =
    if (state.dueKind == "estimated" && state.estimate != null) state.estimate.date else state.dueDate ?: state.estimate?.date

fun shownDateIsEstimate(state: TaskState): Boolean = shownDate(state) != null && (state.dueKind == "estimated" || state.dueDate == null)

/** The progress of a counter task: "30/100 km" and how far the bar is filled. */
data class ProgressInfo(
    val text: String,
    val fraction: Float,
    val reached: Boolean,
)

fun progressOf(state: TaskState?): ProgressInfo? {
    val p = state?.progress ?: return null
    val text = formatNumber(p.current) + "/" + formatNumber(p.target) + (p.unit?.let { " $it" } ?: "")
    val fraction = if (p.target > 0) (minOf(p.current, p.target) / p.target).toFloat() else 0f
    return ProgressInfo(text, fraction, p.current >= p.target)
}

/** One task as a list shows it. */
data class TaskRow(
    val id: String,
    val title: String,
    /** "Room · device", empty when the task belongs to neither. */
    val place: String,
    val status: String,
    val statusLabel: String,
    val tone: String,
    /** "in 3 days · 24 Nov", empty without a date. */
    val dueText: String,
    val assigneeName: String?,
    val progress: ProgressInfo?,
    val archived: Boolean,
    val snoozed: Boolean,
    /** The task counts a vehicle's odometer: completing it asks for the reading first. */
    val needsReading: Boolean,
    val openNotes: Long,
    val commentCount: Int,
    /** "3 comments"; empty without comments. */
    val commentsLabel: String,
    /** The earliest planned appointment, null without one. */
    val appointment: AppointmentChip?,
    val archivedLabel: String?,
    val snoozedLabel: String?,
    val roomId: String?,
    val assetId: String?,
    val category: String,
    val description: String,
    val assigneeId: String?,
    val sortDate: String,
)

fun taskRowOf(
    task: Task,
    today: String,
    people: Map<String, String>,
    timeZone: String,
): TaskRow {
    val state = task.state
    val date = state?.let { shownDate(it) }
    val status = state?.status ?: "unknown"
    val assignee = state?.currentAssigneeUserId
    val snoozedUntil = task.snoozedUntil?.takeIf { it > today }
    return TaskRow(
        id = task.id,
        title = task.title,
        place = listOfNotNull(task.roomName, task.assetName).joinToString(" · "),
        status = status,
        statusLabel = taskStatusLabel(status),
        tone = taskTone(status),
        dueText = date?.let { dueText(it, today, shownDateIsEstimate(state)) }.orEmpty(),
        assigneeName = assignee?.let { people[it] },
        progress = progressOf(state),
        archived = task.archivedAt != null,
        snoozed = status == "snoozed" && task.snoozedUntil != null,
        needsReading = odometerAssetOf(task.trigger) != null,
        openNotes = task.openNoteCount,
        commentCount = task.commentCount.toInt(),
        commentsLabel = if (task.commentCount > 0) tr("comments_count", "count" to task.commentCount) else "",
        appointment = appointmentChipOf(task.nextAppointment, timeZone, today),
        archivedLabel = if (task.archivedAt != null) tr("task_archived") else null,
        snoozedLabel = snoozedUntil?.let { tr("task_snoozed_until", "date" to Dates.format(it)) },
        roomId = task.roomId,
        assetId = task.assetId,
        category = task.category,
        description = task.descriptionMd,
        assigneeId = assignee,
        sortDate = date ?: "9999-12-31",
    )
}

/** "24 Nov" without the year while it is this year; used where a row has little room. */
fun shortDay(
    date: String,
    today: String,
): String = shortDate(date, today)
