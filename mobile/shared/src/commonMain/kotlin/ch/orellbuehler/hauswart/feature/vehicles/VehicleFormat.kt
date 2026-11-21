package ch.orellbuehler.hauswart.feature.vehicles

import ch.orellbuehler.hauswart.api.ApiException
import ch.orellbuehler.hauswart.api.generated.FuelLogsCreateRequest
import ch.orellbuehler.hauswart.api.generated.OdometerReading
import ch.orellbuehler.hauswart.api.generated.TireSetsCreateRequest
import ch.orellbuehler.hauswart.api.generated.Vehicle
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Money
import ch.orellbuehler.hauswart.feature.tasks.formatNumber
import ch.orellbuehler.hauswart.i18n.I18n
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlin.math.abs
import kotlin.math.roundToLong

/** More than any odometer shows; keeps a typo of a few extra digits out. */
const val VEHICLE_MAX_ODOMETER = 10_000_000.0
const val VEHICLE_MAX_FUEL_QUANTITY = 10_000.0
const val VEHICLE_MAX_TREAD_MM = 20.0

val VEHICLE_FUEL_TYPES: List<String> = Vehicle.FUEL_TYPE_VALUES
val VEHICLE_ODOMETER_UNITS: List<String> = Vehicle.ODOMETER_UNIT_VALUES
val VEHICLE_TIRE_SEASONS: List<String> = TireSetsCreateRequest.SEASON_VALUES
val VEHICLE_FUEL_UNITS: List<String> = FuelLogsCreateRequest.UNIT_VALUES

/** A value and the text to show for it: the choices of a dropdown. */
data class VehicleChoice(
    val value: String,
    val label: String,
)

/** A label with its value on a card or a detail screen. [warning] marks a value that needs attention. */
data class VehicleFact(
    val label: String,
    val value: String,
    val note: String? = null,
    val warning: Boolean = false,
)

fun vehicleFuelLabel(type: String): String = if (type in VEHICLE_FUEL_TYPES) tr("vehicle_fuel_$type") else type

fun vehicleUnitLabel(unit: String): String = if (unit in VEHICLE_ODOMETER_UNITS) tr("vehicle_unit_$unit") else unit

fun tireSeasonLabel(season: String): String = if (season in VEHICLE_TIRE_SEASONS) tr("tire_season_$season") else season

fun tireSeasonOptionLabel(season: String): String = if (season in VEHICLE_TIRE_SEASONS) tr("tire_season_option_$season") else season

fun fuelUnitLabel(unit: String): String =
    when (unit) {
        "l" -> tr("fuel_unit_l")
        "kWh" -> tr("fuel_unit_kwh")
        else -> unit
    }

fun odometerSourceLabel(source: String): String = if (source in ODOMETER_SOURCES) tr("vehicle_source_$source") else source

private val ODOMETER_SOURCES = OdometerReading.SOURCE_VALUES

/** "45'200 km": a reading with its unit. */
fun odometerText(
    value: Double,
    unit: String,
): String = "${formatNumber(value)} $unit"

/** A number with a fixed count of decimals, grouped like [formatNumber]: "7.5", "1.839". */
fun fixedNumber(
    value: Double,
    digits: Int,
): String {
    if (!value.isFinite()) return value.toString()
    var scale = 1L
    repeat(digits) { scale *= 10 }
    val scaled = (abs(value) * scale).roundToLong()
    val whole = (scaled / scale).toString()
    val separator = if (I18n.locale == "de") "'" else ","
    val grouped =
        whole
            .reversed()
            .chunked(3)
            .joinToString(separator)
            .reversed()
    val fraction = if (digits == 0) "" else "." + (scaled % scale).toString().padStart(digits, '0')
    val sign = if (value < 0 && scaled != 0L) "-" else ""
    return sign + grouped + fraction
}

/** "7.5 l/100 km". */
fun consumptionText(
    per100: Double,
    fuelUnit: String,
    distanceUnit: String,
): String = "${fixedNumber(per100, 1)} $fuelUnit/100 $distanceUnit"

/** A price per unit with one decimal more than the currency has ("CHF 1.839/l"); [rateMinor] is in minor units. */
fun rateText(
    rateMinor: Double,
    currency: String,
    per: String,
): String {
    val exponent = Money.exponent(currency)
    var divisor = 1.0
    repeat(exponent) { divisor *= 10 }
    return "${currency.uppercase()} ${fixedNumber(rateMinor / divisor, exponent + 1)}/$per"
}

fun fuelQuantityText(
    quantity: Double,
    unit: String,
): String = "${formatNumber(quantity)} $unit"

/** What was typed into a number field: [valid] is false for text that is no number, [value] is null for an empty field. */
data class VehicleNumberInput(
    val valid: Boolean,
    val value: Double?,
)

private val DECIMAL_TEXT = Regex("^\\d+(?:[.,]\\d+)?$")

/** Reads an amount, litres or millimetres: `'`, `’` and spaces are thousands separators, a point or comma is the decimal sign. */
fun parseVehicleDecimal(
    text: String,
    max: Double,
): VehicleNumberInput {
    val cleaned = text.trim().filterNot { it.isWhitespace() || it == '\'' || it == '’' }
    if (cleaned.isEmpty()) return VehicleNumberInput(true, null)
    if (!DECIMAL_TEXT.matches(cleaned)) return VehicleNumberInput(false, null)
    val value = cleaned.replace(',', '.').toDoubleOrNull()
    return if (value != null && value.isFinite() && value in 0.0..max) VehicleNumberInput(true, value) else VehicleNumberInput(false, null)
}

/** The number a field shows for a stored value: "45200" or "7.5". */
fun vehicleNumberInput(value: Double): String =
    if (value.isFinite() && value == kotlin.math.floor(value) && abs(value) < 1e15) value.toLong().toString() else value.toString()

/** A neighbouring reading the server named when it refused one: `lower_than_previous` or `higher_than_next`. */
data class OdometerRefusal(
    val code: String,
    val field: String,
    val value: Double,
    val date: String,
)

/** The structured reason of a refused reading (`details.code` with the reading in the way), else null. The English message is never read. */
fun odometerRefusalOf(e: ApiException): OdometerRefusal? {
    if (e.code != "invalid_request") return null
    val details = e.details as? JsonObject ?: return null
    val code = (details["code"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
    if (code != "lower_than_previous" && code != "higher_than_next") return null
    val field = (details["field"] as? JsonPrimitive)?.content ?: return null
    val reading = details["reading"] as? JsonObject ?: return null
    val value = (reading["value"] as? JsonPrimitive)?.doubleOrNull ?: return null
    val date = (reading["date"] as? JsonPrimitive)?.content ?: return null
    return OdometerRefusal(code, field, value, date)
}

/** The refusal in words; [canForce] adds that the form can save it anyway. */
fun odometerRefusalText(
    refusal: OdometerRefusal,
    unit: String,
    canForce: Boolean,
): String {
    val lower = refusal.code == "lower_than_previous"
    val key =
        when {
            lower && canForce -> "vehicle_odometer_lower"
            lower -> "vehicle_odometer_refused_lower"
            canForce -> "vehicle_odometer_higher"
            else -> "vehicle_odometer_refused_higher"
        }
    return tr(key, "value" to odometerText(refusal.value, unit), "date" to Dates.format(refusal.date))
}

/** The short wording under the field of a refusal. */
fun odometerRefusalShort(refusal: OdometerRefusal): String =
    tr(if (refusal.code == "lower_than_previous") "vehicle_odometer_lower_short" else "vehicle_odometer_higher_short")

/** Who owns a reading the server refuses to delete (`details.source`), else null. */
fun odometerOwnerOf(e: ApiException): String? {
    if (e.code != "conflict") return null
    val details = e.details as? JsonObject ?: return null
    return (details["source"] as? JsonPrimitive)?.takeIf { it.isString }?.content
}

fun odometerOwnerMessage(source: String): String =
    when (source) {
        "completion", "service_log", "fuel_log", "tire_change" -> tr("vehicle_history_owned_error", "owner" to tr("vehicle_owner_$source"))
        else -> tr("vehicle_history_owned_error_unknown")
    }
