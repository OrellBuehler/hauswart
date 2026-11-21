package ch.orellbuehler.hauswart.feature.defects

import ch.orellbuehler.hauswart.api.generated.Defect
import ch.orellbuehler.hauswart.api.generated.DefectDetail
import ch.orellbuehler.hauswart.api.generated.DefectEvent
import ch.orellbuehler.hauswart.api.generated.DefectsCreateRequest
import ch.orellbuehler.hauswart.api.generated.DefectsStatusRequest
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.relativeDays
import ch.orellbuehler.hauswart.core.shortDate
import ch.orellbuehler.hauswart.feature.comments.TextSegment
import ch.orellbuehler.hauswart.feature.comments.linkify
import ch.orellbuehler.hauswart.feature.dashboard.TONE_DUE
import ch.orellbuehler.hauswart.feature.dashboard.TONE_MUTED
import ch.orellbuehler.hauswart.feature.dashboard.TONE_NORMAL
import ch.orellbuehler.hauswart.feature.dashboard.TONE_OK
import ch.orellbuehler.hauswart.feature.dashboard.TONE_OVERDUE
import ch.orellbuehler.hauswart.feature.files.relativeInstant
import ch.orellbuehler.hauswart.i18n.tr

val DEFECT_STATUSES: List<String> = DefectsStatusRequest.STATUS_VALUES

val DEFECT_SEVERITIES: List<String> = DefectsCreateRequest.SEVERITY_VALUES

/** Statuses of a defect that still needs attention. */
val ACTIVE_DEFECT_STATUSES: List<String> = listOf("open", "reported", "in_progress")

/** Where a defect may go from each status; closed ones can only be reopened. */
val DEFECT_TRANSITIONS: Map<String, List<String>> =
    mapOf(
        "open" to listOf("reported", "in_progress", "fixed", "rejected"),
        "reported" to listOf("open", "in_progress", "fixed", "rejected"),
        "in_progress" to listOf("open", "reported", "fixed", "rejected"),
        "fixed" to listOf("open"),
        "rejected" to listOf("open"),
    )

/** A deadline closer than this many days is shown as due soon. */
const val DEFECT_REMINDER_LEAD_DAYS = 30

const val DEFECT_SORT_DEADLINE = "deadline"
const val DEFECT_SORT_NUMBER = "number"

const val DEADLINE_MODE_AUTO = "auto"
const val DEADLINE_MODE_MANUAL = "manual"
const val DEADLINE_MODE_NONE = "none"

/** One choice of a dropdown; the empty [value] is the "no filter" or "none" choice. */
data class DefectChoice(
    val value: String,
    val label: String,
)

fun isActiveDefectStatus(status: String): Boolean = status in ACTIVE_DEFECT_STATUSES

fun defectStatusLabel(status: String): String = if (status in DEFECT_STATUSES) tr("defect_status_$status") else status

fun defectSeverityLabel(severity: String): String = if (severity in DEFECT_SEVERITIES) tr("defect_severity_$severity") else severity

fun defectStatusTone(status: String): String =
    when (status) {
        "open" -> TONE_DUE
        "reported", "in_progress" -> TONE_NORMAL
        "fixed" -> TONE_OK
        else -> TONE_MUTED
    }

fun defectSeverityTone(severity: String): String =
    when (severity) {
        "high" -> TONE_OVERDUE
        "medium" -> TONE_DUE
        else -> TONE_MUTED
    }

fun defectStatusChoices(): List<DefectChoice> = DEFECT_STATUSES.map { DefectChoice(it, defectStatusLabel(it)) }

fun defectSeverityChoices(): List<DefectChoice> = DEFECT_SEVERITIES.map { DefectChoice(it, defectSeverityLabel(it)) }

/** The severities with a leading "all" choice, for the filter. */
fun defectSeverityFilterChoices(): List<DefectChoice> = listOf(DefectChoice("", tr("defects_filter_all"))) + defectSeverityChoices()

fun defectSortChoices(): List<DefectChoice> =
    listOf(
        DefectChoice(DEFECT_SORT_DEADLINE, tr("defects_sort_deadline")),
        DefectChoice(DEFECT_SORT_NUMBER, tr("defects_sort_number")),
    )

/** "Room · device · detail" for a defect, without the empty parts. */
fun defectPlace(
    roomName: String?,
    assetName: String?,
    locationDetail: String?,
): String = listOfNotNull(roomName, assetName, locationDetail).filter { it.isNotBlank() }.joinToString(" · ")

/** How pressing a deadline is and how it reads: "Überfällig · 12.01. · vor 3 Tagen". */
data class DefectDeadline(
    val text: String,
    val tone: String,
    val overdue: Boolean,
    /** The date as `YYYY-MM-DD`; null without a deadline. */
    val date: String?,
)

/** Closed defects (fixed, rejected) never count as overdue or due soon. */
fun defectDeadline(
    date: String?,
    status: String,
    today: String,
): DefectDeadline {
    if (date == null) return DefectDeadline(tr("defect_deadline_none"), TONE_MUTED, false, null)
    val days = Dates.diffDays(today, date)
    val active = isActiveDefectStatus(status)
    val overdue = active && days < 0
    val tone =
        when {
            overdue -> TONE_OVERDUE
            active && days <= DEFECT_REMINDER_LEAD_DAYS -> TONE_DUE
            else -> TONE_MUTED
        }
    val base = shortDate(date, today) + " · " + relativeDays(days)
    return DefectDeadline(if (overdue) tr("defect_deadline_overdue") + " · " + base else base, tone, overdue, date)
}

/** One defect as a line of the list. */
data class DefectRow(
    val id: String,
    val number: Long,
    val title: String,
    val place: String,
    val status: String,
    val statusLabel: String,
    val statusTone: String,
    val severityLabel: String,
    val severityTone: String,
    val deadlineText: String,
    val deadlineTone: String,
    val commentCount: Int,
)

fun defectRow(
    defect: Defect,
    today: String,
): DefectRow {
    val deadline = defectDeadline(defect.deadlineDate, defect.status, today)
    return DefectRow(
        id = defect.id,
        number = defect.number,
        title = defect.title,
        place = defectPlace(defect.roomName, defect.assetName, defect.locationDetail),
        status = defect.status,
        statusLabel = defectStatusLabel(defect.status),
        statusTone = defectStatusTone(defect.status),
        severityLabel = defectSeverityLabel(defect.severity),
        severityTone = defectSeverityTone(defect.severity),
        deadlineText = deadline.text,
        deadlineTone = deadline.tone,
        commentCount = defect.commentCount.toInt(),
    )
}

/** One step of the progress line (open, reported, in progress, fixed or rejected); [state] is `done`, `current` or `todo`. */
data class DefectStep(
    val status: String,
    val label: String,
    val state: String,
    /** What the date means ("Entdeckt"); null when the step has no date. */
    val dateLabel: String?,
    val dateText: String?,
)

fun defectSteps(
    status: String,
    discoveredOn: String,
    reportedOn: String?,
    fixedOn: String?,
    today: String,
): List<DefectStep> {
    val steps = listOf("open", "reported", "in_progress", if (status == "rejected") "rejected" else "fixed")
    val current = steps.indexOf(status)
    return steps.mapIndexed { index, step ->
        val (dateLabel, date) =
            when {
                step == "open" -> tr("defect_step_discovered") to discoveredOn
                step == "reported" && reportedOn != null -> tr("defect_step_reported") to reportedOn
                step == "fixed" && fixedOn != null -> tr("defect_step_fixed") to fixedOn
                else -> null to null
            }
        DefectStep(
            status = step,
            label = defectStatusLabel(step),
            state =
                when {
                    index < current -> "done"
                    index == current -> "current"
                    else -> "todo"
                },
            dateLabel = dateLabel,
            dateText = date?.let { shortDate(it, today) },
        )
    }
}

/** A status the defect can move to; the [primary] ones are shown as buttons, the others in a menu. */
data class DefectAction(
    val status: String,
    val label: String,
    val primary: Boolean,
    val destructive: Boolean,
)

fun defectActionLabel(
    status: String,
    from: String,
): String =
    when (status) {
        "open" -> tr(if (from == "fixed" || from == "rejected") "defect_action_reopen" else "defect_action_back_to_open")
        "reported" -> tr("defect_action_reported")
        "in_progress" -> tr("defect_action_in_progress")
        "fixed" -> tr("defect_action_fixed")
        else -> tr("defect_action_rejected")
    }

/** The next logical step and the shortcut to "fixed" stay in reach; the rest is for the menu. */
fun defectActions(status: String): List<DefectAction> {
    val primary =
        when (status) {
            "fixed", "rejected" -> listOf("open")
            "open" -> listOf("reported", "fixed")
            "reported" -> listOf("in_progress", "fixed")
            else -> listOf("fixed")
        }
    return (DEFECT_TRANSITIONS[status] ?: emptyList()).map { target ->
        DefectAction(target, defectActionLabel(target, status), target in primary, target == "rejected")
    }
}

/** One entry of the history of a defect. [type] is `created`, `status`, `correspondence` or `comment`. */
data class DefectEventRow(
    val id: String,
    val type: String,
    /** "Anna hat den Status geändert". */
    val title: String,
    /** "vor 3 Tagen". */
    val relativeText: String,
    /** "12.01.2027, 14:30". */
    val absoluteText: String,
    val fromLabel: String?,
    val toLabel: String?,
    val fromTone: String,
    val toTone: String,
    val body: List<TextSegment>,
    /** The reference of a letter (a tracking number or a link), as text with links. */
    val reference: List<TextSegment>,
)

fun defectEventTitle(
    type: String,
    userName: String?,
): String {
    val user = userName ?: tr("defect_event_unknown_user")
    return when (type) {
        "correspondence" -> tr("defect_event_correspondence", "user" to user)
        "status" -> tr("defect_event_status", "user" to user)
        "created" -> tr("defect_event_created", "user" to user)
        else -> tr("defect_event_comment", "user" to user)
    }
}

fun defectEventRow(
    event: DefectEvent,
    timeZone: String,
): DefectEventRow =
    DefectEventRow(
        id = event.id,
        type = event.type,
        title = defectEventTitle(event.type, event.userName),
        relativeText = relativeInstant(event.at, timeZone),
        absoluteText = Dates.dateTime(event.at, timeZone),
        fromLabel = event.fromStatus?.let(::defectStatusLabel),
        toLabel = event.toStatus?.let(::defectStatusLabel),
        fromTone = event.fromStatus?.let(::defectStatusTone) ?: TONE_MUTED,
        toTone = event.toStatus?.let(::defectStatusTone) ?: TONE_MUTED,
        body = if (event.bodyMd.isBlank()) emptyList() else linkify(event.bodyMd),
        reference = event.externalRef?.takeIf { it.isNotBlank() }?.let(::linkify) ?: emptyList(),
    )

/** A label and its value on the detail screen. */
data class DefectFact(
    val label: String,
    val value: String,
    /** A small line under the value ("aus dem Übergabedatum"); empty for none. */
    val note: String = "",
)

/** The defect as the detail screen shows it. */
data class DefectView(
    val id: String,
    val number: Long,
    val numberLabel: String,
    val title: String,
    val status: String,
    val statusLabel: String,
    val statusTone: String,
    val severityLabel: String,
    val severityTone: String,
    val deadline: DefectDeadline,
    val closed: Boolean,
    val steps: List<DefectStep>,
    val roomId: String?,
    val roomName: String?,
    val assetId: String?,
    val assetName: String?,
    val facts: List<DefectFact>,
    val description: List<TextSegment>,
    val resolution: List<TextSegment>,
    /** The task that reminds of the deadline, while there is one. */
    val reminderTaskId: String?,
    val actions: List<DefectAction>,
    val timeline: List<DefectEventRow>,
    val deleteText: String,
)

fun defectView(
    defect: DefectDetail,
    today: String,
    timeZone: String,
): DefectView {
    val deadline = defectDeadline(defect.deadlineDate, defect.status, today)
    val facts = mutableListOf<DefectFact>()
    defect.locationDetail?.takeIf { it.isNotBlank() }?.let { facts += DefectFact(tr("defect_location_detail"), it) }
    facts += DefectFact(tr("defect_discovered_on"), Dates.format(defect.discoveredOn))
    defect.reportedOn?.let { facts += DefectFact(tr("defect_reported_on"), Dates.format(it)) }
    facts += DefectFact(tr("defect_responsible"), defect.responsibleContactName ?: tr("defect_responsible_none"))
    facts +=
        if (defect.deadlineDate != null) {
            DefectFact(
                tr("defect_deadline"),
                Dates.format(defect.deadlineDate),
                if (defect.deadlineSource == "handover") tr("defect_deadline_from_handover") else "",
            )
        } else {
            DefectFact(tr("defect_deadline"), tr("defect_deadline_none"))
        }
    defect.fixedOn?.let { facts += DefectFact(tr("defect_fixed_on"), Dates.format(it)) }
    facts += DefectFact(tr("defect_created"), Dates.dateTime(defect.createdAt, timeZone))
    return DefectView(
        id = defect.id,
        number = defect.number,
        numberLabel = tr("defect_number_label", "number" to defect.number),
        title = defect.title,
        status = defect.status,
        statusLabel = defectStatusLabel(defect.status),
        statusTone = defectStatusTone(defect.status),
        severityLabel = defectSeverityLabel(defect.severity),
        severityTone = defectSeverityTone(defect.severity),
        deadline = deadline,
        closed = !isActiveDefectStatus(defect.status),
        steps = defectSteps(defect.status, defect.discoveredOn, defect.reportedOn, defect.fixedOn, today),
        roomId = defect.roomId,
        roomName = defect.roomName,
        assetId = defect.assetId,
        assetName = defect.assetName,
        facts = facts,
        description = if (defect.descriptionMd.isBlank()) emptyList() else linkify(defect.descriptionMd),
        resolution = if (defect.resolutionMd.isBlank()) emptyList() else linkify(defect.resolutionMd),
        reminderTaskId = defect.reminderTaskId,
        actions = defectActions(defect.status),
        timeline = defect.events.sortedBy { it.at }.map { defectEventRow(it, timeZone) },
        deleteText = tr("defect_delete_description", "number" to defect.number, "title" to defect.title),
    )
}
