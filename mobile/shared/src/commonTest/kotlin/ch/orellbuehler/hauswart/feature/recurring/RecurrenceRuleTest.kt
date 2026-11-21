package ch.orellbuehler.hauswart.feature.recurring

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class RecurrenceRuleTest {
    private fun rule(
        frequency: String = "monthly",
        interval: Int = 1,
        day: Int = 1,
        start: String = "2026-01-01",
        end: String? = null,
    ) = RecurrenceRule(frequency, interval, day, start, end)

    @Test
    fun nextOccurrenceTable() {
        val cases =
            listOf(
                Triple(rule(day = 31, start = "2026-01-31"), "2026-01-31", "2026-02-28"),
                Triple(rule(day = 31, start = "2026-01-31"), "2026-02-28", "2026-03-31"),
                Triple(rule(day = 29, start = "2028-01-15"), "2028-01-29", "2028-02-29"),
                Triple(rule(frequency = "quarterly", day = 15, start = "2026-02-10"), "2026-02-15", "2026-05-15"),
                Triple(rule(frequency = "yearly", interval = 2, day = 1, start = "2026-03-01"), "2026-03-01", "2028-03-01"),
                Triple(rule(interval = 3, day = 10, start = "2026-01-01"), "2026-11-20", "2027-01-10"),
            )
        cases.forEach { (r, after, expected) -> assertEquals(expected, nextOccurrenceAfter(r, after), "$r after $after") }
    }

    @Test
    fun theFirstOccurrenceIsOnOrAfterTheStartDate() {
        assertEquals("2026-03-15", firstOccurrence(rule(day = 15, start = "2026-03-15")))
        assertEquals("2026-04-10", firstOccurrence(rule(day = 10, start = "2026-03-15")))
    }

    @Test
    fun theEndDateClosesTheSeries() {
        val r = rule(day = 5, start = "2026-01-01", end = "2026-03-05")
        assertEquals("2026-03-05", nextOccurrenceAfter(r, "2026-02-05"))
        assertNull(nextOccurrenceAfter(r, "2026-03-05"))
        assertNull(firstOccurrence(rule(day = 5, start = "2026-03-10", end = "2026-03-20")))
    }

    @Test
    fun dueOccurrencesCountUpToTodayAndHonourTheCap() {
        val r = rule(day = 1, start = "2026-01-01")
        assertEquals(listOf("2026-01-01", "2026-02-01", "2026-03-01"), dueOccurrences(r, null, "2026-03-15"))
        assertEquals(listOf("2026-03-01"), dueOccurrences(r, "2026-02-01", "2026-03-15"))
        val old = rule(day = 1, start = "1990-01-01")
        assertEquals(RECURRENCE_BOOKING_CAP + 1, dueOccurrences(old, null, "2026-03-15", RECURRENCE_BOOKING_CAP + 1).size)
    }

    @Test
    fun immediateBookingsSayHowManyAndWhetherTheyAreCapped() {
        val r = rule(day = 1, start = "2026-01-01")
        val three = immediateBookings(r, null, "2026-03-15")
        assertEquals(3, three.count)
        assertEquals("2026-01-01", three.first)
        assertEquals(false, three.capped)
        val many = immediateBookings(rule(day = 1, start = "2000-01-01"), null, "2026-03-15")
        assertEquals(RECURRENCE_BOOKING_CAP, many.count)
        assertEquals(true, many.capped)
        assertEquals(0, immediateBookings(r, null, "2025-12-31").count)
    }

    @Test
    fun upcomingDatesStopAtThePreviewCount() {
        assertEquals(
            listOf("2026-12-01", "2027-01-01", "2027-02-01"),
            upcomingDates(rule(day = 1), "2026-11-21"),
        )
    }

    @Test
    fun clampedMonthsNameTheShortMonths() {
        assertEquals(listOf(2, 4, 6, 9, 11), clampedMonths(rule(day = 31)))
        assertEquals(listOf(2), clampedMonths(rule(day = 29)))
        assertEquals(emptyList(), clampedMonths(rule(day = 28)))
        assertEquals(listOf(2), clampedMonths(rule(frequency = "yearly", day = 30, start = "2026-02-01")))
    }

    @Test
    fun stateAndDueness() {
        assertEquals("finished", recurrenceStateOf(true, null))
        assertEquals("paused", recurrenceStateOf(false, "2026-12-01"))
        assertEquals("active", recurrenceStateOf(true, "2026-12-01"))
        assertEquals(true, isDue(true, "2026-11-21", "2026-11-21"))
        assertEquals(false, isDue(true, "2026-11-22", "2026-11-21"))
        assertEquals(false, isDue(false, "2026-11-01", "2026-11-21"))
    }
}
