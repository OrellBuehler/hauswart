package ch.orellbuehler.hauswart.core

import ch.orellbuehler.hauswart.i18n.I18n
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals

class NamesTest {
    @BeforeTest
    fun german() {
        I18n.locale = "de"
    }

    @AfterTest
    fun reset() {
        I18n.locale = "de"
    }

    @Test
    fun numbersAreGroupedByLanguage() {
        assertEquals("15'000", formatNumber(15000.0))
        assertEquals("1'234.57", formatNumber(1234.567))
        assertEquals("-2.5", formatNumber(-2.5))
        assertEquals("0", formatNumber(-0.001))
        I18n.locale = "en"
        assertEquals("1,234,567", formatNumber(1234567.0))
    }

    @Test
    fun monthsAndWeekdaysHaveNamesInBothLanguages() {
        assertEquals("März", monthName(3))
        assertEquals("Dez", monthShort(12))
        assertEquals("Sonntag", weekdayName(7))
        assertEquals("Mo", weekdayShort(1))
        I18n.locale = "en"
        assertEquals("March", monthName(3))
        assertEquals("Dec", monthShort(12))
        assertEquals("Sunday", weekdayName(7))
        assertEquals("Mon", weekdayShort(1))
    }
}
