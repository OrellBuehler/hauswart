@file:OptIn(ExperimentalTime::class)

package ch.orellbuehler.hauswart.core

import ch.orellbuehler.hauswart.i18n.I18n
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.daysUntil
import kotlinx.datetime.plus
import kotlinx.datetime.toLocalDateTime
import kotlin.math.abs
import kotlin.time.Clock
import kotlin.time.ExperimentalTime
import kotlin.time.Instant

/** Amounts are integers in minor units plus an ISO 4217 code, as on the server. Never floats. */
object Money {
    private val zeroDecimals =
        setOf("BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF")
    private val threeDecimals = setOf("BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND")

    fun exponent(currency: String): Int =
        when (currency.uppercase()) {
            in zeroDecimals -> 0
            in threeDecimals -> 3
            else -> 2
        }

    /** "CHF 1'234.50" in German (Swiss grouping), "CHF 1,234.50" in English. */
    fun format(
        minor: Long,
        currency: String,
    ): String = "${currency.uppercase()} ${number(minor, currency, grouped = true)}"

    /** The amount without the currency, grouped: "1'234.50". */
    fun plain(
        minor: Long,
        currency: String,
    ): String = number(minor, currency, grouped = true)

    /** The amount as a person types it into a field: "1234.50". */
    fun toInput(
        minor: Long,
        currency: String,
    ): String = number(minor, currency, grouped = false)

    /** Parses "1'234.50", "1 234,50" or "-12.3"; null when it is not an amount of this currency. */
    fun parse(
        input: String,
        currency: String,
    ): Long? {
        val decimals = exponent(currency)
        val cleaned = input.trim().filterNot { it == ' ' || it == '\'' || it == '’' || it == ' ' }
        val match = Regex("^([+-])?(\\d+)(?:[.,](\\d+))?$").matchEntire(cleaned) ?: return null
        val (sign, whole, fraction) = match.destructured
        if (fraction.length > decimals || whole.length > 15) return null
        var scale = 1L
        repeat(decimals) { scale *= 10 }
        val value = whole.toLong() * scale + (fraction.padEnd(decimals, '0').ifEmpty { "0" }).toLong()
        return if (sign == "-") -value else value
    }

    private fun number(
        minor: Long,
        currency: String,
        grouped: Boolean,
    ): String {
        val decimals = exponent(currency)
        var scale = 1L
        repeat(decimals) { scale *= 10 }
        val whole = (abs(minor) / scale).toString()
        val separator = if (I18n.locale == "de") "'" else ","
        val wholeText =
            if (grouped) {
                whole
                    .reversed()
                    .chunked(3)
                    .joinToString(separator)
                    .reversed()
            } else {
                whole
            }
        val fraction = if (decimals == 0) "" else "." + (abs(minor) % scale).toString().padStart(decimals, '0')
        return (if (minor < 0) "-" else "") + wholeText + fraction
    }
}

/**
 * Calendar dates are `YYYY-MM-DD` strings in the household's time zone and instants are UTC ISO
 * strings, as on the server. Never derive a date from the device's zone: use [today] with the
 * household's zone ([ch.orellbuehler.hauswart.HouseholdContext.today]).
 */
object Dates {
    private val monthsEn = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

    fun today(timeZone: String): String =
        Clock.System
            .now()
            .toLocalDateTime(zone(timeZone))
            .date
            .toString()

    fun parse(date: String): LocalDate? = runCatching { LocalDate.parse(date) }.getOrNull()

    fun isValid(date: String): Boolean = parse(date) != null

    fun addDays(
        date: String,
        days: Int,
    ): String = parse(date)?.plus(DatePeriod(days = days))?.toString() ?: date

    /** Days from [from] to [to]; negative when [to] is earlier. 0 when either is not a date. */
    fun diffDays(
        from: String,
        to: String,
    ): Int {
        val a = parse(from) ?: return 0
        val b = parse(to) ?: return 0
        return a.daysUntil(b)
    }

    /** "21.11.2026" in German, "21 Nov 2026" in English. */
    fun format(date: String): String {
        val d = parse(date) ?: return date
        return if (I18n.locale == "de") {
            "${two(d.day)}.${two(d.month.ordinal + 1)}.${d.year}"
        } else {
            "${d.day} ${monthsEn[d.month.ordinal]} ${d.year}"
        }
    }

    /** Without the year: "21.11." / "21 Nov". */
    fun short(date: String): String {
        val d = parse(date) ?: return date
        return if (I18n.locale == "de") "${two(d.day)}.${two(d.month.ordinal + 1)}." else "${d.day} ${monthsEn[d.month.ordinal]}"
    }

    /** An instant (`2026-11-21T13:30:00.000Z`) as date and time in [timeZone]: "21.11.2026, 14:30". */
    fun dateTime(
        instant: String,
        timeZone: String,
    ): String {
        val local = runCatching { Instant.parse(instant).toLocalDateTime(zone(timeZone)) }.getOrNull() ?: return instant
        return "${format(local.date.toString())}, ${two(local.hour)}:${two(local.minute)}"
    }

    /** The calendar date of an instant in [timeZone]. */
    fun dateOf(
        instant: String,
        timeZone: String,
    ): String? =
        runCatching {
            Instant
                .parse(instant)
                .toLocalDateTime(zone(timeZone))
                .date
                .toString()
        }.getOrNull()

    /** The wall-clock time ("14:30") of an instant in [timeZone]. */
    fun timeOf(
        instant: String,
        timeZone: String,
    ): String? =
        runCatching {
            val local = Instant.parse(instant).toLocalDateTime(zone(timeZone))
            "${two(local.hour)}:${two(local.minute)}"
        }.getOrNull()

    private fun zone(timeZone: String): TimeZone = runCatching { TimeZone.of(timeZone) }.getOrDefault(TimeZone.UTC)

    private fun two(value: Int): String = value.toString().padStart(2, '0')
}
