@file:OptIn(ExperimentalTime::class)

package ch.orellbuehler.hauswart.feature.appointments

import ch.orellbuehler.hauswart.api.generated.Appointment
import ch.orellbuehler.hauswart.i18n.I18n
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.ExperimentalTime
import kotlin.time.Instant

internal const val ZONE = "Europe/Zurich"
internal const val TODAY = "2026-11-21"

internal fun ms(iso: String): Long = Instant.parse(iso).toEpochMilliseconds()

internal fun timed(
    id: String,
    startsAt: String,
    endsAt: String,
    title: String = "Visit $id",
    status: String = "planned",
    location: String? = null,
    taskId: String? = null,
    occurrenceKey: String? = null,
): Appointment =
    Appointment(
        id = id,
        title = title,
        notes = null,
        location = location,
        allDay = false,
        startsAt = startsAt,
        endsAt = endsAt,
        startDate = null,
        endDate = null,
        taskId = taskId,
        taskTitle = taskId?.let { "Task $it" },
        occurrenceKey = occurrenceKey,
        assetId = null,
        assetName = null,
        contactId = null,
        contactName = null,
        status = status,
        commentCount = 0,
        createdByUserId = null,
        createdAt = "2026-01-01T00:00:00.000Z",
        updatedAt = "2026-01-01T00:00:00.000Z",
    )

internal fun allDay(
    id: String,
    startDate: String,
    endDate: String,
    title: String = "Visit $id",
    status: String = "planned",
): Appointment =
    timed(id, "", "", title, status).copy(allDay = true, startsAt = null, endsAt = null, startDate = startDate, endDate = endDate)

class AppointmentLogicTest {
    @BeforeTest
    fun german() {
        I18n.locale = "de"
    }

    @AfterTest
    fun reset() {
        I18n.locale = "de"
    }

    @Test
    fun wallClockTimesBecomeInstantsInTheHouseholdZone() {
        val cases =
            listOf(
                Triple("2026-06-15", "09:00", "2026-06-15T07:00:00Z"),
                Triple("2026-01-15", "09:00", "2026-01-15T08:00:00Z"),
                // spring forward: 02:30 does not exist and lands after the gap
                Triple("2026-03-29", "02:30", "2026-03-29T01:30:00Z"),
                // clocks go back: 02:30 happens twice, the first one counts
                Triple("2026-10-25", "02:30", "2026-10-25T00:30:00Z"),
                Triple("2026-10-25", "03:30", "2026-10-25T02:30:00Z"),
            )
        cases.forEach { (date, time, iso) -> assertEquals(ms(iso), zonedTimeToInstant(date, time, ZONE), "$date $time") }
    }

    @Test
    fun instantsGoOutWithMilliseconds() {
        assertEquals("2026-06-15T07:00:00.000Z", instantText(ms("2026-06-15T07:00:00Z")))
        assertEquals("2026-06-15T07:00:00.500Z", instantText(ms("2026-06-15T07:00:00.500Z")))
    }

    @Test
    fun checksTheSpanLikeTheServer() {
        val start = ms("2026-06-15T07:00:00Z")
        val hour = 3_600_000L
        val cases =
            listOf<Pair<ApptWhen, WhenProblem?>>(
                ApptWhen.Timed(start, start + hour) to null,
                ApptWhen.Timed(start, start) to WhenProblem("endsAt", true),
                ApptWhen.Timed(start, start - hour) to WhenProblem("endsAt", true),
                ApptWhen.Timed(start, start + MAX_TIMED_SPAN_MS) to null,
                ApptWhen.Timed(start, start + MAX_TIMED_SPAN_MS + 1) to WhenProblem("endsAt", false),
                ApptWhen.AllDay("2026-06-15", "2026-06-15") to null,
                ApptWhen.AllDay("2026-06-15", "2026-06-28") to null,
                ApptWhen.AllDay("2026-06-15", "2026-06-29") to WhenProblem("endDate", false),
                ApptWhen.AllDay("2026-06-15", "2026-06-14") to WhenProblem("endDate", true),
            )
        cases.forEach { (span, problem) -> assertEquals(problem, whenProblem(span), span.toString()) }
    }

    @Test
    fun anEndAtMidnightBelongsToTheDayBefore() {
        val a = timed("a", "2026-06-15T20:00:00Z", "2026-06-15T22:00:00Z")
        assertEquals(ApptSpan("2026-06-15", "2026-06-15", "22:00", "00:00"), spanOf(a, ZONE).copy(first = "2026-06-15"))
        assertEquals("2026-06-15", spanOf(a, ZONE).last)
        val over = timed("b", "2026-06-15T21:00:00Z", "2026-06-16T01:00:00Z")
        assertEquals(ApptSpan("2026-06-15", "2026-06-16", "23:00", "03:00"), spanOf(over, ZONE))
    }

    @Test
    fun wordsTheDaysAroundToday() {
        val cases =
            listOf(
                "2026-11-21" to "Heute · Sa, 21.11.",
                "2026-11-22" to "Morgen · So, 22.11.",
                "2026-11-20" to "Gestern · Fr, 20.11.",
                "2026-11-26" to "Do, 26.11.",
                "2027-01-04" to "Mo, 04.01.2027",
            )
        cases.forEach { (date, text) -> assertEquals(text, appointmentDayHeading(date, TODAY), date) }
    }

    @Test
    fun wordsWhenAnAppointmentTakesPlace() {
        val cases =
            listOf(
                timed("a", "2026-11-21T08:00:00Z", "2026-11-21T09:00:00Z") to "Sa, 21.11. · 09:00–10:00",
                timed("b", "2026-11-21T22:00:00Z", "2026-11-22T00:00:00Z") to
                    "Sa, 21.11. · 23:00–01:00".let { "Sa, 21.11., 23:00 – So, 22.11., 01:00" },
                allDay("c", "2026-11-21", "2026-11-21") to "Sa, 21.11. · ganztägig",
                allDay("d", "2026-11-21", "2026-11-23") to "Sa, 21.11. – Mo, 23.11. · ganztägig",
            )
        cases.forEach { (a, text) -> assertEquals(text, formatWhen(a, ZONE, TODAY), a.id) }
    }

    @Test
    fun wordsTheTimeOfARow() {
        val oneDay = whenOf(timed("a", "2026-11-21T08:00:00Z", "2026-11-21T09:00:00Z"), ZONE)
        val twoDays = whenOf(timed("b", "2026-11-21T22:00:00Z", "2026-11-22T00:00:00Z").copy(endsAt = "2026-11-22T00:00:00Z"), ZONE)
        val multiple = whenOf(allDay("c", "2026-11-21", "2026-11-23"), ZONE)
        val single = whenOf(allDay("d", "2026-11-21", "2026-11-21"), ZONE)
        assertEquals(ApptTime("09:00", "–10:00"), timeColumn(oneDay, ZONE, TODAY))
        assertEquals(ApptTime("23:00", "bis 22.11."), timeColumn(twoDays, ZONE, TODAY))
        assertEquals(ApptTime("ganztägig", "bis 23.11."), timeColumn(multiple, ZONE, TODAY))
        assertEquals(
            ApptTime("Läuft", "bis 23.11."),
            timeColumn(
                multiple.let {
                    whenOf(timed("e", "2026-11-21T08:00:00Z", "2026-11-23T09:00:00Z"), ZONE)
                },
                ZONE,
                TODAY,
                "2026-11-22",
            ),
        )
        assertEquals(
            ApptTime("Läuft", "bis 10:00"),
            timeColumn(whenOf(timed("e", "2026-11-21T08:00:00Z", "2026-11-23T09:00:00Z"), ZONE), ZONE, TODAY, "2026-11-23"),
        )
        assertEquals(ApptTime("ganztägig", ""), timeColumn(single, ZONE, TODAY))
    }

    @Test
    fun wordsTheStartForABadge() {
        val cases =
            listOf(
                listOf(false, "2026-11-21T08:00:00Z", null, "Heute, 09:00"),
                listOf(false, "2026-11-22T08:00:00Z", null, "Morgen, 09:00"),
                listOf(true, null, "2026-11-22", "Morgen"),
                listOf(false, "2026-11-27T08:00:00Z", null, "Fr, 27.11., 09:00"),
            )
        cases.forEach { (all, startsAt, startDate, text) ->
            assertEquals(text, formatAppointmentStart(all as Boolean, startsAt as String?, startDate as String?, ZONE, TODAY))
        }
    }

    @Test
    fun theLastStatusCannotBeSwitchedOff() {
        val cases =
            listOf(
                Triple(listOf("planned"), "planned", listOf("planned")),
                Triple(listOf("planned"), "done", listOf("planned", "done")),
                Triple(listOf("done", "planned"), "planned", listOf("done")),
                Triple(listOf("planned", "done"), "cancelled", listOf("planned", "done", "cancelled")),
                Triple(listOf("planned", "done", "cancelled"), "done", listOf("planned", "cancelled")),
            )
        cases.forEach { (on, status, expected) -> assertEquals(expected, toggleStatus(on, status), "$on $status") }
        assertEquals(listOf("planned"), defaultStatuses("upcoming"))
        assertEquals(APPOINTMENT_STATUSES, defaultStatuses("past"))
    }

    @Test
    fun theViewsReadTheirRanges() {
        assertEquals("2026-10-22" to null, viewRange("upcoming", TODAY))
        assertEquals("2025-11-21" to "2026-11-20", viewRange("past", TODAY))
    }

    @Test
    fun mergesTheTwoRangesWithoutDoubles() {
        val a = timed("a", "2026-11-20T08:00:00Z", "2026-11-21T09:00:00Z")
        val b = timed("b", "2026-11-19T08:00:00Z", "2026-11-19T09:00:00Z")
        assertEquals(listOf("a", "b"), appendById(listOf(a), listOf(a, b, b)).map { it.id })
    }

    @Test
    fun sortsSoonestFirstLongerFirstThenTitle() {
        val short = timed("s", "2026-11-22T08:00:00Z", "2026-11-22T09:00:00Z", title = "B")
        val long = timed("l", "2026-11-22T08:00:00Z", "2026-11-22T12:00:00Z", title = "C")
        val sameA = timed("x", "2026-11-22T08:00:00Z", "2026-11-22T09:00:00Z", title = "A")
        val earlier = timed("e", "2026-11-21T08:00:00Z", "2026-11-21T09:00:00Z", title = "Z")
        val day = allDay("d", "2026-11-22", "2026-11-22", title = "Day")
        val sorted = listOf(short, long, sameA, earlier, day).sortedWith(compareByStart(ZONE))
        assertEquals(listOf("e", "d", "l", "x", "s"), sorted.map { it.id })
    }

    @Test
    fun theUpcomingListSplitsOpenFromDays() {
        val overPlanned = timed("o", "2026-11-18T08:00:00Z", "2026-11-18T09:00:00Z")
        val overDone = timed("od", "2026-11-18T08:00:00Z", "2026-11-18T09:00:00Z", status = "done")
        val today = timed("t", "2026-11-21T08:00:00Z", "2026-11-21T09:00:00Z")
        val running = allDay("r", "2026-11-19", "2026-11-23")
        val later = timed("l", "2026-11-25T08:00:00Z", "2026-11-25T09:00:00Z")
        val all = listOf(overPlanned, overDone, today, running, later)

        val upcoming = sectionsFor(all, "upcoming", listOf("planned"), TODAY, ZONE)
        assertEquals(listOf("o"), upcoming.open.map { it.id })
        assertEquals(listOf("2026-11-21", "2026-11-25"), upcoming.days.map { it.date })
        assertEquals(listOf("r", "t"), upcoming.days[0].items.map { it.id })
        assertEquals(4, upcoming.count)

        val withDone = sectionsFor(all, "upcoming", listOf("planned", "done"), TODAY, ZONE)
        assertEquals(listOf("o"), withDone.open.map { it.id })
        assertEquals(4, withDone.count)

        val past = sectionsFor(all, "past", APPOINTMENT_STATUSES, TODAY, ZONE)
        assertEquals(emptyList(), past.open)
        assertEquals(listOf("2026-11-18"), past.days.map { it.date })
        assertEquals(
            listOf("o", "od"),
            past.days
                .single()
                .items
                .map { it.id }
                .sorted(),
        )
    }

    @Test
    fun overMeansTheLastDayIsBeforeToday() {
        val endsAtMidnight = timed("a", "2026-11-20T22:00:00Z", "2026-11-20T23:00:00Z")
        assertTrue(isOver(endsAtMidnight, TODAY, ZONE))
        assertFalse(isOver(timed("b", "2026-11-21T22:00:00Z", "2026-11-22T08:00:00Z"), TODAY, ZONE))
        assertTrue(needsClosing(endsAtMidnight, TODAY, ZONE))
        assertFalse(needsClosing(endsAtMidnight.copy(status = "cancelled"), TODAY, ZONE))
        assertNull(null)
    }
}
