package ch.orellbuehler.hauswart.feature.tasks

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TaskFormatTest {
    @Test
    fun odometerFieldsReadLikeThePeopleWriteThem() {
        val cases =
            listOf(
                "" to OdometerInput(true, null),
                "  " to OdometerInput(true, null),
                "45200" to OdometerInput(true, 45200.0),
                "95.000" to OdometerInput(true, 95000.0),
                "95,000" to OdometerInput(true, 95000.0),
                "1.234.567" to OdometerInput(true, 1234567.0),
                "95.5" to OdometerInput(true, 95.5),
                "95,50" to OdometerInput(true, 95.5),
                "45'200" to OdometerInput(true, 45200.0),
                "12 345" to OdometerInput(true, 12345.0),
                "abc" to OdometerInput(false, null),
                "-5" to OdometerInput(false, null),
                "20000000" to OdometerInput(false, null),
            )
        cases.forEach { (text, expected) -> assertEquals(expected, parseOdometer(text), text) }
    }

    @Test
    fun aReadingEqualToTheKnownOneIsNotSent() {
        assertEquals(OdometerInput(true, null), readingToSend("45200", 45200.0))
        assertEquals(OdometerInput(true, 45300.0), readingToSend("45300", 45200.0))
        assertEquals(OdometerInput(true, null), readingToSend("", 45200.0))
        assertEquals(OdometerInput(false, null), readingToSend("x", 45200.0))
    }

    @Test
    fun numbersAreParsedStrictly() {
        assertEquals(12L, parseWhole(" 12 "))
        assertNull(parseWhole("1.5"))
        assertNull(parseWhole("1e3"))
        assertEquals(2.5, parseDecimal("2,5"))
        assertNull(parseDecimal("2f"))
        assertNull(parseDecimal("NaN"))
        assertEquals("15000", plainNumber(15000.0))
        assertEquals("2.5", plainNumber(2.5))
    }

    @Test
    fun idempotencyKeysAreLongAndDiffer() {
        val a = newIdempotencyKey()
        assertTrue(a.length >= 8)
        assertTrue(a != newIdempotencyKey())
    }

    @Test
    fun noonOfTheHouseholdZoneIsAnInstant() {
        assertEquals("2026-11-20T11:00:00Z", noonInstant("2026-11-20", "Europe/Zurich"))
        assertNull(noonInstant("nope", "Europe/Zurich"))
    }
}
