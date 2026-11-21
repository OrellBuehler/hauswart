package ch.orellbuehler.hauswart.feature.tasks

import ch.orellbuehler.hauswart.api.generated.Trigger
import ch.orellbuehler.hauswart.api.generated.TriggerCounterDeltaAutoCompleteOnReset
import ch.orellbuehler.hauswart.api.generated.TriggerCounterDeltaOrEvery
import ch.orellbuehler.hauswart.api.generated.TriggerIntervalAutoCompleteItem
import ch.orellbuehler.hauswart.api.generated.TriggerIntervalSeasonsItem
import ch.orellbuehler.hauswart.api.generated.TriggerStateConditionEstimateFrom
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

const val TRIGGER_INTERVAL = "interval"
const val TRIGGER_CALENDAR = "calendar"
const val TRIGGER_MIN_PER_PERIOD = "min_per_period"
const val TRIGGER_ONE_OFF = "one_off"
const val TRIGGER_WARRANTY = "warranty"
const val TRIGGER_COUNTER_DELTA = "counter_delta"
const val TRIGGER_STATE_CONDITION = "state_condition"
const val TRIGGER_HA_CALENDAR = "ha_calendar"

const val RULE_COUNTER_RESET = "counter_reset"
const val RULE_STATE_CHANGE = "state_change"

private const val MAX_RULES = 5
private const val MAX_SEASONS = 12

/** A different rhythm in some months of the year. Every field as typed. */
data class SeasonForm(
    val fromMonth: String = "11",
    val toMonth: String = "3",
    val every: String = "1",
    val unit: String = "month",
)

/** A rule that completes the task by itself when a reading does something. */
data class AutoCompleteRuleForm(
    val type: String = RULE_COUNTER_RESET,
    val entityId: String = "",
    val minDrop: String = "",
    val to: String = "",
    val from: String = "",
)

/**
 * The rhythm of a task as the form edits it: plain strings, a few lists, [type] says which fields count.
 * Screens read a field with [valueOf] and change it with [withField] (both by the field's name), so
 * that no screen has to copy this class. [toTrigger] checks it and builds the request's trigger.
 */
data class TriggerForm(
    val type: String = TRIGGER_INTERVAL,
    val startDate: String = "",
    // interval
    val every: String = "3",
    val unit: String = "month",
    val anchor: String = "completion",
    val seasons: List<SeasonForm> = emptyList(),
    // calendar
    val freq: String = "weekly",
    val interval: String = "1",
    val weekdays: List<String> = emptyList(),
    val dayMode: String = "day",
    val monthDay: String = "1",
    val nth: String = "1",
    val months: List<String> = emptyList(),
    val earlyDays: String = "",
    // min per period
    val period: String = "month",
    val count: String = "1",
    val remindFromFraction: String = "",
    // one off
    val date: String = "",
    // warranty
    val until: String = "",
    val extendedUntil: String = "",
    val leadDays: String = "",
    // counter
    val entityId: String = "",
    val threshold: String = "100",
    val counterUnit: String = "",
    val orEvery: Boolean = false,
    val orEveryEvery: String = "12",
    val orEveryUnit: String = "month",
    val legacyResetDrop: String = "",
    // state condition
    val op: String = "gt",
    val value: String = "",
    val forMinutes: String = "",
    val estimate: Boolean = false,
    val estimateEntityId: String = "",
    val estimateTarget: String = "",
    val estimateDirection: String = "down",
    // calendar of the smart home
    val offsetDays: String = "0",
    val summaryMatch: String = "",
    val time: String = "",
    val autoComplete: List<AutoCompleteRuleForm> = emptyList(),
) {
    /** True for the types that can complete themselves from a reading. */
    val hasAutoComplete: Boolean get() = type != TRIGGER_ONE_OFF && type != TRIGGER_WARRANTY

    /** The current value of a text field by name (booleans are "true" / "false"). */
    fun valueOf(field: String): String =
        when (field) {
            "type" -> type
            "startDate" -> startDate
            "every" -> every
            "unit" -> unit
            "anchor" -> anchor
            "freq" -> freq
            "interval" -> interval
            "dayMode" -> dayMode
            "monthDay" -> monthDay
            "nth" -> nth
            "earlyDays" -> earlyDays
            "period" -> period
            "count" -> count
            "remindFromFraction" -> remindFromFraction
            "date" -> date
            "until" -> until
            "extendedUntil" -> extendedUntil
            "leadDays" -> leadDays
            "entityId" -> entityId
            "threshold" -> threshold
            "counterUnit" -> counterUnit
            "orEvery" -> orEvery.toString()
            "orEveryEvery" -> orEveryEvery
            "orEveryUnit" -> orEveryUnit
            "legacyResetDrop" -> legacyResetDrop
            "op" -> op
            "value" -> value
            "forMinutes" -> forMinutes
            "estimate" -> estimate.toString()
            "estimateEntityId" -> estimateEntityId
            "estimateTarget" -> estimateTarget
            "estimateDirection" -> estimateDirection
            "offsetDays" -> offsetDays
            "summaryMatch" -> summaryMatch
            "time" -> time
            else -> ""
        }

    /** A copy with one field changed; changing the calendar's frequency also fixes the fields that depend on it. */
    fun withField(
        field: String,
        text: String,
    ): TriggerForm =
        when (field) {
            "startDate" -> copy(startDate = text)
            "every" -> copy(every = text)
            "unit" -> copy(unit = text)
            "anchor" -> copy(anchor = text)
            "freq" -> withFreq(text)
            "interval" -> copy(interval = text)
            "dayMode" -> withDayMode(text)
            "monthDay" -> copy(monthDay = text)
            "nth" -> copy(nth = text)
            "earlyDays" -> copy(earlyDays = text)
            "period" -> copy(period = text)
            "count" -> copy(count = text)
            "date" -> copy(date = text)
            "until" -> copy(until = text)
            "extendedUntil" -> copy(extendedUntil = text)
            "leadDays" -> copy(leadDays = text)
            "entityId" -> copy(entityId = text)
            "threshold" -> copy(threshold = text)
            "counterUnit" -> copy(counterUnit = text)
            "orEvery" -> copy(orEvery = text == "true")
            "orEveryEvery" -> copy(orEveryEvery = text)
            "orEveryUnit" -> copy(orEveryUnit = text)
            "legacyResetDrop" -> copy(legacyResetDrop = text)
            "op" -> copy(op = text)
            "value" -> copy(value = text)
            "forMinutes" -> copy(forMinutes = text)
            "estimate" ->
                copy(
                    estimate = text == "true",
                    estimateEntityId = if (text == "true") estimateEntityId else "",
                    estimateTarget = if (text == "true") estimateTarget else "",
                )
            "estimateEntityId" -> copy(estimateEntityId = text)
            "estimateTarget" -> copy(estimateTarget = text)
            "estimateDirection" -> copy(estimateDirection = text)
            "offsetDays" -> copy(offsetDays = text)
            "summaryMatch" -> copy(summaryMatch = text)
            else -> this
        }

    private fun startWeekday(): String = isoWeekdayOf(startDate).toString()

    private fun startDay(): String = (Dates.parse(startDate)?.day ?: 1).toString()

    private fun startMonth(): String = ((Dates.parse(startDate)?.month?.ordinal ?: 0) + 1).toString()

    private fun withFreq(next: String): TriggerForm =
        if (next == "weekly") {
            copy(freq = next, weekdays = weekdays.ifEmpty { listOf(startWeekday()) }, dayMode = "day", months = emptyList())
        } else {
            copy(
                freq = next,
                weekdays = if (dayMode == "nth") weekdays.take(1).ifEmpty { listOf(startWeekday()) } else emptyList(),
                monthDay = if (freq == "weekly") startDay() else monthDay,
                months = if (next == "yearly" && months.isEmpty()) listOf(startMonth()) else months,
            )
        }

    private fun withDayMode(next: String): TriggerForm =
        if (next == "nth") {
            copy(dayMode = "nth", nth = "1", weekdays = listOf(startWeekday()))
        } else {
            copy(dayMode = "day", monthDay = startDay(), weekdays = emptyList())
        }

    /** Adds or removes one weekday or month (a field `weekdays` or `months`); in nth mode a single weekday is chosen. */
    fun toggle(
        field: String,
        item: String,
    ): TriggerForm =
        when (field) {
            "weekdays" ->
                if (freq != "weekly") {
                    copy(weekdays = listOf(item))
                } else {
                    copy(weekdays = weekdays.toggled(item))
                }
            "months" -> copy(months = months.toggled(item))
            else -> this
        }

    /** Whether [item] is chosen in the list field `weekdays` or `months`. */
    fun isChosen(
        field: String,
        item: String,
    ): Boolean =
        when (field) {
            "weekdays" -> item in weekdays
            "months" -> item in months
            else -> false
        }

    fun addSeason(): TriggerForm = if (seasons.size >= MAX_SEASONS) this else copy(seasons = seasons + SeasonForm())

    fun removeSeason(index: Int): TriggerForm = copy(seasons = seasons.filterIndexed { i, _ -> i != index })

    fun withSeason(
        index: Int,
        field: String,
        text: String,
    ): TriggerForm =
        copy(
            seasons =
                seasons.mapIndexed { i, s ->
                    if (i != index) {
                        s
                    } else {
                        when (field) {
                            "fromMonth" -> s.copy(fromMonth = text)
                            "toMonth" -> s.copy(toMonth = text)
                            "every" -> s.copy(every = text)
                            "unit" -> s.copy(unit = text)
                            else -> s
                        }
                    }
                },
        )

    val canAddRule: Boolean get() = hasAutoComplete && autoComplete.size < MAX_RULES

    fun addRule(ruleType: String): TriggerForm =
        if (canAddRule) copy(autoComplete = autoComplete + AutoCompleteRuleForm(type = ruleType)) else this

    fun removeRule(index: Int): TriggerForm = copy(autoComplete = autoComplete.filterIndexed { i, _ -> i != index })

    fun withRule(
        index: Int,
        field: String,
        text: String,
    ): TriggerForm =
        copy(
            autoComplete =
                autoComplete.mapIndexed { i, r ->
                    if (i != index) {
                        r
                    } else {
                        when (field) {
                            "type" -> if (text == r.type) r else AutoCompleteRuleForm(type = text, entityId = r.entityId)
                            "entityId" -> r.copy(entityId = text)
                            "minDrop" -> r.copy(minDrop = text)
                            "to" -> r.copy(to = text)
                            "from" -> r.copy(from = text)
                            else -> r
                        }
                    }
                },
        )

    /** A quick choice of "every N unit" for the interval type. */
    fun withIntervalPreset(index: Int): TriggerForm =
        INTERVAL_PRESETS.getOrNull(index)?.let { copy(every = it.first.toString(), unit = it.second) } ?: this

    /** The index of the preset the interval matches, or -1. */
    fun activeIntervalPreset(): Int = INTERVAL_PRESETS.indexOfFirst { it.first.toString() == every.trim() && it.second == unit }

    /** True when the interval has options beyond "every N units" set, so that the extras show open. */
    fun hasIntervalExtras(today: String): Boolean =
        anchor == "schedule" || seasons.isNotEmpty() || (startDate.isNotEmpty() && startDate > today)
}

private val INTERVAL_PRESETS: List<Pair<Int, String>> = listOf(1 to "week", 1 to "month", 3 to "month", 6 to "month", 1 to "year")

fun intervalPresetOptions(): List<ChoiceOption> =
    listOf("weekly", "monthly", "quarterly", "half_yearly", "yearly").mapIndexed {
        i,
        key,
        ->
        ChoiceOption(i.toString(), tr("trigger_preset_$key"))
    }

private fun List<String>.toggled(item: String): List<String> =
    (if (item in this) this - item else this + item).sortedBy { it.toIntOrNull() ?: 0 }

/** A trigger type the form offers, with its explanation and whether it needs a smart-home connection to be useful. */
data class TriggerTypeOption(
    val value: String,
    val label: String,
    val hint: String,
    val advanced: Boolean,
)

val EDITABLE_TRIGGER_TYPES: List<String> =
    listOf(
        TRIGGER_INTERVAL,
        TRIGGER_CALENDAR,
        TRIGGER_MIN_PER_PERIOD,
        TRIGGER_ONE_OFF,
        TRIGGER_WARRANTY,
        TRIGGER_COUNTER_DELTA,
        TRIGGER_STATE_CONDITION,
        TRIGGER_HA_CALENDAR,
    )

private val ADVANCED_TRIGGER_TYPES = setOf(TRIGGER_COUNTER_DELTA, TRIGGER_STATE_CONDITION, TRIGGER_HA_CALENDAR)

fun triggerTypeOptions(): List<TriggerTypeOption> =
    EDITABLE_TRIGGER_TYPES.map { type ->
        val advanced = type in ADVANCED_TRIGGER_TYPES
        val label = tr("trigger_type_$type")
        TriggerTypeOption(
            type,
            if (advanced) "$label (${tr("trigger_advanced_badge")})" else label,
            tr("trigger_type_${type}_hint"),
            advanced,
        )
    }

fun unitOptions(): List<ChoiceOption> = TriggerIntervalSeasonsItem.UNIT_VALUES.map { ChoiceOption(it, tr("unit_$it")) }

fun anchorOptions(): List<ChoiceOption> = Trigger.Interval.ANCHOR_VALUES.map { ChoiceOption(it, tr("trigger_anchor_$it")) }

fun freqOptions(): List<ChoiceOption> = Trigger.Calendar.FREQ_VALUES.map { ChoiceOption(it, tr("trigger_freq_$it")) }

fun dayModeOptions(): List<ChoiceOption> =
    listOf(ChoiceOption("day", tr("trigger_day_mode_day")), ChoiceOption("nth", tr("trigger_day_mode_nth")))

fun periodOptions(): List<ChoiceOption> = Trigger.MinPerPeriod.PERIOD_VALUES.map { ChoiceOption(it, tr("trigger_period_${it}_option")) }

fun opOptions(): List<ChoiceOption> = Trigger.StateCondition.OP_VALUES.map { ChoiceOption(it, tr("trigger_op_option_$it")) }

fun directionOptions(): List<ChoiceOption> =
    TriggerStateConditionEstimateFrom.DIRECTION_VALUES.map { ChoiceOption(it, tr("trigger_estimate_$it")) }

fun ruleTypeOptions(): List<ChoiceOption> =
    listOf(RULE_COUNTER_RESET, RULE_STATE_CHANGE).map { ChoiceOption(it, tr("auto_complete_type_$it")) }

fun weekdayOptions(): List<ChoiceOption> = (1..7).map { ChoiceOption(it.toString(), weekdayShort(it)) }

fun monthOptions(): List<ChoiceOption> = (1..12).map { ChoiceOption(it.toString(), monthShort(it)) }

fun monthLongOptions(): List<ChoiceOption> = (1..12).map { ChoiceOption(it.toString(), monthName(it)) }

fun monthDayOptions(): List<ChoiceOption> =
    (1..31).map { ChoiceOption(it.toString(), ordinalDay(it)) } +
        listOf(ChoiceOption("-1", tr("trigger_day_last")), ChoiceOption("-2", tr("trigger_day_second_last")))

fun nthOptions(): List<ChoiceOption> =
    listOf(
        ChoiceOption("1", tr("trigger_nth_first")),
        ChoiceOption("2", tr("trigger_nth_second")),
        ChoiceOption("3", tr("trigger_nth_third")),
        ChoiceOption("4", tr("trigger_nth_fourth")),
        ChoiceOption("-1", tr("trigger_nth_last")),
    )

/** The label of the unit the calendar's "every N" counts in. */
fun calendarIntervalUnit(freq: String): String =
    tr(
        when (freq) {
            "monthly" -> "trigger_unit_months"
            "yearly" -> "trigger_unit_years"
            else -> "trigger_unit_weeks"
        },
    )

/** The form for a new trigger of [type], with the values the web starts with. */
fun defaultTriggerForm(
    type: String,
    today: String,
): TriggerForm =
    when (type) {
        TRIGGER_CALENDAR ->
            TriggerForm(type = type, freq = "weekly", interval = "1", weekdays = listOf(isoWeekdayOf(today).toString()), startDate = today)
        TRIGGER_MIN_PER_PERIOD -> TriggerForm(type = type, period = "month", count = "1")
        TRIGGER_ONE_OFF -> TriggerForm(type = type, date = Dates.addDays(today, 7))
        TRIGGER_WARRANTY -> TriggerForm(type = type, until = Dates.addDays(today, 365))
        TRIGGER_COUNTER_DELTA -> TriggerForm(type = type, threshold = "100")
        TRIGGER_STATE_CONDITION -> TriggerForm(type = type, op = "gt")
        TRIGGER_HA_CALENDAR -> TriggerForm(type = type, offsetDays = "0")
        else -> TriggerForm(type = TRIGGER_INTERVAL, every = "3", unit = "month", anchor = "completion", startDate = today)
    }

/** Switches the form to another type; the start date stays when both types have one. */
fun changeTriggerType(
    form: TriggerForm,
    type: String,
    today: String,
): TriggerForm {
    if (type == form.type) return form
    val next = defaultTriggerForm(type, today)
    val keepsStart = (type == TRIGGER_INTERVAL || type == TRIGGER_CALENDAR) && form.startDate.isNotEmpty()
    return if (keepsStart) next.copy(startDate = form.startDate) else next
}

/** The entity id of a counter that reads the odometer of [assetId]; a form field value. */
fun odometerCounterForm(
    form: TriggerForm,
    assetId: String,
    unit: String,
): TriggerForm = form.copy(entityId = odometerSignalKey(assetId), counterUnit = unit)

private fun ruleFormsOf(items: List<TriggerIntervalAutoCompleteItem>?): List<AutoCompleteRuleForm>? {
    val rules = items.orEmpty()
    val forms =
        rules.map { item ->
            when (item) {
                is TriggerIntervalAutoCompleteItem.CounterReset ->
                    AutoCompleteRuleForm(RULE_COUNTER_RESET, item.entityId, minDrop = plainNumber(item.minDrop))
                is TriggerIntervalAutoCompleteItem.StateChange ->
                    AutoCompleteRuleForm(RULE_STATE_CHANGE, item.entityId, to = item.to, from = item.from.orEmpty())
                TriggerIntervalAutoCompleteItem.Unknown -> return null
            }
        }
    return forms
}

/**
 * The form for an existing trigger, or null when this build cannot edit it (a trigger of a newer
 * server, one an integration manages, one with a rule it does not know). The task is then saved without
 * a trigger, so the server keeps its own.
 */
fun triggerFormOf(trigger: Trigger): TriggerForm? =
    when (trigger) {
        is Trigger.Interval ->
            ruleFormsOf(trigger.autoComplete)?.let { rules ->
                TriggerForm(
                    type = TRIGGER_INTERVAL,
                    every = trigger.every.toString(),
                    unit = trigger.unit,
                    anchor = trigger.anchor,
                    startDate = trigger.startDate,
                    seasons =
                        trigger.seasons.orEmpty().map {
                            SeasonForm(it.fromMonth.toString(), it.toMonth.toString(), it.every.toString(), it.unit)
                        },
                    autoComplete = rules,
                )
            }
        is Trigger.Calendar ->
            ruleFormsOf(trigger.autoComplete)?.let { rules ->
                TriggerForm(
                    type = TRIGGER_CALENDAR,
                    freq = trigger.freq,
                    interval = trigger.interval.toString(),
                    weekdays = trigger.byWeekday.orEmpty().map { it.toString() },
                    dayMode = if (trigger.nth != null) "nth" else "day",
                    monthDay = (trigger.byMonthDay ?: Dates.parse(trigger.startDate)?.day?.toLong() ?: 1L).toString(),
                    nth = (trigger.nth ?: 1L).toString(),
                    months = trigger.byMonth.orEmpty().map { it.toString() },
                    startDate = trigger.startDate,
                    earlyDays = trigger.earlyDays?.toString().orEmpty(),
                    autoComplete = rules,
                )
            }
        is Trigger.MinPerPeriod ->
            ruleFormsOf(trigger.autoComplete)?.let { rules ->
                TriggerForm(
                    type = TRIGGER_MIN_PER_PERIOD,
                    period = trigger.period,
                    count = trigger.count.toString(),
                    remindFromFraction = trigger.remindFromFraction?.let { plainNumber(it) }.orEmpty(),
                    startDate = trigger.startDate.orEmpty(),
                    autoComplete = rules,
                )
            }
        is Trigger.CounterDelta ->
            ruleFormsOf(trigger.autoComplete)?.let { rules ->
                TriggerForm(
                    type = TRIGGER_COUNTER_DELTA,
                    entityId = trigger.entityId,
                    threshold = plainNumber(trigger.threshold),
                    counterUnit = trigger.unit.orEmpty(),
                    orEvery = trigger.orEvery != null,
                    orEveryEvery = trigger.orEvery?.every?.toString() ?: "12",
                    orEveryUnit = trigger.orEvery?.unit ?: "month",
                    legacyResetDrop =
                        trigger.autoCompleteOnReset
                            ?.minDrop
                            ?.let { plainNumber(it) }
                            .orEmpty(),
                    autoComplete = rules,
                )
            }
        is Trigger.StateCondition ->
            ruleFormsOf(trigger.autoComplete)?.let { rules ->
                TriggerForm(
                    type = TRIGGER_STATE_CONDITION,
                    entityId = trigger.entityId,
                    op = trigger.op,
                    value = jsonValueText(trigger.value),
                    forMinutes = trigger.forMinutes?.toString().orEmpty(),
                    estimate = trigger.estimateFrom != null,
                    estimateEntityId = trigger.estimateFrom?.entityId.orEmpty(),
                    estimateTarget =
                        trigger.estimateFrom
                            ?.target
                            ?.let { plainNumber(it) }
                            .orEmpty(),
                    estimateDirection = trigger.estimateFrom?.direction ?: "down",
                    autoComplete = rules,
                )
            }
        is Trigger.HaCalendar ->
            ruleFormsOf(trigger.autoComplete)?.let { rules ->
                TriggerForm(
                    type = TRIGGER_HA_CALENDAR,
                    entityId = trigger.entityId,
                    summaryMatch = trigger.summaryMatch.orEmpty(),
                    offsetDays = trigger.offsetDays.toString(),
                    time = trigger.time.orEmpty(),
                    autoComplete = rules,
                )
            }
        is Trigger.OneOff -> TriggerForm(type = TRIGGER_ONE_OFF, date = trigger.date)
        is Trigger.Warranty ->
            TriggerForm(
                type = TRIGGER_WARRANTY,
                until = trigger.until,
                extendedUntil = trigger.extendedUntil.orEmpty(),
                leadDays = trigger.leadDays?.toString().orEmpty(),
            )
        is Trigger.KeptBill -> null
        Trigger.Unknown -> null
    }

/** The outcome of checking a [TriggerForm]: the trigger, or messages keyed by field name (`every`, `seasons.0.unit`, `autoComplete.1.to`). */
data class TriggerBuild(
    val trigger: Trigger?,
    val errors: Map<String, String>,
)

private val TIME = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")

private class Checker {
    val errors = mutableMapOf<String, String>()

    fun whole(
        key: String,
        text: String,
        min: Long,
        max: Long,
        required: Boolean = true,
    ): Long? {
        if (text.isBlank()) {
            if (required) errors[key] = tr("field_required")
            return null
        }
        val n = parseWhole(text)
        return when {
            n == null -> null.also { errors[key] = tr("field_number") }
            n < min -> null.also { errors[key] = tr("field_min", "min" to min) }
            n > max -> null.also { errors[key] = tr("field_max", "max" to max) }
            else -> n
        }
    }

    fun decimal(
        key: String,
        text: String,
        positive: Boolean = false,
    ): Double? {
        if (text.isBlank()) {
            errors[key] = tr("field_required")
            return null
        }
        val n = parseDecimal(text)
        return when {
            n == null -> null.also { errors[key] = tr("field_number") }
            positive && n <= 0.0 -> null.also { errors[key] = tr("field_greater_than", "min" to 0) }
            else -> n
        }
    }

    fun date(
        key: String,
        text: String,
        required: Boolean = true,
    ): String? {
        if (text.isBlank()) {
            if (required) errors[key] = tr("field_required")
            return null
        }
        if (!Dates.isValid(text.trim())) {
            errors[key] = tr("field_invalid_date")
            return null
        }
        return text.trim()
    }

    fun nonBlank(
        key: String,
        text: String,
    ): String? {
        if (text.isBlank()) {
            errors[key] = tr("field_required")
            return null
        }
        return text.trim()
    }

    fun unit(
        key: String,
        text: String,
    ): String? {
        if (text !in TriggerIntervalSeasonsItem.UNIT_VALUES) {
            errors[key] = tr("field_invalid")
            return null
        }
        return text
    }
}

private fun Checker.rules(forms: List<AutoCompleteRuleForm>): List<TriggerIntervalAutoCompleteItem>? {
    val built =
        forms.mapIndexedNotNull { i, rule ->
            val entity = nonBlank("autoComplete.$i.entityId", rule.entityId)
            if (rule.type == RULE_COUNTER_RESET) {
                val drop = decimal("autoComplete.$i.minDrop", rule.minDrop, positive = true)
                if (entity != null && drop != null) TriggerIntervalAutoCompleteItem.CounterReset(entity, drop) else null
            } else {
                val to = nonBlank("autoComplete.$i.to", rule.to)
                if (entity != null && to != null) {
                    TriggerIntervalAutoCompleteItem.StateChange(entity, to, rule.from.trim().ifEmpty { null })
                } else {
                    null
                }
            }
        }
    return built.takeIf { it.size == forms.size }?.ifEmpty { null }
}

private fun stateValue(text: String): JsonElement {
    val number = parseDecimal(text)
    return when {
        number == null -> JsonPrimitive(text.trim())
        number == kotlin.math.floor(number) && kotlin.math.abs(number) < 1e15 -> JsonPrimitive(number.toLong())
        else -> JsonPrimitive(number)
    }
}

private fun TriggerForm.buildInterval(c: Checker): Trigger? {
    val every = c.whole("every", every, 1, 3650)
    val unit = c.unit("unit", unit)
    if (anchor !in Trigger.Interval.ANCHOR_VALUES) c.errors["anchor"] = tr("field_invalid")
    val start = c.date("startDate", startDate)
    val seasons =
        seasons.mapIndexedNotNull { i, s ->
            val from = c.whole("seasons.$i.fromMonth", s.fromMonth, 1, 12)
            val to = c.whole("seasons.$i.toMonth", s.toMonth, 1, 12)
            val n = c.whole("seasons.$i.every", s.every, 1, 3650)
            val u = c.unit("seasons.$i.unit", s.unit)
            if (from != null && to != null && n != null && u != null) TriggerIntervalSeasonsItem(from, to, n, u) else null
        }
    val rules = c.rules(autoComplete)
    if (every == null || unit == null || start == null || seasons.size != this.seasons.size || c.errors.isNotEmpty()) return null
    return Trigger.Interval(
        every = every,
        unit = unit,
        anchor = anchor,
        startDate = start,
        seasons = seasons.ifEmpty { null },
        autoComplete = rules,
    )
}

private fun TriggerForm.buildCalendar(c: Checker): Trigger? {
    if (freq !in Trigger.Calendar.FREQ_VALUES) c.errors["freq"] = tr("field_invalid")
    val interval = c.whole("interval", interval, 1, 3650)
    val start = c.date("startDate", startDate)
    val early = earlyDays.takeIf { it.isNotBlank() }?.let { parseWhole(it) }?.takeIf { it in 0..366 }
    val days =
        weekdays
            .mapNotNull { parseWhole(it) }
            .filter { it in 1..7 }
            .toSortedSet()
            .toList()
    val chosenMonths =
        months
            .mapNotNull { parseWhole(it) }
            .filter { it in 1..12 }
            .toSortedSet()
            .toList()
            .ifEmpty { null }
    var byWeekday: List<Long>? = null
    var byMonthDay: Long? = null
    var nthValue: Long? = null
    if (freq == "weekly") {
        if (days.isEmpty()) c.errors["weekdays"] = tr("field_choose_one") else byWeekday = days
    } else if (dayMode == "nth") {
        nthValue = c.whole("nth", nth, -5, 5)
        if (nthValue == 0L) {
            c.errors["nth"] = tr("field_invalid")
        }
        if (days.isEmpty()) c.errors["weekdays"] = tr("field_choose_one") else byWeekday = days.take(1)
    } else {
        byMonthDay = c.whole("monthDay", monthDay, -31, 31)
        if (byMonthDay == 0L) c.errors["monthDay"] = tr("field_invalid")
    }
    val rules = c.rules(autoComplete)
    if (interval == null || start == null || c.errors.isNotEmpty()) return null
    return Trigger.Calendar(
        freq = freq,
        interval = interval,
        byWeekday = byWeekday,
        byMonthDay = byMonthDay,
        nth = nthValue,
        byMonth = if (freq == "weekly") null else chosenMonths,
        startDate = start,
        earlyDays = early,
        autoComplete = rules,
    )
}

private fun TriggerForm.buildCounter(c: Checker): Trigger? {
    val entity = c.nonBlank("entityId", entityId)
    val threshold = c.decimal("threshold", threshold, positive = true)
    var orEveryValue: TriggerCounterDeltaOrEvery? = null
    if (orEvery) {
        val n = c.whole("orEveryEvery", orEveryEvery, 1, 3650)
        val u = c.unit("orEveryUnit", orEveryUnit)
        if (n != null && u != null) orEveryValue = TriggerCounterDeltaOrEvery(n, u)
    }
    val legacy = parseDecimal(legacyResetDrop)?.takeIf { it > 0.0 }?.let { TriggerCounterDeltaAutoCompleteOnReset(it) }
    val rules = c.rules(autoComplete)
    if (entity == null || threshold == null || c.errors.isNotEmpty()) return null
    return Trigger.CounterDelta(
        entityId = entity,
        threshold = threshold,
        unit = counterUnit.trim().ifEmpty { null },
        orEvery = orEveryValue,
        autoCompleteOnReset = legacy,
        autoComplete = rules,
    )
}

private fun TriggerForm.buildState(c: Checker): Trigger? {
    val entity = c.nonBlank("entityId", entityId)
    if (op !in Trigger.StateCondition.OP_VALUES) c.errors["op"] = tr("field_invalid")
    val text = c.nonBlank("value", value)
    if (text != null && op != "eq" && op != "ne" && parseDecimal(text) == null) c.errors["value"] = tr("field_number")
    val minutes = c.whole("forMinutes", forMinutes, 0, Long.MAX_VALUE, required = false)
    var from: TriggerStateConditionEstimateFrom? = null
    if (estimate) {
        val estimateEntity = c.nonBlank("estimateEntityId", estimateEntityId)
        val target = c.decimal("estimateTarget", estimateTarget)
        if (estimateDirection !in TriggerStateConditionEstimateFrom.DIRECTION_VALUES) c.errors["estimateDirection"] = tr("field_invalid")
        if (estimateEntity != null && target != null) from = TriggerStateConditionEstimateFrom(estimateEntity, target, estimateDirection)
    }
    val rules = c.rules(autoComplete)
    if (entity == null || text == null || c.errors.isNotEmpty()) return null
    return Trigger.StateCondition(
        entityId = entity,
        op = op,
        value = stateValue(text),
        forMinutes = minutes,
        autoComplete = rules,
        estimateFrom = from,
    )
}

private fun TriggerForm.buildHaCalendar(c: Checker): Trigger? {
    val entity = c.nonBlank("entityId", entityId)
    val offset = c.whole("offsetDays", offsetDays, -366, 366)
    val rules = c.rules(autoComplete)
    if (entity == null || offset == null || c.errors.isNotEmpty()) return null
    return Trigger.HaCalendar(
        entityId = entity,
        summaryMatch = summaryMatch.trim().ifEmpty { null },
        offsetDays = offset,
        time = time.takeIf { TIME.matches(it) },
        autoComplete = rules,
    )
}

/** Checks the form like the server will and builds the trigger; [TriggerBuild.errors] is empty exactly when [TriggerBuild.trigger] is set. */
fun TriggerForm.toTrigger(): TriggerBuild {
    val c = Checker()
    val trigger: Trigger? =
        when (type) {
            TRIGGER_INTERVAL -> buildInterval(c)
            TRIGGER_CALENDAR -> buildCalendar(c)
            TRIGGER_MIN_PER_PERIOD -> {
                val n = c.whole("count", count, 1, 3650)
                if (period !in Trigger.MinPerPeriod.PERIOD_VALUES) c.errors["period"] = tr("field_invalid")
                val fraction = parseDecimal(remindFromFraction)?.takeIf { it in 0.0..1.0 }
                val start = startDate.takeIf { Dates.isValid(it) }
                val rules = c.rules(autoComplete)
                if (n == null ||
                    c.errors.isNotEmpty()
                ) {
                    null
                } else {
                    Trigger.MinPerPeriod(
                        period = period,
                        count = n,
                        remindFromFraction = fraction,
                        startDate = start,
                        autoComplete = rules,
                    )
                }
            }
            TRIGGER_ONE_OFF -> c.date("date", date)?.let { Trigger.OneOff(date = it) }
            TRIGGER_WARRANTY -> {
                val until = c.date("until", until)
                val extended = c.date("extendedUntil", extendedUntil, required = false)
                val lead = c.whole("leadDays", leadDays, 0, 3650, required = false)
                if (until == null ||
                    c.errors.isNotEmpty()
                ) {
                    null
                } else {
                    Trigger.Warranty(until = until, extendedUntil = extended, leadDays = lead)
                }
            }
            TRIGGER_COUNTER_DELTA -> buildCounter(c)
            TRIGGER_STATE_CONDITION -> buildState(c)
            TRIGGER_HA_CALENDAR -> buildHaCalendar(c)
            else -> null.also { c.errors[""] = tr("field_invalid") }
        }
    return if (c.errors.isEmpty() &&
        trigger != null
    ) {
        TriggerBuild(trigger, emptyMap())
    } else {
        TriggerBuild(null, c.errors.ifEmpty { mapOf("" to tr("field_invalid")) })
    }
}
