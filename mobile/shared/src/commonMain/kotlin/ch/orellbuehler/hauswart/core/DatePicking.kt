@file:OptIn(ExperimentalTime::class)

package ch.orellbuehler.hauswart.core

import kotlinx.datetime.TimeZone
import kotlinx.datetime.atStartOfDayIn
import kotlinx.datetime.toLocalDateTime
import kotlin.time.ExperimentalTime
import kotlin.time.Instant

/** What a date picker reports (midnight UTC of the chosen day, in milliseconds) as a `YYYY-MM-DD` date. */
fun dateOfPickerMillis(millis: Long): String =
    Instant
        .fromEpochMilliseconds(millis)
        .toLocalDateTime(TimeZone.UTC)
        .date
        .toString()

/** The value a date picker starts with for [date]; null when it is not a date. */
fun pickerMillisOf(date: String): Long? = Dates.parse(date)?.atStartOfDayIn(TimeZone.UTC)?.toEpochMilliseconds()

/**
 * The years a date picker offers: 1900 to 2100, widened to [initial]'s year when a stored date lies
 * outside (the server takes any year; a picker whose state starts outside its range throws).
 */
fun pickerYearRange(initial: String): IntRange {
    val year = Dates.parse(initial)?.year ?: return 1900..2100
    return minOf(1900, year)..maxOf(2100, year)
}
