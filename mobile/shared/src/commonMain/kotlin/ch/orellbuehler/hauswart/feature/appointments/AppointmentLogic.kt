@file:OptIn(ExperimentalTime::class)

package ch.orellbuehler.hauswart.feature.appointments

import ch.orellbuehler.hauswart.api.generated.Appointment
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.relativeDays
import ch.orellbuehler.hauswart.core.shortDate
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.datetime.DayOfWeek
import kotlinx.datetime.LocalDate
import kotlinx.datetime.LocalDateTime
import kotlinx.datetime.TimeZone
import kotlinx.datetime.atStartOfDayIn
import kotlinx.datetime.toInstant
import kotlinx.datetime.toLocalDateTime
import kotlin.math.abs
import kotlin.time.ExperimentalTime
import kotlin.time.Instant

/** The longest an appointment can last, in days (an all-day one counts its first and last day). */
const val MAX_APPOINTMENT_DAYS = 14

/** The length of a timed appointment created without an end. */
const val DEFAULT_APPOINTMENT_MINUTES = 60

const val APPOINTMENT_TITLE_MAX = 200
const val APPOINTMENT_LOCATION_MAX = 300
const val APPOINTMENT_NOTES_MAX = 5000

private const val DAY_MS = 86_400_000L
private const val HOUR_MS = 3_600_000L
private const val MINUTE_MS = 60_000L

/**
 * The longest a timed appointment can be, in real time: 14 days plus the hour that 14 calendar days
 * can have more when the clocks go back (the limit is about days, and the check has no time zone to
 * count them in). One that goes forward makes them an hour shorter, which is within it.
 */
internal const val MAX_TIMED_SPAN_MS = MAX_APPOINTMENT_DAYS * DAY_MS + HOUR_MS

/**
 * When an appointment takes place. A timed one has instants (milliseconds since the epoch, the end
 * after the start); an all-day one has calendar dates in the household time zone, the last day included.
 */
internal sealed interface ApptWhen {
    data class Timed(
        val startsAt: Long,
        val endsAt: Long,
    ) : ApptWhen

    data class AllDay(
        val startDate: String,
        val endDate: String,
    ) : ApptWhen
}

/** What is wrong with a span: the request field it is reported on and what is meant. */
internal data class WhenProblem(
    val field: String,
    val endBeforeStart: Boolean,
)

internal fun zoneOf(timeZone: String): TimeZone = runCatching { TimeZone.of(timeZone) }.getOrDefault(TimeZone.UTC)

private fun two(value: Int): String = value.toString().padStart(2, '0')

internal fun localOf(
    ms: Long,
    timeZone: String,
): LocalDateTime = Instant.fromEpochMilliseconds(ms).toLocalDateTime(zoneOf(timeZone))

internal fun localDateOf(
    ms: Long,
    timeZone: String,
): String = localOf(ms, timeZone).date.toString()

internal fun localTimeOf(
    ms: Long,
    timeZone: String,
): String = localOf(ms, timeZone).let { "${two(it.hour)}:${two(it.minute)}" }

/**
 * The instant (milliseconds) of the wall-clock time [date] `HH:MM` in [timeZone]. A time that a spring
 * forward skips lands after the gap (02:30 becomes 03:30); an ambiguous one in the night the clocks go
 * back is the first of the two.
 */
internal fun zonedTimeToInstant(
    date: String,
    time: String,
    timeZone: String,
): Long {
    val day = LocalDate.parse(date)
    val (hour, minute) = time.split(':').map { it.toInt() }
    return LocalDateTime(day.year, day.month.ordinal + 1, day.day, hour, minute).toInstant(zoneOf(timeZone)).toEpochMilliseconds()
}

/** An instant as the request wants it: UTC ISO with milliseconds. */
internal fun instantText(ms: Long): String {
    val text = Instant.fromEpochMilliseconds(ms).toString()
    return if ('.' in text) text else text.removeSuffix("Z") + ".000Z"
}

private fun instantMs(text: String?): Long? = text?.let { runCatching { Instant.parse(it).toEpochMilliseconds() }.getOrNull() }

/** The end an appointment gets when only its start is given. */
internal fun defaultEnd(startsAt: Long): Long = startsAt + DEFAULT_APPOINTMENT_MINUTES * MINUTE_MS

/** The span of [a]; a malformed one (never sent by the server) becomes an all-day one on the day it was made. */
internal fun whenOf(
    a: Appointment,
    timeZone: String,
): ApptWhen {
    if (a.allDay) {
        if (a.startDate != null && a.endDate != null) return ApptWhen.AllDay(a.startDate, a.endDate)
    } else {
        val start = instantMs(a.startsAt)
        val end = instantMs(a.endsAt)
        if (start != null && end != null) return ApptWhen.Timed(start, end)
    }
    val day = Dates.dateOf(a.createdAt, timeZone) ?: a.createdAt.take(10)
    return ApptWhen.AllDay(day, day)
}

/**
 * Null when the span is fine; the end must come after the start and the whole must not exceed 14 days
 * (a timed one: 14 calendar days in any zone, so up to an hour more in real time).
 */
internal fun whenProblem(span: ApptWhen): WhenProblem? =
    when (span) {
        is ApptWhen.AllDay ->
            when {
                span.endDate < span.startDate -> WhenProblem("endDate", true)
                Dates.diffDays(span.startDate, span.endDate) + 1 > MAX_APPOINTMENT_DAYS -> WhenProblem("endDate", false)
                else -> null
            }
        is ApptWhen.Timed ->
            when {
                span.endsAt <= span.startsAt -> WhenProblem("endsAt", true)
                span.endsAt - span.startsAt > MAX_TIMED_SPAN_MS -> WhenProblem("endsAt", false)
                else -> null
            }
    }

/** The first instant of the appointment: its start, or midnight of its first day in [timeZone]. */
internal fun startInstant(
    span: ApptWhen,
    timeZone: String,
): Long =
    when (span) {
        is ApptWhen.Timed -> span.startsAt
        is ApptWhen.AllDay -> midnight(span.startDate, timeZone)
    }

/** The first instant after the appointment: its end, or midnight after its last day in [timeZone]. */
internal fun endInstant(
    span: ApptWhen,
    timeZone: String,
): Long =
    when (span) {
        is ApptWhen.Timed -> span.endsAt
        is ApptWhen.AllDay -> midnight(Dates.addDays(span.endDate, 1), timeZone)
    }

private fun midnight(
    date: String,
    timeZone: String,
): Long = (Dates.parse(date) ?: LocalDate(1970, 1, 1)).atStartOfDayIn(zoneOf(timeZone)).toEpochMilliseconds()

/** The days an appointment covers and, if it is timed, its wall-clock times. */
internal data class ApptSpan(
    /** The first day, in the household zone. */
    val first: String,
    /** The last day it touches (an end at midnight belongs to the day before). */
    val last: String,
    /** `HH:MM`; null for an all-day appointment. */
    val startTime: String?,
    val endTime: String?,
)

internal fun spanOf(
    span: ApptWhen,
    timeZone: String,
): ApptSpan =
    when (span) {
        is ApptWhen.AllDay -> ApptSpan(span.startDate, span.endDate, null, null)
        is ApptWhen.Timed ->
            ApptSpan(
                first = localDateOf(span.startsAt, timeZone),
                last = localDateOf(span.endsAt - 1, timeZone),
                startTime = localTimeOf(span.startsAt, timeZone),
                endTime = localTimeOf(span.endsAt, timeZone),
            )
    }

internal fun spanOf(
    a: Appointment,
    timeZone: String,
): ApptSpan = spanOf(whenOf(a, timeZone), timeZone)

// ---- words -------------------------------------------------------------------------------------

private val weekdayKeys =
    mapOf(
        DayOfWeek.MONDAY to "m_appt_wd_mon",
        DayOfWeek.TUESDAY to "m_appt_wd_tue",
        DayOfWeek.WEDNESDAY to "m_appt_wd_wed",
        DayOfWeek.THURSDAY to "m_appt_wd_thu",
        DayOfWeek.FRIDAY to "m_appt_wd_fri",
        DayOfWeek.SATURDAY to "m_appt_wd_sat",
        DayOfWeek.SUNDAY to "m_appt_wd_sun",
    )

private fun weekdayShort(date: String): String = Dates.parse(date)?.let { tr(weekdayKeys.getValue(it.dayOfWeek)) }.orEmpty()

/** "Sa, 21.11." ("Sat, 21 Nov"), with the year when it is not this year. */
internal fun dayText(
    date: String,
    today: String,
): String = "${weekdayShort(date)}, ${shortDate(date, today)}".trimStart(',', ' ')

private fun capitalize(text: String): String = text.replaceFirstChar { it.uppercase() }

/** "Today", "Tomorrow" and "Yesterday" for the days around [today], else the short date with its weekday. */
internal fun dayLabel(
    date: String,
    today: String,
): String {
    val days = Dates.diffDays(today, date)
    return if (abs(days) <= 1) capitalize(relativeDays(days)) else dayText(date, today)
}

/** The heading of a day in a list: "Today · Sa, 21.11." around today, else "Mi, 25.11.". */
fun appointmentDayHeading(
    date: String,
    today: String,
): String = if (abs(Dates.diffDays(today, date)) <= 1) "${dayLabel(date, today)} · ${dayText(date, today)}" else dayText(date, today)

/**
 * When an appointment takes place as one line, in [timeZone]: "Sa, 21.11. · 09:00–10:00", across
 * midnight "Sa, 21.11., 23:00 – So, 22.11., 01:00", all-day "Sa, 21.11. – Mo, 23.11. · all day".
 */
internal fun formatWhen(
    span: ApptWhen,
    timeZone: String,
    today: String,
): String {
    val s = spanOf(span, timeZone)
    val start = s.startTime
    val end = s.endTime
    if (start == null || end == null) {
        val days = if (s.first == s.last) dayText(s.first, today) else "${dayText(s.first, today)} – ${dayText(s.last, today)}"
        return "$days · ${tr("appointment_all_day")}"
    }
    if (s.first == s.last) return "${dayText(s.first, today)} · $start–$end"
    return "${dayText(s.first, today)}, $start – ${dayText(s.last, today)}, $end"
}

internal fun formatWhen(
    a: Appointment,
    timeZone: String,
    today: String,
): String = formatWhen(whenOf(a, timeZone), timeZone, today)

/** The time of an appointment for a row below a day heading, in two lines ([secondary] is empty for none). */
data class ApptTime(
    val primary: String,
    val secondary: String,
)

/**
 * What a row below the heading of [day] says about the time: "09:00" over "–10:00", "all day". An
 * appointment of several days says on its first day when it ends ("until 23.11."); on a later day,
 * where an upcoming list shows what is still going on, it reads "Ongoing" and "until 01:00".
 */
internal fun timeColumn(
    span: ApptWhen,
    timeZone: String,
    today: String,
    day: String? = null,
): ApptTime {
    val s = spanOf(span, timeZone)
    val shown = day ?: s.first

    fun untilDay(date: String) = tr("appointment_until", "when" to shortDate(date, today))
    val start = s.startTime
    val end = s.endTime
    if (start == null || end == null) {
        return ApptTime(tr("appointment_all_day"), if (s.first == s.last) "" else untilDay(s.last))
    }
    if (shown != s.first) {
        return ApptTime(tr("appointment_ongoing"), if (s.last == shown) tr("appointment_until", "when" to end) else untilDay(s.last))
    }
    return ApptTime(start, if (s.first == s.last) "–$end" else untilDay(s.last))
}

/**
 * The start only, short enough for a badge: "Today, 09:00", "Mi, 25.11., 09:00", "Tomorrow". Given
 * the fields of a task's `nextAppointment` (or an appointment): timed ones have [startsAt], all-day
 * ones [startDate].
 */
fun formatAppointmentStart(
    allDay: Boolean,
    startsAt: String?,
    startDate: String?,
    timeZone: String,
    today: String,
): String {
    val ms = instantMs(startsAt)
    val day = if (allDay || ms == null) startDate.orEmpty() else localDateOf(ms, timeZone)
    if (day.isEmpty()) return ""
    val label = dayLabel(day, today)
    return if (allDay || ms == null) label else "$label, ${localTimeOf(ms, timeZone)}"
}

// ---- lists -------------------------------------------------------------------------------------

const val OPEN_LOOKBACK_DAYS = 30
const val PAST_WINDOW_DAYS = 365

val APPOINTMENT_STATUSES: List<String> = Appointment.STATUS_VALUES
val APPOINTMENT_VIEWS: List<String> = listOf("upcoming", "past")

fun appointmentStatusLabel(status: String): String = tr("appointment_status_$status")

/** Planned ones are what the upcoming view is about; the past view shows what became of them too. */
internal fun defaultStatuses(view: String): List<String> = if (view == "upcoming") listOf("planned") else APPOINTMENT_STATUSES

/** Switches a status on or off; the last one cannot be switched off. */
internal fun toggleStatus(
    statuses: List<String>,
    status: String,
): List<String> =
    when {
        status !in statuses -> APPOINTMENT_STATUSES.filter { it == status || it in statuses }
        statuses.size == 1 -> statuses
        else -> statuses.filter { it != status }
    }

/** The `GET /appointments` range of a view: the days from `first` to `last` (null for no end), both included. */
internal fun viewRange(
    view: String,
    today: String,
): Pair<String, String?> =
    if (view == "upcoming") {
        Dates.addDays(today, -OPEN_LOOKBACK_DAYS) to null
    } else {
        Dates.addDays(today, -PAST_WINDOW_DAYS) to Dates.addDays(today, -1)
    }

/** `more` appended to `base` without what `base` (or `more` itself) already has: the ranges meet at a day. */
internal fun appendById(
    base: List<Appointment>,
    more: List<Appointment>,
): List<Appointment> {
    val seen = base.mapTo(HashSet()) { it.id }
    return base + more.filter { seen.add(it.id) }
}

/** Whether the last day of the appointment, in the household zone, is before [today]. */
internal fun isOver(
    a: Appointment,
    today: String,
    timeZone: String,
): Boolean = spanOf(a, timeZone).last < today

/** Over and neither done nor cancelled: whoever planned it still has to close it. */
internal fun needsClosing(
    a: Appointment,
    today: String,
    timeZone: String,
): Boolean = a.status == "planned" && isOver(a, today, timeZone)

/** Soonest first: by the first instant, longer first, then title and id, as the server orders them. */
internal fun compareByStart(timeZone: String): Comparator<Appointment> =
    Comparator { a, b ->
        val wa = whenOf(a, timeZone)
        val wb = whenOf(b, timeZone)
        startInstant(wa, timeZone).compareTo(startInstant(wb, timeZone)).takeIf { it != 0 }
            ?: endInstant(wb, timeZone).compareTo(endInstant(wa, timeZone)).takeIf { it != 0 }
            ?: a.title.compareTo(b.title, ignoreCase = true).takeIf { it != 0 }
            ?: a.id.compareTo(b.id)
    }

internal data class DayGroup(
    val date: String,
    val items: List<Appointment>,
)

/**
 * Appointments grouped by the day they start on in the household zone, soonest first (or the other
 * way round with [newestFirst]). With [clampTo], one that started before that day and is still going
 * belongs to that day: an upcoming list shows what takes place today under "today".
 */
internal fun groupByDay(
    items: List<Appointment>,
    timeZone: String,
    clampTo: String? = null,
    newestFirst: Boolean = false,
): List<DayGroup> {
    val sorted = items.sortedWith(compareByStart(timeZone)).let { if (newestFirst) it.reversed() else it }
    val groups = LinkedHashMap<String, MutableList<Appointment>>()
    for (item in sorted) {
        var date = spanOf(item, timeZone).first
        if (clampTo != null && date < clampTo) date = clampTo
        groups.getOrPut(date) { mutableListOf() } += item
    }
    val days = groups.keys.sorted().let { if (newestFirst) it.reversed() else it }
    return days.map { DayGroup(it, groups.getValue(it)) }
}

internal data class ApptSections(
    /** Planned and over: still to be closed. Oldest first. */
    val open: List<Appointment>,
    val days: List<DayGroup>,
) {
    val count: Int get() = open.size + days.sumOf { it.items.size }
}

/**
 * What the list shows for a view and the statuses switched on. Upcoming: what is not over yet by day,
 * and the planned ones that are over as "open"; done or cancelled ones that are over belong to the
 * past view. Past: everything that is over, newest first.
 */
internal fun sectionsFor(
    appointments: List<Appointment>,
    view: String,
    statuses: List<String>,
    today: String,
    timeZone: String,
): ApptSections {
    val wanted = appointments.filter { it.status in statuses }

    fun over(a: Appointment) = isOver(a, today, timeZone)
    if (view == "past") {
        return ApptSections(emptyList(), groupByDay(wanted.filter(::over), timeZone, newestFirst = true))
    }
    return ApptSections(
        open = wanted.filter { it.status == "planned" && over(it) }.sortedWith(compareByStart(timeZone)),
        days = groupByDay(wanted.filterNot(::over), timeZone, clampTo = today),
    )
}
