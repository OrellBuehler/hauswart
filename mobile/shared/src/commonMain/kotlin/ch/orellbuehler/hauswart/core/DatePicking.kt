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
