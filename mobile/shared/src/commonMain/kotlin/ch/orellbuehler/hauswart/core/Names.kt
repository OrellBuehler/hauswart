package ch.orellbuehler.hauswart.core

import ch.orellbuehler.hauswart.i18n.I18n
import ch.orellbuehler.hauswart.i18n.tr
import kotlin.math.abs
import kotlin.math.roundToLong

/** "January", 1 to 12. */
fun monthName(month: Int): String = tr("m_month_long_$month")

/** "Jan", 1 to 12. */
fun monthShort(month: Int): String = tr("m_month_short_$month")

/** "Monday", 1 (Monday) to 7. */
fun weekdayName(day: Int): String = tr("m_weekday_long_$day")

/** "Mon", 1 (Monday) to 7. */
fun weekdayShort(day: Int): String = tr("m_weekday_short_$day")

/** Up to two decimals and grouped like the web ("15'000" and "250.5" in German, "15,000" in English). */
fun formatNumber(value: Double): String {
    if (!value.isFinite()) return value.toString()
    val scaled = abs(value * 100).roundToLong()
    val whole = (scaled / 100).toString()
    val fraction = (scaled % 100).toString().padStart(2, '0').trimEnd('0')
    val separator = if (I18n.locale == "de") "'" else ","
    val grouped =
        whole
            .reversed()
            .chunked(3)
            .joinToString(separator)
            .reversed()
    val sign = if (value < 0 && scaled != 0L) "-" else ""
    return sign + grouped + if (fraction.isEmpty()) "" else ".$fraction"
}
