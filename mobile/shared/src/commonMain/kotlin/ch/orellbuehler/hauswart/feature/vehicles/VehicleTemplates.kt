package ch.orellbuehler.hauswart.feature.vehicles

import ch.orellbuehler.hauswart.api.generated.PreparationsCreateRequest
import ch.orellbuehler.hauswart.api.generated.Task
import ch.orellbuehler.hauswart.api.generated.TasksCreateRequest
import ch.orellbuehler.hauswart.api.generated.Trigger
import ch.orellbuehler.hauswart.api.generated.TriggerCounterDeltaOrEvery
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.feature.tasks.describeTrigger
import ch.orellbuehler.hauswart.feature.tasks.odometerSignalKey
import ch.orellbuehler.hauswart.feature.tasks.parseOdometer
import ch.orellbuehler.hauswart.i18n.I18n
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.plus

/** The `externalSource` of every task a vehicle template creates. */
const val VEHICLE_TEMPLATE_SOURCE = "vehicle_template"

/** The templates a vehicle can set its tasks up from, in the order a person would set them up. */
val VEHICLE_TEMPLATE_IDS: List<String> =
    listOf("tires_winter", "tires_summer", "service", "mfk", "vignette", "vehicle_tax", "brake_fluid", "ac_service")

/** What is checked when the setup opens: the tasks nearly every vehicle has. */
val VEHICLE_TEMPLATES_DEFAULT: List<String> = listOf("tires_winter", "tires_summer", "service", "mfk")

const val DEFAULT_SERVICE_MONTHS = 12
private const val GARAGE_LEAD_DAYS = 28L
private const val MAX_SERVICE_MONTHS = 1200.0

fun defaultServiceDistance(unit: String): Double = if (unit == "mi") 10_000.0 else 15_000.0

data class TemplateMark(
    val externalSource: String,
    val externalRef: String,
)

/** The mark of the n-th task of a template on a vehicle: `<asset id>:<template id>` and `:<n>` from the second on. */
fun templateMark(
    assetId: String,
    id: String,
    n: Int = 1,
): TemplateMark = TemplateMark(VEHICLE_TEMPLATE_SOURCE, if (n <= 1) "$assetId:$id" else "$assetId:$id:$n")

private val MARK = Regex("^[^:]+:([a-z_]+)(?::\\d+)?$")

/** The template a task was made from, or null for a task without a readable mark. */
fun templateOfMark(
    externalSource: String?,
    externalRef: String?,
): String? {
    if (externalSource != VEHICLE_TEMPLATE_SOURCE || externalRef == null) return null
    val id = MARK.matchEntire(externalRef)?.groupValues?.get(1)
    return if (id != null && id in VEHICLE_TEMPLATE_IDS) id else null
}

private fun addYears(
    date: String,
    years: Int,
): String? = Dates.parse(date)?.plus(years * 12, DateTimeUnit.MONTH)?.toString()

/**
 * When the periodic inspection (MFK) is due by Swiss rules: four years after the first registration, three years after that,
 * then every two years: the first of those dates that is not before [today]; null without a first registration.
 */
fun suggestMfkDate(
    firstRegistration: String?,
    today: String,
): String? {
    if (firstRegistration.isNullOrEmpty()) return null
    var years = 4
    repeat(200) {
        val date = addYears(firstRegistration, years) ?: return null
        if (date >= today) return date
        years += if (years == 4) 3 else 2
    }
    return null
}

private fun nextYearly(
    today: String,
    month: Int,
    day: Int,
): String? {
    val year = Dates.parse(today)?.year ?: return null

    fun on(y: Int): String {
        val first = LocalDate(y, month, 1)
        val last = first.plus(1, DateTimeUnit.MONTH).plus(-1, DateTimeUnit.DAY).day
        return LocalDate(y, month, minOf(day, last)).toString()
    }
    val thisYear = on(year)
    return if (thisYear >= today) thisYear else on(year + 1)
}

/** What the templates need to know about the vehicle and the moment. */
data class VehicleTemplateContext(
    val assetId: String,
    val firstRegistration: String?,
    val today: String,
    val odometerUnit: String,
)

/** The parameters of the templates that have any, as typed. */
data class VehicleSetupParams(
    val serviceDistance: String = "",
    val serviceMonths: String = DEFAULT_SERVICE_MONTHS.toString(),
    val mfkDate: String = "",
    val taxMonth: String = "3",
    val taxDay: String = "31",
    val brakeFluidLastDone: String = "",
    val acServiceLastDone: String = "",
)

fun defaultSetupParams(ctx: VehicleTemplateContext): VehicleSetupParams =
    VehicleSetupParams(
        serviceDistance = vehicleNumberInput(defaultServiceDistance(ctx.odometerUnit)),
        mfkDate = suggestMfkDate(ctx.firstRegistration, ctx.today).orEmpty(),
    )

/** A task and the preparations to send once it exists. */
data class VehicleTemplate(
    val id: String,
    val task: TasksCreateRequest,
    val preparations: List<PreparationsCreateRequest>,
)

data class BuiltTemplate(
    val template: VehicleTemplate?,
    /** Problems with the parameters, keyed like [VehicleSetupParams]. */
    val errors: Map<String, String>,
)

fun templateTitle(id: String): String =
    when (id) {
        "tires_winter" -> tr("vehicle_task_tires_winter_title")
        "tires_summer" -> tr("vehicle_task_tires_summer_title")
        "service" -> tr("vehicle_task_service_title")
        "mfk" -> tr("vehicle_task_mfk_title")
        "vignette" -> tr("vehicle_task_vignette_title")
        "vehicle_tax" -> tr("vehicle_task_tax_title")
        "brake_fluid" -> tr("vehicle_task_brake_fluid_title")
        "ac_service" -> tr("vehicle_task_ac_service_title")
        else -> id
    }

/** The title a template gives its task in every language of the app: a task made in the other language counts as well. */
fun templateTitles(id: String): List<String> {
    val before = I18n.locale
    return try {
        I18n.locales.map { locale ->
            I18n.locale = locale
            templateTitle(id)
        }
    } finally {
        I18n.locale = before
    }
}

private fun yearly(
    ctx: VehicleTemplateContext,
    month: Int,
    day: Int,
    earlyDays: Long,
): Trigger =
    Trigger.Calendar(
        freq = "yearly",
        interval = 1,
        byMonthDay = day.toLong(),
        byMonth = listOf(month.toLong()),
        startDate = requireNotNull(nextYearly(ctx.today, month, day)),
        earlyDays = earlyDays,
    )

private fun task(
    ctx: VehicleTemplateContext,
    id: String,
    category: String,
    trigger: Trigger,
    priority: String? = null,
): TasksCreateRequest {
    val mark = templateMark(ctx.assetId, id)
    return TasksCreateRequest(
        title = templateTitle(id),
        category = category,
        priority = priority,
        assetId = ctx.assetId,
        trigger = trigger,
        externalSource = mark.externalSource,
        externalRef = mark.externalRef,
    )
}

private fun wholeNumber(
    text: String,
    max: Double,
): Long? {
    val value = text.trim().toLongOrNull() ?: return null
    return if (value > 0 && value <= max) value else null
}

/** The template for [id] with the person's parameters, or what is wrong with them. */
fun buildVehicleTemplate(
    id: String,
    ctx: VehicleTemplateContext,
    params: VehicleSetupParams,
): BuiltTemplate {
    val errors = mutableMapOf<String, String>()

    fun done(
        category: String,
        trigger: Trigger,
        priority: String? = null,
        preparations: List<PreparationsCreateRequest> = emptyList(),
    ) = BuiltTemplate(VehicleTemplate(id, task(ctx, id, category, trigger, priority), preparations), errors)

    fun tires(
        month: Int,
        day: Int,
    ) = done(
        "maintenance",
        yearly(ctx, month, day, 14),
        preparations =
            listOf(
                PreparationsCreateRequest(
                    title = tr("vehicle_task_tires_prep_garage"),
                    kind = "generic",
                    leadDays = GARAGE_LEAD_DAYS,
                    sortOrder = 0,
                ),
            ),
    )
    when (id) {
        "tires_winter" -> return tires(10, 15)
        "tires_summer" -> return tires(4, 15)
        "vignette" -> return done("payment", yearly(ctx, 1, 31, 45))
        "service" -> {
            val distance = parseOdometer(params.serviceDistance, VEHICLE_MAX_ODOMETER)
            val months = wholeNumber(params.serviceMonths, MAX_SERVICE_MONTHS)
            val threshold = distance.value
            if (!distance.valid || threshold == null || threshold <= 0.0) errors["serviceDistance"] = tr("vehicle_setup_error_number")
            if (months == null) errors["serviceMonths"] = tr("vehicle_setup_error_number")
            if (errors.isNotEmpty() || threshold == null || months == null) return BuiltTemplate(null, errors)
            return done(
                "maintenance",
                Trigger.CounterDelta(
                    entityId = odometerSignalKey(ctx.assetId),
                    threshold = threshold,
                    unit = ctx.odometerUnit,
                    orEvery = TriggerCounterDeltaOrEvery(every = months, unit = "month"),
                ),
            )
        }
        "mfk" -> {
            if (!Dates.isValid(params.mfkDate)) {
                errors["mfkDate"] = tr("vehicle_setup_error_date")
                return BuiltTemplate(null, errors)
            }
            return done("inspection", Trigger.OneOff(date = params.mfkDate), priority = "high")
        }
        "vehicle_tax" -> {
            val month = wholeNumber(params.taxMonth, 12.0)
            val day = wholeNumber(params.taxDay, 31.0)
            if (month == null) errors["taxMonth"] = tr("vehicle_setup_error_number")
            if (day == null) errors["taxDay"] = tr("vehicle_setup_error_day")
            if (month == null || day == null) return BuiltTemplate(null, errors)
            return done("payment", yearly(ctx, month.toInt(), day.toInt(), 30))
        }
        "brake_fluid", "ac_service" -> {
            val field = if (id == "brake_fluid") "brakeFluidLastDone" else "acServiceLastDone"
            val last = (if (id == "brake_fluid") params.brakeFluidLastDone else params.acServiceLastDone).trim()
            if (last.isNotEmpty() && (!Dates.isValid(last) || last > ctx.today)) {
                errors[field] = tr("vehicle_setup_error_date")
                return BuiltTemplate(null, errors)
            }
            return done(
                "maintenance",
                Trigger.Interval(
                    every = 2,
                    unit = "year",
                    anchor = "completion",
                    startDate = requireNotNull(addYears(last.ifEmpty { ctx.today }, 2)),
                ),
            )
        }
    }
    return BuiltTemplate(null, errors)
}

/** A one-off task that was completed or skipped is over: the next one has to be made new. */
private fun isFinishedOneOff(task: Task): Boolean {
    val state = task.state ?: return false
    return task.trigger is Trigger.OneOff && state.dueDate == null && state.reasons.any { it == "completed" || it == "skipped" }
}

/** A task of this vehicle that is not archived and not over: what a template would do is there. */
internal fun isLiveTaskOf(
    task: Task,
    assetId: String,
): Boolean = task.assetId == assetId && task.archivedAt == null && !isFinishedOneOff(task)

private fun followsTemplate(
    id: String,
    task: Task,
    assetId: String,
): Boolean {
    val marked = templateOfMark(task.externalSource, task.externalRef)
    if (marked != null) return marked == id
    if (templateTitles(id).any { it.trim().lowercase() == task.title.trim().lowercase() }) return true
    return when (id) {
        "service" -> (task.trigger as? Trigger.CounterDelta)?.entityId == odometerSignalKey(assetId)
        "mfk" -> task.trigger is Trigger.OneOff && task.category == "inspection"
        else -> false
    }
}

/**
 * The task of this vehicle that already does what the template would, so it is not offered twice. A task a template made
 * carries its mark and the mark decides; only a task without a readable mark is judged by likeness.
 */
fun findExistingVehicleTask(
    id: String,
    tasks: List<Task>,
    assetId: String,
): Task? = tasks.firstOrNull { isLiveTaskOf(it, assetId) && followsTemplate(id, it, assetId) }

/** The text under a template's row: its trigger in words. */
fun templateSummary(template: VehicleTemplate): String = describeTrigger(template.task.trigger)
