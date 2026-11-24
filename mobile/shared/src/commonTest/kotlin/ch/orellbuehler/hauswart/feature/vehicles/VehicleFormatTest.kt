package ch.orellbuehler.hauswart.feature.vehicles

import ch.orellbuehler.hauswart.api.ApiException
import ch.orellbuehler.hauswart.i18n.I18n
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.serialization.json.Json
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class VehicleFormatTest {
    @AfterTest
    fun reset() {
        I18n.locale = "de"
    }

    private fun error(
        code: String,
        details: String,
    ) = ApiException(400, code, "x", Json.parseToJsonElement(details))

    @Test
    fun numbersFollowTheLanguage() {
        assertEquals("45'200 km", odometerText(45200.0, "km"))
        assertEquals("7.5 l/100 km", consumptionText(7.5, "l", "km"))
        assertEquals("CHF 1.839/l", rateText(183.9, "CHF", "l"))
        assertEquals("1'234.50", fixedNumber(1234.5, 2))
        I18n.locale = "en"
        assertEquals("45,200 km", odometerText(45200.0, "km"))
        assertEquals("CHF 1,234.500/l", rateText(123450.0, "CHF", "l"))
    }

    @Test
    fun decimalsAreReadLikeTheWebDoes() {
        val cases =
            listOf(
                "" to VehicleNumberInput(true, null),
                "7,5" to VehicleNumberInput(true, 7.5),
                "1'200.5" to VehicleNumberInput(true, 1200.5),
                "abc" to VehicleNumberInput(false, null),
                "-3" to VehicleNumberInput(false, null),
                "3000" to VehicleNumberInput(false, null),
            )
        cases.forEach { (text, expected) -> assertEquals(expected, parseVehicleDecimal(text, 2000.0), text) }
    }

    @Test
    fun aRefusedReadingIsRecognisedByItsCodeNotByItsText() {
        val lower = """{"code":"lower_than_previous","field":"value","reading":{"value":45000,"date":"2026-09-01"}}"""
        val refusal = odometerRefusalOf(error("invalid_request", lower))
        assertEquals(OdometerRefusal("lower_than_previous", "value", 45000.0, "2026-09-01"), refusal)
        assertEquals(
            tr("vehicle_odometer_refused_lower", "value" to "45'000 km", "date" to "01.09.2026"),
            odometerRefusalText(refusal!!, "km", canForce = false),
        )
        assertEquals(
            tr("vehicle_odometer_lower", "value" to "45'000 km", "date" to "01.09.2026"),
            odometerRefusalText(refusal, "km", canForce = true),
        )
        assertEquals(tr("vehicle_odometer_lower_short"), odometerRefusalShort(refusal))
        val higher = lower.replace("lower_than_previous", "higher_than_next")
        assertEquals(tr("vehicle_odometer_higher_short"), odometerRefusalShort(odometerRefusalOf(error("invalid_request", higher))!!))
        assertNull(odometerRefusalOf(error("invalid_request", """{"code":"other","field":"value"}""")))
        assertNull(odometerRefusalOf(error("conflict", lower)))
    }

    @Test
    fun theOwnerOfAReadingIsWorded() {
        val owner =
            odometerOwnerOf(ApiException(409, "conflict", "x", Json.parseToJsonElement("""{"source":"fuel_log","sourceId":"f1"}""")))
        assertEquals("fuel_log", owner)
        assertEquals(tr("vehicle_history_owned_error", "owner" to tr("vehicle_owner_fuel_log")), odometerOwnerMessage("fuel_log"))
        assertEquals(tr("vehicle_history_owned_error_unknown"), odometerOwnerMessage("manual"))
    }

    @Test
    fun trendsAreNormalised() {
        assertEquals(emptyList(), sparkPoints(listOf(1.0)))
        val points = sparkPoints(listOf(1.0, 3.0, 2.0))
        assertEquals(listOf(0.0, 0.5, 1.0), points.map { it.x })
        assertEquals(listOf(1.0, 0.0, 0.5), points.map { it.y })
        assertEquals(listOf(0.5, 0.5), sparkPoints(listOf(2.0, 2.0)).map { it.y })
    }

    @Test
    fun theStatsYearsRunBackToTheFirstData() {
        assertEquals(listOf(2026, 2025, 2024, 2023), vehicleStatsYears("2026-11-21", listOf("2023-04-01", null)))
        assertEquals(listOf(2026, 2025), vehicleStatsYears("2026-11-21", listOf(null)))
        assertEquals(21, vehicleStatsYears("2026-11-21", listOf("1999-01-01")).size)
    }
}
