@file:OptIn(ExperimentalTime::class)

package ch.orellbuehler.hauswart.feature.files

import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.relativeDays
import ch.orellbuehler.hauswart.i18n.tr
import kotlin.time.Clock
import kotlin.time.ExperimentalTime
import kotlin.time.Instant

/** The current time in milliseconds; the one place the clock is read, so that formatting stays testable. */
fun nowMillis(): Long = Clock.System.now().toEpochMilliseconds()

/**
 * An instant as people say it: "just now", "5 minutes ago", "3 hours ago", then by calendar days in
 * [timeZone] ("yesterday", "3 days ago", "2 weeks ago"). [nowMs] is the time to compare with.
 */
fun relativeInstant(
    iso: String,
    timeZone: String,
    nowMs: Long = nowMillis(),
): String {
    val then = runCatching { Instant.parse(iso).toEpochMilliseconds() }.getOrNull() ?: return iso
    val minute = 60_000L
    val diff = nowMs - then
    return when {
        diff < minute -> tr("m_instant_now")
        diff < 60 * minute -> tr("m_instant_minutes_ago", "count" to (diff / minute))
        diff < 24 * 60 * minute -> tr("m_instant_hours_ago", "count" to (diff / (60 * minute)))
        else -> {
            val day = Dates.dateOf(iso, timeZone) ?: return iso
            val today = Dates.dateOf(Instant.fromEpochMilliseconds(nowMs).toString(), timeZone) ?: return iso
            relativeDays(Dates.diffDays(today, day))
        }
    }
}
