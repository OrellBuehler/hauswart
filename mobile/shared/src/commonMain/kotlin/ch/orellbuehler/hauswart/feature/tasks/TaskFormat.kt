package ch.orellbuehler.hauswart.feature.tasks

import ch.orellbuehler.hauswart.api.generated.Completion
import ch.orellbuehler.hauswart.api.generated.Preparation
import ch.orellbuehler.hauswart.api.generated.Task
import ch.orellbuehler.hauswart.api.generated.Trigger
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.datetime.toInstant
import kotlin.math.abs
import kotlin.random.Random

/** A value of a dropdown or a chip group with the text to show. */
data class ChoiceOption(
    val value: String,
    val label: String,
)

/** A number as a person edits it: "15000", "2.5". */
fun plainNumber(value: Double): String =
    if (value.isFinite() && value == kotlin.math.floor(value) && abs(value) < 1e15) value.toLong().toString() else value.toString()

private val INTEGER = Regex("^[+-]?\\d+$")
private val DECIMAL = Regex("^[+-]?(\\d+(\\.\\d*)?|\\.\\d+)$")

/** A whole number from a field, null when the text is no whole number. */
fun parseWhole(text: String): Long? {
    val cleaned = text.trim()
    return if (INTEGER.matches(cleaned)) cleaned.removePrefix("+").toLongOrNull() else null
}

/** A decimal from a field ("2,5" and "2.5" both work), null when the text is no finite number. */
fun parseDecimal(text: String): Double? {
    val cleaned = text.trim().replace(',', '.')
    if (!DECIMAL.matches(cleaned)) return null
    return cleaned.toDoubleOrNull()?.takeIf { it.isFinite() }
}

/** A random key so that a retried request does not do its work twice. */
fun newIdempotencyKey(): String = Random.nextBytes(16).joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }

private val ODOMETER_PREFIX = "odometer:"

fun odometerSignalKey(assetId: String): String = ODOMETER_PREFIX + assetId

/** The vehicle a task counts the odometer of (a counter on `odometer:<asset id>`), else null. */
fun odometerAssetOf(trigger: Trigger): String? =
    (trigger as? Trigger.CounterDelta)
        ?.entityId
        ?.takeIf { it.startsWith(ODOMETER_PREFIX) && it.length > ODOMETER_PREFIX.length }
        ?.removePrefix(ODOMETER_PREFIX)

const val MAX_ODOMETER_VALUE = 10_000_000.0

/** What was typed into an odometer field: [valid] is false for text that is no reading, [value] is null for an empty field. */
data class OdometerInput(
    val valid: Boolean,
    val value: Double?,
)

private val GROUPED_DOTS = Regex("^[1-9]\\d{0,2}(?:\\.\\d{3})+$")
private val GROUPED_COMMAS = Regex("^[1-9]\\d{0,2}(?:,\\d{3})+$")
private val PLAIN_DECIMAL = Regex("^\\d+(?:[.,]\\d+)?$")

/**
 * Reads an odometer field. `'`, spaces and a point or comma followed by exactly three digits are thousands
 * separators ("95.000" is 95000, "95.5" stays a decimal).
 */
fun parseOdometer(
    text: String,
    max: Double = MAX_ODOMETER_VALUE,
): OdometerInput {
    val cleaned = text.trim().filterNot { it.isWhitespace() || it == '\'' || it == '’' }
    if (cleaned.isEmpty()) return OdometerInput(true, null)
    val number =
        when {
            GROUPED_DOTS.matches(cleaned) || GROUPED_COMMAS.matches(cleaned) -> cleaned.replace(".", "").replace(",", "").toDoubleOrNull()
            PLAIN_DECIMAL.matches(cleaned) -> cleaned.replace(',', '.').toDoubleOrNull()
            else -> null
        }
    return if (number != null && number.isFinite() && number in 0.0..max) OdometerInput(true, number) else OdometerInput(false, null)
}

/** The reading to send: nothing when the field still shows the latest known reading. */
fun readingToSend(
    text: String,
    known: Double?,
    max: Double = MAX_ODOMETER_VALUE,
): OdometerInput {
    val parsed = parseOdometer(text, max)
    if (!parsed.valid) return parsed
    return if (parsed.value != null && parsed.value == known) OdometerInput(true, null) else parsed
}

fun categoryLabel(category: String): String = tr(if (category in Task.CATEGORY_VALUES) "category_$category" else "category_other")

fun priorityLabel(priority: String): String = tr(if (priority in Task.PRIORITY_VALUES) "priority_$priority" else "priority_normal")

fun assignModeLabel(mode: String): String = tr(if (mode in Task.ASSIGN_MODE_VALUES) "assign_mode_$mode" else "assign_mode_none")

fun rotationLabel(strategy: String): String =
    tr(
        if (strategy in
            Task.ROTATION_STRATEGY_VALUES
        ) {
            "rotation_$strategy"
        } else {
            "rotation_alternate"
        },
    )

fun rotationHint(strategy: String): String =
    tr(if (strategy in Task.ROTATION_STRATEGY_VALUES) "rotation_${strategy}_hint" else "rotation_alternate_hint")

fun notifyModeLabel(mode: String): String = tr(if (mode in Task.NOTIFY_MODE_VALUES) "notify_$mode" else "notify_assignee")

fun preparationKindLabel(kind: String): String = tr(if (kind in Preparation.KIND_VALUES) "prep_kind_$kind" else "prep_kind_generic")

fun preparationStateLabel(state: String): String = tr(if (state in Preparation.STATE_VALUES) "prep_state_$state" else "prep_state_not_yet")

fun sourceLabel(source: String): String = tr(if (source in Completion.SOURCE_VALUES) "source_$source" else "source_system")

fun reasonLabel(reason: String): String = tr("reason_$reason").takeIf { it != "reason_$reason" } ?: tr("status_unknown")

fun serviceKindLabel(kind: String): String = tr("service_kind_$kind")

fun categoryOptions(): List<ChoiceOption> = Task.CATEGORY_VALUES.map { ChoiceOption(it, categoryLabel(it)) }

fun priorityOptions(): List<ChoiceOption> = Task.PRIORITY_VALUES.map { ChoiceOption(it, priorityLabel(it)) }

fun assignModeOptions(): List<ChoiceOption> = Task.ASSIGN_MODE_VALUES.map { ChoiceOption(it, assignModeLabel(it)) }

fun rotationOptions(): List<ChoiceOption> = Task.ROTATION_STRATEGY_VALUES.map { ChoiceOption(it, rotationLabel(it)) }

fun notifyModeOptions(): List<ChoiceOption> = Task.NOTIFY_MODE_VALUES.map { ChoiceOption(it, notifyModeLabel(it)) }

fun preparationKindOptions(): List<ChoiceOption> = Preparation.KIND_VALUES.map { ChoiceOption(it, preparationKindLabel(it)) }

fun serviceKindOptions(): List<ChoiceOption> =
    ch.orellbuehler.hauswart.api.generated.ServiceLogEntry.KIND_VALUES
        .map { ChoiceOption(it, serviceKindLabel(it)) }

/** The days a task is due in, as the date is written in lists: "in 3 days · 24 Nov". */
fun dueLine(
    date: String,
    today: String,
    estimated: Boolean,
): String =
    ch.orellbuehler.hauswart.core
        .dueText(date, today, estimated)

/** The instant of noon on [date] in [timeZone] as UTC ISO text; used to backdate a completion. */
@OptIn(kotlin.time.ExperimentalTime::class)
fun noonInstant(
    date: String,
    timeZone: String,
): String? {
    val day = Dates.parse(date) ?: return null
    val zone = runCatching { kotlinx.datetime.TimeZone.of(timeZone) }.getOrDefault(kotlinx.datetime.TimeZone.UTC)
    return kotlinx.datetime
        .LocalDateTime(day, kotlinx.datetime.LocalTime(12, 0))
        .toInstant(zone)
        .toString()
}
