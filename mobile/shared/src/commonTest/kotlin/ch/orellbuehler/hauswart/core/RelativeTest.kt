package ch.orellbuehler.hauswart.core

import ch.orellbuehler.hauswart.i18n.I18n
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals

class RelativeTest {
    @BeforeTest
    fun german() {
        I18n.locale = "de"
    }

    @AfterTest
    fun reset() {
        I18n.locale = "de"
    }

    @Test
    fun wordsForNearDaysAndUnitsForFarOnes() {
        assertEquals("heute", relativeDays(0))
        assertEquals("morgen", relativeDays(1))
        assertEquals("gestern", relativeDays(-1))
        assertEquals("in 3 Tagen", relativeDays(3))
        assertEquals("vor 5 Tagen", relativeDays(-5))
        assertEquals("in 3 Wochen", relativeDays(21))
        assertEquals("vor 2 Monaten", relativeDays(-61))
        assertEquals("in 3 Jahren", relativeDays(1100))
    }

    @Test
    fun englishPlurals() {
        I18n.locale = "en"
        assertEquals("in 2 days", relativeDays(2))
        assertEquals("2 weeks ago", relativeDays(-14))
    }

    @Test
    fun dueTextShowsTheYearOnlyWhenItDiffers() {
        assertEquals("in 3 Tagen · 24.11.", dueText("2026-11-24", "2026-11-21"))
        assertEquals("~ in 3 Tagen · 24.11.", dueText("2026-11-24", "2026-11-21", estimated = true))
        assertEquals("in 6 Wochen · 02.01.2027", dueText("2027-01-02", "2026-11-21"))
    }

    @Test
    fun aPickedDateRoundTrips() {
        val millis = pickerMillisOf("2026-11-21")
        assertEquals("2026-11-21", dateOfPickerMillis(requireNotNull(millis)))
        assertEquals(null, pickerMillisOf("nope"))
    }
}
