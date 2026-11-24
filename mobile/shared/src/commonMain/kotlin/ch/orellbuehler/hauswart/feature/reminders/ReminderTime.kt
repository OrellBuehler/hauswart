package ch.orellbuehler.hauswart.feature.reminders

import kotlinx.datetime.LocalDate
import kotlinx.datetime.LocalDateTime
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toInstant
import kotlinx.datetime.toLocalDateTime
import kotlin.time.ExperimentalTime
import kotlin.time.Instant

private fun zoneOf(timeZone: String): TimeZone = runCatching { TimeZone.of(timeZone) }.getOrDefault(TimeZone.UTC)

/**
 * The instant (milliseconds) of the wall-clock [time] (`HH:mm`) on [date] in [timeZone]. A time that
 * a spring forward skips lands after the gap; an ambiguous one in the night the clocks go back is
 * the first of the two. Null when [date] or [time] is not valid.
 */
@OptIn(ExperimentalTime::class)
internal fun zonedMillis(
    date: String,
    time: String,
    timeZone: String,
): Long? {
    val day = runCatching { LocalDate.parse(date) }.getOrNull() ?: return null
    val parts = time.split(':')
    val hour = parts.getOrNull(0)?.toIntOrNull() ?: return null
    val minute = parts.getOrNull(1)?.toIntOrNull() ?: return null
    if (parts.size != 2 || hour !in 0..23 || minute !in 0..59) return null
    return LocalDateTime(day.year, day.month.ordinal + 1, day.day, hour, minute).toInstant(zoneOf(timeZone)).toEpochMilliseconds()
}

/** The calendar date of an instant in [timeZone]. */
@OptIn(ExperimentalTime::class)
internal fun dateOfMillis(
    millis: Long,
    timeZone: String,
): String =
    Instant
        .fromEpochMilliseconds(millis)
        .toLocalDateTime(zoneOf(timeZone))
        .date
        .toString()

/** The wall-clock time `HH:mm` of an instant in [timeZone]. */
@OptIn(ExperimentalTime::class)
internal fun timeOfMillis(
    millis: Long,
    timeZone: String,
): String =
    Instant.fromEpochMilliseconds(millis).toLocalDateTime(zoneOf(timeZone)).let {
        it.hour.toString().padStart(2, '0') + ":" + it.minute.toString().padStart(2, '0')
    }

/** The instant of a UTC ISO string in milliseconds; null when it is not one. */
@OptIn(ExperimentalTime::class)
internal fun instantMillis(text: String): Long? = runCatching { Instant.parse(text).toEpochMilliseconds() }.getOrNull()
