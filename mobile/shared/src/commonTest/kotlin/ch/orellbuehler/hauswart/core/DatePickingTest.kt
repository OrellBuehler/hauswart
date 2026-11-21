package ch.orellbuehler.hauswart.core

import kotlin.test.Test
import kotlin.test.assertEquals

class DatePickingTest {
    @Test
    fun theRangeCoversTheInitialDate() {
        val cases =
            listOf(
                "" to 1900..2100,
                "nope" to 1900..2100,
                "2026-11-21" to 1900..2100,
                "1850-03-01" to 1850..2100,
                "2150-03-01" to 1900..2150,
                "0001-01-01" to 1..2100,
                "9999-12-31" to 1900..9999,
            )
        cases.forEach { (date, range) -> assertEquals(range, pickerYearRange(date), date) }
    }
}
