package ch.orellbuehler.hauswart.feature.recurring

import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.i18n.I18n
import ch.orellbuehler.hauswart.i18n.tr

/** The most entries one booking run makes for one recurring cost; the server and the form's preview agree on it. */
const val RECURRENCE_BOOKING_CAP = 120

/** How many dates the preview of a rule shows. */
const val PREVIEW_DATES = 3

private const val SCAN_LIMIT = 1200

/**
 * The rule of a recurring cost: an occurrence every [interval] months, quarters or years, counted from the month of
 * [startDate], on [dayOfMonth] (clamped to the end of a shorter month). Dates are plain `YYYY-MM-DD` strings.
 */
data class RecurrenceRule(
    val frequency: String,
    val interval: Int,
    val dayOfMonth: Int,
    val startDate: String,
    val endDate: String?,
)

private fun frequencyMonths(frequency: String): Int =
    when (frequency) {
        "quarterly" -> 3
        "yearly" -> 12
        else -> 1
    }

internal fun isLeapYear(year: Int): Boolean = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0

internal fun daysInMonth(
    year: Int,
    month: Int,
): Int =
    when (month) {
        2 -> if (isLeapYear(year)) 29 else 28
        4, 6, 9, 11 -> 30
        else -> 31
    }

private fun two(value: Int) = value.toString().padStart(2, '0')

internal fun isoDate(
    year: Int,
    month: Int,
    day: Int,
): String = "${year.toString().padStart(4, '0')}-${two(month)}-${two(day)}"

private fun yearOf(date: String) = date.take(4).toInt()

private fun monthOf(date: String) = date.drop(5).take(2).toInt()

private fun monthIndex(date: String) = yearOf(date) * 12 + (monthOf(date) - 1)

private fun stepOf(rule: RecurrenceRule) = frequencyMonths(rule.frequency) * rule.interval

private fun occurrence(
    rule: RecurrenceRule,
    k: Int,
): String {
    val total = monthIndex(rule.startDate) + k * stepOf(rule)
    val year = total.floorDiv(12)
    val month = total - year * 12 + 1
    return isoDate(year, month, minOf(rule.dayOfMonth, daysInMonth(year, month)))
}

private fun occurrenceAfter(
    rule: RecurrenceRule,
    after: String,
): String {
    val behind = monthIndex(after) - monthIndex(rule.startDate)
    var k = maxOf(0, behind.floorDiv(stepOf(rule)))
    while (occurrence(rule, k) <= after) k++
    return occurrence(rule, k)
}

/** The first occurrence strictly after [after], never before the start date; null once the end date is passed. */
fun nextOccurrenceAfter(
    rule: RecurrenceRule,
    after: String,
): String? {
    val floor = Dates.addDays(rule.startDate, -1)
    val next = occurrenceAfter(rule, if (after < floor) floor else after)
    val end = rule.endDate
    return if (end != null && next > end) null else next
}

/** The first occurrence of the series: on or after the start date. */
fun firstOccurrence(rule: RecurrenceRule): String? = nextOccurrenceAfter(rule, Dates.addDays(rule.startDate, -1))

/**
 * What is due on [today]: the occurrences after [lastBooked] (all of them for a series that never ran) up to and including
 * today, oldest first, at most [limit].
 */
fun dueOccurrences(
    rule: RecurrenceRule,
    lastBooked: String?,
    today: String,
    limit: Int = SCAN_LIMIT,
): List<String> {
    val out = mutableListOf<String>()
    var next = if (lastBooked == null) firstOccurrence(rule) else nextOccurrenceAfter(rule, lastBooked)
    while (next != null && next <= today && out.size < limit) {
        out += next
        next = nextOccurrenceAfter(rule, next)
    }
    return out
}

/** The next dates after [today] the rule books on, at most [count]. */
fun upcomingDates(
    rule: RecurrenceRule,
    today: String,
    count: Int = PREVIEW_DATES,
): List<String> {
    val dates = mutableListOf<String>()
    var next = nextOccurrenceAfter(rule, today)
    while (next != null && dates.size < count) {
        dates += next
        next = nextOccurrenceAfter(rule, next)
    }
    return dates
}

/** The months (1 to 12) in which the rule's day is not always there, so the booking falls on the last day instead. */
fun clampedMonths(rule: RecurrenceRule): List<Int> {
    val step = stepOf(rule)
    val start = monthOf(rule.startDate) - 1
    val booking = (0 until 12).map { (start + it * step) % 12 + 1 }.distinct().sorted()
    return booking.filter { month -> rule.dayOfMonth > daysInMonth(2027, month) || (month == 2 && rule.dayOfMonth == 29) }
}

private fun ordinalDay(day: Int): String {
    if (I18n.locale == "de") return "$day."
    val suffix =
        when {
            day % 100 in 11..13 -> "th"
            day % 10 == 1 -> "st"
            day % 10 == 2 -> "nd"
            day % 10 == 3 -> "rd"
            else -> "th"
        }
    return "$day$suffix"
}

private fun monthText(month: Int): String = tr("m_costs_month_$month")

private fun joinNames(names: List<String>): String =
    if (names.size <= 1) names.joinToString("") else names.dropLast(1).joinToString(", ") + " " + tr("m_recurring_and") + " " + names.last()

/** "Monatlich am 1.", "Alle 3 Monate am 15.", "Jährlich am 31. Januar" - the rule in words. */
fun ruleWording(rule: RecurrenceRule): String {
    val day = ordinalDay(rule.dayOfMonth)
    return when (rule.frequency) {
        "quarterly" -> tr("recurrence_rule_quarterly", "interval" to rule.interval, "day" to day)
        "yearly" ->
            tr(
                "recurrence_rule_yearly",
                "interval" to rule.interval,
                "dayNumber" to rule.dayOfMonth,
                "month" to monthText(monthOf(rule.startDate)),
            )
        else -> tr("recurrence_rule_monthly", "interval" to rule.interval, "day" to day)
    }
}

/** Why a rule with a day beyond the 28th books on the last day of some months; null for a day every month has. */
fun clampNote(rule: RecurrenceRule): String? {
    val months = clampedMonths(rule)
    if (months.isEmpty()) return null
    val day = ordinalDay(rule.dayOfMonth)
    if (rule.frequency == "monthly" && rule.interval == 1) return tr("recurrence_clamp_every_month", "day" to day)
    return tr("recurrence_clamp_some_months", "day" to day, "months" to joinNames(months.map(::monthText)))
}

/** `active`, `paused` or `finished`: a series without a next date is over, one switched off is paused. */
fun recurrenceStateOf(
    active: Boolean,
    nextDate: String?,
): String =
    when {
        nextDate == null -> "finished"
        active -> "active"
        else -> "paused"
    }

fun recurrenceStateLabel(state: String): String = tr("recurrence_state_$state")

/** Whether the next booking is due and only waits for the scheduler (or a tap on "book now"). */
fun isDue(
    active: Boolean,
    nextDate: String?,
    today: String,
): Boolean = active && nextDate != null && nextDate <= today

/** How many entries saving books at once, and since when. */
data class ImmediateBookings(
    val count: Int,
    val capped: Boolean,
    val first: String?,
)

fun immediateBookings(
    rule: RecurrenceRule,
    lastBooked: String?,
    today: String,
): ImmediateBookings {
    val due = dueOccurrences(rule, lastBooked, today, RECURRENCE_BOOKING_CAP + 1)
    return ImmediateBookings(minOf(due.size, RECURRENCE_BOOKING_CAP), due.size > RECURRENCE_BOOKING_CAP, due.firstOrNull())
}

/** The warning under the start date; null when saving books nothing at once. */
fun immediateWarning(
    bookings: ImmediateBookings,
    today: String,
): String? {
    val first = bookings.first
    if (bookings.count == 0 || first == null) return null
    if (first == today && bookings.count == 1) return tr("recurrence_immediate_today")
    val text = tr("recurrence_immediate", "count" to bookings.count, "date" to Dates.format(first))
    return if (bookings.capped) text + " " + tr("recurrence_immediate_capped", "max" to RECURRENCE_BOOKING_CAP) else text
}
