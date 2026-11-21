@file:OptIn(ExperimentalTime::class)

package ch.orellbuehler.hauswart.feature.tasks

import ch.orellbuehler.hauswart.api.generated.Completion
import ch.orellbuehler.hauswart.api.generated.Part
import ch.orellbuehler.hauswart.api.generated.Preparation
import ch.orellbuehler.hauswart.api.generated.TaskDetail
import ch.orellbuehler.hauswart.api.generated.TaskPart
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.shortDate
import ch.orellbuehler.hauswart.feature.appointments.AppointmentChip
import ch.orellbuehler.hauswart.feature.appointments.appointmentChipOf
import ch.orellbuehler.hauswart.feature.dashboard.TONE_DUE
import ch.orellbuehler.hauswart.feature.dashboard.TONE_MUTED
import ch.orellbuehler.hauswart.feature.dashboard.TONE_OK
import ch.orellbuehler.hauswart.feature.dashboard.TONE_OVERDUE
import ch.orellbuehler.hauswart.i18n.tr
import kotlin.time.Duration.Companion.days
import kotlin.time.ExperimentalTime
import kotlin.time.Instant

const val FINANCE_BILL_SOURCE = "finance_bill"
const val UNDO_WINDOW_DAYS = 7

data class PreparationRow(
    val id: String,
    val title: String,
    val kindLabel: String,
    val leadText: String?,
    val stateLabel: String,
    /** Still to do: a button ticks it off. */
    val open: Boolean,
    val now: Boolean,
)

data class CompletionRow(
    val id: String,
    val who: String,
    val skipped: Boolean,
    val skippedLabel: String,
    val whenText: String,
    val sourceLabel: String,
    val note: String?,
    val canUndo: Boolean,
    val undoLabel: String,
)

data class TaskPartRow(
    val partId: String,
    val name: String,
    val stockLabel: String,
    val stockTone: String,
    val qty: Long,
    val qtyLabel: String,
)

data class DetailChip(
    val label: String,
    val tone: String,
)

data class TaskDetailView(
    val id: String,
    val title: String,
    val statusLabel: String,
    val tone: String,
    val dueText: String,
    val chips: List<DetailChip>,
    /** The earliest planned appointment, null without one. */
    val appointment: AppointmentChip?,
    val archived: Boolean,
    val snoozed: Boolean,
    val needsReading: Boolean,
    val assetId: String?,
    val roomId: String?,
    val description: String,
    val triggerSummary: String,
    /** The "due" line of the schedule card; empty when the task has no state yet. */
    val dueValue: String,
    val dueLimit: String?,
    val progress: ProgressInfo?,
    val graceText: String,
    val dueSoonText: String?,
    val reasons: List<String>,
    val assignmentLines: List<String>,
    val notifyLine: String,
    val place: String,
    val effort: String?,
    val created: String,
    val isBill: Boolean,
    val billUrl: String?,
    val preparations: List<PreparationRow>,
    val history: List<CompletionRow>,
    val parts: List<TaskPartRow>,
)

fun stockOf(part: Part): Pair<String, String> =
    when {
        part.stockCount <= 0 -> tr("part_stock_empty") to TONE_OVERDUE
        part.minStock > 0 && part.stockCount <= part.minStock -> tr("part_stock_low", "count" to part.stockCount) to TONE_DUE
        else -> tr("part_stock_ok", "count" to part.stockCount) to TONE_OK
    }

fun preparationRowOf(prep: Preparation): PreparationRow =
    PreparationRow(
        id = prep.id,
        title = prep.title,
        kindLabel = preparationKindLabel(prep.kind),
        leadText = prep.leadDays?.let { tr("prep_lead_days", "days" to it) },
        stateLabel = preparationStateLabel(prep.state),
        open = prep.state == "now" || prep.state == "not_yet",
        now = prep.state == "now",
    )

fun completionRowOf(
    c: Completion,
    timeZone: String,
    nowMs: Long,
): CompletionRow {
    val who = c.userName ?: tr("completion_unknown_user")
    val created = runCatching { Instant.parse(c.createdAt).toEpochMilliseconds() }.getOrDefault(0L)
    val recent = nowMs - created < UNDO_WINDOW_DAYS.days.inWholeMilliseconds
    return CompletionRow(
        id = c.id,
        who = who,
        skipped = c.kind == "skipped",
        skippedLabel = tr("completion_skipped"),
        whenText = Dates.dateTime(c.completedAt, timeZone),
        sourceLabel = sourceLabel(c.source),
        note = c.note?.takeIf { it.isNotBlank() },
        canUndo = c.revokedAt == null && recent,
        undoLabel = tr("toast_undo"),
    )
}

fun taskPartRowOf(link: TaskPart): TaskPartRow {
    val (label, tone) = stockOf(link.part)
    return TaskPartRow(link.partId, link.part.name, label, tone, link.qty, tr("task_part_qty_each", "qty" to link.qty))
}

private fun estimateWording(confidence: String): String = tr(if (confidence == "medium") "task_estimate_medium" else "task_estimate_low")

fun taskDetailView(
    task: TaskDetail,
    history: List<Completion>,
    parts: List<TaskPart>,
    people: Map<String, String>,
    today: String,
    timeZone: String,
    nowMs: Long,
): TaskDetailView {
    val state = task.state
    val status = state?.status ?: "unknown"
    val date = state?.let { shownDate(it) }
    val archived = task.archivedAt != null
    val snoozed = task.snoozedUntil != null && task.snoozedUntil > today
    val isBill = task.externalSource == FINANCE_BILL_SOURCE
    val chips =
        listOfNotNull(
            DetailChip(categoryLabel(task.category), TONE_MUTED),
            if (task.priority !=
                "normal"
            ) {
                DetailChip(priorityLabel(task.priority), if (task.priority == "high") TONE_OVERDUE else TONE_MUTED)
            } else {
                null
            },
            if (archived) DetailChip(tr("task_archived"), TONE_MUTED) else null,
            if (snoozed) DetailChip(tr("task_snoozed_until", "date" to Dates.format(task.snoozedUntil.orEmpty())), TONE_MUTED) else null,
        )
    var dueValue = ""
    var dueLimit: String? = null
    if (state != null) {
        val estimate = state.estimate
        dueValue =
            when {
                state.dueKind == "estimated" && estimate != null -> {
                    dueLimit = state.dueDate?.let { tr("task_due_limit", "date" to shortDate(it, today)) }
                    "~ " + shortDate(estimate.date, today) + " (" + estimateWording(estimate.confidence) + ")"
                }
                state.dueDate != null -> shortDate(state.dueDate, today)
                estimate != null -> "~ " + shortDate(estimate.date, today) + " (" + estimateWording(estimate.confidence) + ")"
                else -> tr("task_due_none")
            }
    }
    val assigned = state?.currentAssigneeUserId?.let { people[it] }
    val assignment =
        when (task.assignMode) {
            "fixed" -> listOf(tr("task_assignment_fixed", "name" to (task.assigneeUserId?.let { people[it] } ?: "?")))
            "rotate" ->
                listOfNotNull(
                    tr("task_assignment_rotate", "names" to task.rotationOrder.joinToString(" → ") { people[it] ?: "?" }) +
                        " (" + rotationLabel(task.rotationStrategy) + ")",
                    assigned?.let { tr("task_assignment_current", "name" to it) },
                )
            else -> listOf(tr("task_assignment_none"))
        }
    return TaskDetailView(
        id = task.id,
        title = task.title,
        statusLabel =
            ch.orellbuehler.hauswart.feature.dashboard
                .taskStatusLabel(status),
        tone =
            ch.orellbuehler.hauswart.feature.dashboard
                .taskTone(status),
        dueText =
            date
                ?.let {
                    ch.orellbuehler.hauswart.core
                        .dueText(it, today, shownDateIsEstimate(state))
                }.orEmpty(),
        chips = chips,
        appointment = appointmentChipOf(task.nextAppointment, timeZone, today),
        archived = archived,
        snoozed = snoozed,
        needsReading = odometerAssetOf(task.trigger) != null,
        assetId = task.assetId,
        roomId = task.roomId,
        description = task.descriptionMd,
        triggerSummary = describeTrigger(task.trigger),
        dueValue = dueValue,
        dueLimit = dueLimit,
        progress = progressOf(state),
        graceText = tr("task_days", "days" to task.graceDays),
        dueSoonText = task.dueSoonDays?.let { tr("task_days", "days" to it) },
        reasons = (state?.reasons.orEmpty()).filter { it != "never_completed" || history.isEmpty() }.map { reasonLabel(it) },
        assignmentLines = assignment,
        notifyLine = tr("task_notify") + ": " + notifyModeLabel(task.notifyMode),
        place = listOfNotNull(task.roomName, task.assetName).joinToString(" · "),
        effort = task.effortMinutes?.let { tr("task_minutes", "minutes" to it) },
        created = Dates.dateTime(task.createdAt, timeZone),
        isBill = isBill,
        billUrl = if (isBill) task.externalUrl?.takeIf { it.startsWith("http://", true) || it.startsWith("https://", true) } else null,
        preparations = task.preparations.map { preparationRowOf(it) },
        history = history.map { completionRowOf(it, timeZone, nowMs) },
        parts = parts.map { taskPartRowOf(it) },
    )
}
