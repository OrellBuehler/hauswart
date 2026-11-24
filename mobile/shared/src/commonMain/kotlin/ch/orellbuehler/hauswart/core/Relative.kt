package ch.orellbuehler.hauswart.core

import ch.orellbuehler.hauswart.i18n.tr
import kotlin.math.abs
import kotlin.math.roundToInt

/** "today", "in 3 days", "2 weeks ago": [days] is the distance from today, negative in the past. */
fun relativeDays(days: Int): String {
    val past = days < 0
    val n = abs(days)
    return when {
        days == 0 -> tr("m_relative_today")
        days == 1 -> tr("m_relative_tomorrow")
        days == -1 -> tr("m_relative_yesterday")
        n < 14 -> tr(if (past) "m_relative_days_ago" else "m_relative_in_days", "count" to n)
        n < 60 -> tr(if (past) "m_relative_weeks_ago" else "m_relative_in_weeks", "count" to (n / 7.0).roundToInt())
        n < 730 -> tr(if (past) "m_relative_months_ago" else "m_relative_in_months", "count" to (n / 30.4375).roundToInt())
        else -> tr(if (past) "m_relative_years_ago" else "m_relative_in_years", "count" to (n / 365.25).roundToInt())
    }
}

/** A date as it stands in a list: without the year while it is this year. */
fun shortDate(
    date: String,
    today: String,
): String = if (date.take(4) == today.take(4)) Dates.short(date) else Dates.format(date)

/** "in 3 days · 24 Nov", with a leading "~ " for a date the server estimated. */
fun dueText(
    date: String,
    today: String,
    estimated: Boolean = false,
): String = (if (estimated) "~ " else "") + relativeDays(Dates.diffDays(today, date)) + " · " + shortDate(date, today)
