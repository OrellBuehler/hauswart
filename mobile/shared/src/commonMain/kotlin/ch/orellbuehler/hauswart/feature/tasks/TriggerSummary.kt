package ch.orellbuehler.hauswart.feature.tasks

import ch.orellbuehler.hauswart.api.generated.Trigger
import ch.orellbuehler.hauswart.api.generated.TriggerIntervalSeasonsItem
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.formatNumber
import ch.orellbuehler.hauswart.core.monthName
import ch.orellbuehler.hauswart.core.weekdayName
import ch.orellbuehler.hauswart.i18n.I18n
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.datetime.isoDayNumber
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

fun ordinalDay(day: Int): String {
    if (I18n.locale == "de") return "$day."
    val suffix =
        when {
            day % 10 == 1 && day % 100 != 11 -> "st"
            day % 10 == 2 && day % 100 != 12 -> "nd"
            day % 10 == 3 && day % 100 != 13 -> "rd"
            else -> "th"
        }
    return "$day$suffix"
}

/** "A, B and C" / "A, B und C". */
fun joinList(items: List<String>): String {
    val and = tr("m_tasks_list_and")
    return when (items.size) {
        0 -> ""
        1 -> items[0]
        else -> items.dropLast(1).joinToString(", ") + " $and " + items.last()
    }
}

/** The ISO weekday (1 = Monday) of a `YYYY-MM-DD` date. */
fun isoWeekdayOf(date: String): Int = Dates.parse(date)?.dayOfWeek?.isoDayNumber ?: 1

private fun lowerFirst(text: String): String = text.replaceFirstChar { it.lowercase() }

private fun every(
    unit: String,
    n: Long,
): String = if (unit in TriggerIntervalSeasonsItem.UNIT_VALUES) tr("trigger_every_$unit", "n" to n) else "$n $unit"

private fun months(values: List<Long>): String = joinList(values.distinct().sorted().map { monthName(it.toInt()) })

private fun weekdays(values: List<Long>): String = joinList(values.distinct().sorted().map { weekdayName(it.toInt()) })

/** The text of a JSON value of a state condition: a number without a needless ".0", else the text. */
fun jsonValueText(value: JsonElement): String {
    val primitive = value as? JsonPrimitive ?: return value.toString()
    if (primitive.isString) return primitive.content
    val number = primitive.doubleOrNull ?: return primitive.content
    return plainNumber(number)
}

private fun describeInterval(t: Trigger.Interval): String {
    val every = every(t.unit, t.every)
    val base =
        if (t.anchor == "completion") {
            tr("trigger_interval_completion", "every" to every)
        } else {
            tr("trigger_interval_schedule", "every" to every, "date" to Dates.format(t.startDate))
        }
    val seasons =
        t.seasons.orEmpty().map { s ->
            tr(
                "trigger_season",
                "from" to monthName(s.fromMonth.toInt()),
                "to" to monthName(s.toMonth.toInt()),
                "every" to lowerFirst(every(s.unit, s.every)),
            )
        }
    return (listOf(base) + seasons).joinToString("; ")
}

private fun nthWord(nth: Long): String {
    val n = nth.toInt()
    return when {
        n in 1..5 -> tr("trigger_nth_$n")
        n in -5..-1 -> tr("trigger_nth_last_${-n}")
        else -> tr("trigger_nth_1")
    }
}

private fun describeDay(t: Trigger.Calendar): String {
    if (t.nth != null) {
        val days = t.byWeekday ?: listOf(isoWeekdayOf(t.startDate).toLong())
        return tr("trigger_cal_nth", "nth" to nthWord(t.nth), "weekday" to weekdays(days))
    }
    val day = (t.byMonthDay ?: (Dates.parse(t.startDate)?.day ?: 1).toLong()).toInt()
    return if (day < 0) tr("trigger_cal_day_last", "pos" to (-day).toString()) else tr("trigger_cal_day", "day" to ordinalDay(day))
}

private fun describeCalendar(t: Trigger.Calendar): String {
    if (t.freq == "weekly") {
        val days = weekdays(t.byWeekday ?: listOf(isoWeekdayOf(t.startDate).toLong()))
        return if (t.interval ==
            1L
        ) {
            tr("trigger_cal_weekly_1", "days" to days)
        } else {
            tr("trigger_cal_weekly_n", "n" to t.interval, "days" to days)
        }
    }
    val day = describeDay(t)
    if (t.freq == "monthly") {
        val base =
            if (t.interval ==
                1L
            ) {
                tr("trigger_cal_monthly_1", "day" to day)
            } else {
                tr("trigger_cal_monthly_n", "n" to t.interval, "day" to day)
            }
        return t.byMonth?.let { tr("trigger_cal_only_months", "base" to base, "months" to months(it)) } ?: base
    }
    val yearMonths = months(t.byMonth ?: listOf((Dates.parse(t.startDate)?.month?.ordinal ?: 0).toLong() + 1))
    return if (t.interval == 1L) {
        tr("trigger_cal_yearly_1", "day" to day, "months" to yearMonths)
    } else {
        tr("trigger_cal_yearly_n", "n" to t.interval, "day" to day, "months" to yearMonths)
    }
}

/** A trigger in plain words, e.g. "Every 3 months from the last completion". */
fun describeTrigger(trigger: Trigger): String =
    when (trigger) {
        is Trigger.Interval -> describeInterval(trigger)
        is Trigger.Calendar -> describeCalendar(trigger)
        is Trigger.MinPerPeriod ->
            tr(
                "trigger_min_per_period",
                "count" to trigger.count,
                "period" to
                    if (trigger.period in Trigger.MinPerPeriod.PERIOD_VALUES) tr("trigger_period_${trigger.period}") else trigger.period,
            )
        is Trigger.CounterDelta -> {
            val threshold = formatNumber(trigger.threshold)
            val odometer = odometerAssetOf(trigger) != null
            val unit = trigger.unit
            val base =
                when {
                    unit.isNullOrEmpty() ->
                        tr(if (odometer) "trigger_counter_odometer_plain" else "trigger_counter", "threshold" to threshold)
                    else ->
                        tr(if (odometer) "trigger_counter_odometer" else "trigger_counter_unit", "threshold" to threshold, "unit" to unit)
                }
            trigger.orEvery?.let {
                tr("trigger_counter_or_every", "base" to base, "every" to lowerFirst(every(it.unit, it.every)))
            } ?: base
        }
        is Trigger.StateCondition -> {
            val base =
                tr(
                    "trigger_state",
                    "entity" to trigger.entityId,
                    "op" to if (trigger.op in Trigger.StateCondition.OP_VALUES) tr("trigger_op_${trigger.op}") else trigger.op,
                    "value" to jsonValueText(trigger.value),
                )
            val minutes = trigger.forMinutes
            if (minutes != null && minutes > 0) tr("trigger_state_for", "base" to base, "minutes" to minutes) else base
        }
        is Trigger.HaCalendar -> {
            val days = kotlin.math.abs(trigger.offsetDays)
            val base =
                when {
                    trigger.offsetDays == 0L -> tr("trigger_ha_calendar_same")
                    trigger.offsetDays < 0 -> tr("trigger_ha_calendar_before", "days" to days)
                    else -> tr("trigger_ha_calendar_after", "days" to days)
                }
            trigger.summaryMatch?.takeIf { it.isNotEmpty() }?.let { tr("trigger_ha_calendar_match", "base" to base, "match" to it) } ?: base
        }
        is Trigger.OneOff -> tr("trigger_one_off", "date" to Dates.format(trigger.date))
        is Trigger.KeptBill -> tr("trigger_bill", "date" to Dates.format(trigger.dueDate))
        is Trigger.Warranty ->
            trigger.extendedUntil?.let {
                tr("trigger_warranty_extended", "until" to Dates.format(trigger.until), "extended" to Dates.format(it))
            } ?: tr("trigger_warranty", "until" to Dates.format(trigger.until))
        Trigger.Unknown -> tr("m_tasks_trigger_unknown")
    }
