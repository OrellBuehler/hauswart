package ch.orellbuehler.hauswart.feature.insurance

import ch.orellbuehler.hauswart.feature.dashboard.TONE_DUE
import ch.orellbuehler.hauswart.feature.dashboard.TONE_MUTED
import ch.orellbuehler.hauswart.feature.dashboard.TONE_OVERDUE
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class InsuranceLogicTest {
    @Test
    fun theDeadlineIsTheEndDateMinusTheNotice() {
        class Case(
            val renewal: String,
            val end: String?,
            val months: Int?,
            val expected: String?,
        )
        listOf(
            Case("auto", "2026-12-31", 3, "2026-09-30"),
            Case("auto", "2026-05-31", 3, "2026-02-28"),
            Case("auto", "2026-06-30", 3, "2026-03-31"),
            Case("auto", "2027-03-31", 1, "2027-02-28"),
            Case("auto", "2026-12-15", 3, "2026-09-15"),
            Case("auto", "2026-12-31", 0, "2026-12-31"),
            Case("auto", "2024-02-29", 12, "2023-02-28"),
            Case("fixed", "2026-12-31", 3, null),
            Case("auto", null, 3, null),
            Case("auto", "2026-12-31", null, null),
            Case("auto", "not a date", 3, null),
        ).forEach { c ->
            assertEquals(c.expected, cancellationDeadline(c.renewal, c.end, c.months), "${c.renewal} ${c.end} ${c.months}")
        }
    }

    @Test
    fun theAnnualPremiumIsExact() {
        assertEquals(12_000, annualPremiumMinor(1_000, "monthly"))
        assertEquals(4_800, annualPremiumMinor(1_200, "quarterly"))
        assertEquals(2_400, annualPremiumMinor(1_200, "semiannual"))
        assertEquals(1_200, annualPremiumMinor(1_200, "annual"))
        assertEquals(1_200, annualPremiumMinor(1_200, "something new"))
    }

    @Test
    fun theHintSaysHowPressingTheDeadlineIs() {
        val today = "2026-06-01"
        assertNull(deadlineHint(null, today))
        assertEquals(TONE_OVERDUE, deadlineHint("2026-05-30", today)?.tone)
        assertEquals(true, deadlineHint("2026-05-30", today)?.overdue)
        assertEquals(TONE_DUE, deadlineHint("2026-06-01", today)?.tone)
        assertEquals(TONE_DUE, deadlineHint("2026-07-01", today)?.tone)
        assertEquals(TONE_MUTED, deadlineHint("2026-07-02", today)?.tone)
        assertEquals(30, deadlineHint("2026-07-01", today)?.days)
    }

    @Test
    fun aTermEndsAfterItsLastDay() {
        assertEquals(false, termEnded("2026-06-01", "2026-06-01"))
        assertEquals(true, termEnded("2026-05-31", "2026-06-01"))
        assertEquals(false, termEnded(null, "2026-06-01"))
    }
}
