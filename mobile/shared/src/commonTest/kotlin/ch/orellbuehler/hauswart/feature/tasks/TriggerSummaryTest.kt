package ch.orellbuehler.hauswart.feature.tasks

import ch.orellbuehler.hauswart.api.generated.Trigger
import ch.orellbuehler.hauswart.api.generated.TriggerCounterDeltaOrEvery
import ch.orellbuehler.hauswart.api.generated.TriggerIntervalSeasonsItem
import ch.orellbuehler.hauswart.i18n.I18n
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals

class TriggerSummaryTest {
    private class Case(
        val name: String,
        val trigger: Trigger,
        val de: String,
        val en: String,
    )

    @AfterTest
    fun reset() {
        I18n.locale = "de"
    }

    private fun interval(
        every: Long,
        unit: String,
        anchor: String = "completion",
        start: String = "2026-10-01",
        seasons: List<TriggerIntervalSeasonsItem>? = null,
    ) = Trigger.Interval(every = every, unit = unit, anchor = anchor, startDate = start, seasons = seasons)

    private fun calendar(
        freq: String,
        interval: Long = 1,
        weekdays: List<Long>? = null,
        day: Long? = null,
        nth: Long? = null,
        months: List<Long>? = null,
        start: String,
    ) = Trigger.Calendar(
        freq = freq,
        interval = interval,
        byWeekday = weekdays,
        byMonthDay = day,
        nth = nth,
        byMonth = months,
        startDate = start,
    )

    private val cases =
        listOf(
            Case(
                "interval from completion",
                interval(3, "month"),
                "Alle 3 Monate ab letzter Erledigung",
                "Every 3 months from the last completion",
            ),
            Case("interval single unit", interval(1, "week"), "Jede Woche ab letzter Erledigung", "Every week from the last completion"),
            Case(
                "interval fixed schedule",
                interval(1, "year", "schedule", "2026-03-15"),
                "Jedes Jahr (fester Rhythmus ab 15.03.2026)",
                "Every year (fixed schedule from 15 Mar 2026)",
            ),
            Case(
                "interval with seasons",
                interval(2, "week", start = "2026-04-01", seasons = listOf(TriggerIntervalSeasonsItem(11, 3, 1, "month"))),
                "Alle 2 Wochen ab letzter Erledigung; November bis März: jeden Monat",
                "Every 2 weeks from the last completion; November to March: every month",
            ),
            Case("weekly one weekday", calendar("weekly", weekdays = listOf(6), start = "2026-10-03"), "Jeden Samstag", "Every Saturday"),
            Case(
                "weekly several weekdays",
                calendar("weekly", 2, weekdays = listOf(5, 1, 3), start = "2026-10-05"),
                "Alle 2 Wochen am Montag, Mittwoch und Freitag",
                "Every 2 weeks on Monday, Wednesday and Friday",
            ),
            Case("weekly default weekday", calendar("weekly", start = "2026-10-07"), "Jeden Mittwoch", "Every Wednesday"),
            Case("monthly on a day", calendar("monthly", day = 15, start = "2026-10-01"), "Jeden Monat am 15.", "Every month on the 15th"),
            Case(
                "monthly last day",
                calendar("monthly", 2, day = -1, start = "2026-10-01"),
                "Alle 2 Monate am letzten Tag",
                "Every 2 months on the last day",
            ),
            Case(
                "monthly second to last",
                calendar("monthly", day = -2, start = "2026-10-01"),
                "Jeden Monat am vorletzten Tag",
                "Every month on the second-to-last day",
            ),
            Case(
                "monthly nth weekday",
                calendar("monthly", weekdays = listOf(1), nth = 1, start = "2026-10-05"),
                "Jeden Monat am ersten Montag",
                "Every month on the first Monday",
            ),
            Case(
                "monthly last weekday in months",
                calendar("monthly", weekdays = listOf(5), nth = -1, months = listOf(3, 9), start = "2026-09-25"),
                "Jeden Monat am letzten Freitag, nur im März und September",
                "Every month on the last Friday, only in March and September",
            ),
            Case(
                "yearly in months",
                calendar("yearly", day = 1, months = listOf(3, 9), start = "2026-03-01"),
                "Jedes Jahr am 1. im März und September",
                "Every year on the 1st in March and September",
            ),
            Case(
                "yearly default",
                calendar("yearly", 2, start = "2026-05-22"),
                "Alle 2 Jahre am 22. im Mai",
                "Every 2 years on the 22nd in May",
            ),
            Case("min per month", Trigger.MinPerPeriod(period = "month", count = 1), "Mindestens 1× pro Monat", "At least 1× per month"),
            Case(
                "min per quarter",
                Trigger.MinPerPeriod(period = "quarter", count = 3),
                "Mindestens 3× pro Quartal",
                "At least 3× per quarter",
            ),
            Case(
                "counter with unit",
                Trigger.CounterDelta(entityId = "sensor.washer_cycles", threshold = 5.0, unit = "Waschgänge"),
                "Alle 5 Waschgänge (Home-Assistant-Zähler)",
                "Every 5 Waschgänge (Home Assistant counter)",
            ),
            Case(
                "counter without unit",
                Trigger.CounterDelta(entityId = "sensor.hours", threshold = 250.5),
                "Bei einem Zählerzuwachs von 250.5 (Home-Assistant-Zähler)",
                "At a meter increase of 250.5 (Home Assistant counter)",
            ),
            Case(
                "odometer",
                Trigger.CounterDelta(entityId = "odometer:abc", threshold = 15000.0, unit = "km"),
                "Alle 15'000 km (Tachostand)",
                "Every 15,000 km (odometer)",
            ),
            Case(
                "odometer with time limit",
                Trigger.CounterDelta(
                    entityId = "odometer:abc",
                    threshold = 15000.0,
                    unit = "km",
                    orEvery = TriggerCounterDeltaOrEvery(12, "month"),
                ),
                "Alle 15'000 km (Tachostand), oder alle 12 Monate, je nachdem, was zuerst eintritt",
                "Every 15,000 km (odometer), or every 12 months, whichever comes first",
            ),
            Case(
                "counter with a year limit",
                Trigger.CounterDelta(
                    entityId = "sensor.hours",
                    threshold = 250.0,
                    unit = "h",
                    orEvery = TriggerCounterDeltaOrEvery(1, "year"),
                ),
                "Alle 250 h (Home-Assistant-Zähler), oder jedes Jahr, je nachdem, was zuerst eintritt",
                "Every 250 h (Home Assistant counter), or every year, whichever comes first",
            ),
            Case(
                "state condition",
                Trigger.StateCondition(entityId = "sensor.filter_pressure", op = "gt", value = JsonPrimitive(80)),
                "Wenn sensor.filter_pressure grösser als 80 ist",
                "When sensor.filter_pressure is greater than 80",
            ),
            Case(
                "state held",
                Trigger.StateCondition(entityId = "binary_sensor.window", op = "eq", value = JsonPrimitive("on"), forMinutes = 30),
                "Wenn binary_sensor.window gleich on ist, seit mindestens 30 Min.",
                "When binary_sensor.window is equal to on, for at least 30 min",
            ),
            Case(
                "calendar same day",
                Trigger.HaCalendar(entityId = "calendar.waste", offsetDays = 0),
                "Am Tag eines Kalendertermins (Home Assistant)",
                "On the day of a calendar event (Home Assistant)",
            ),
            Case(
                "calendar day before",
                Trigger.HaCalendar(entityId = "calendar.waste", offsetDays = -1, summaryMatch = "Karton"),
                "1 Tag vor einem Kalendertermin (Home Assistant), Titel enthält «Karton»",
                "1 day before a calendar event (Home Assistant), title contains \"Karton\"",
            ),
            Case(
                "calendar days after",
                Trigger.HaCalendar(entityId = "calendar.waste", offsetDays = 3),
                "3 Tage nach einem Kalendertermin (Home Assistant)",
                "3 days after a calendar event (Home Assistant)",
            ),
            Case("one off", Trigger.OneOff(date = "2027-03-15"), "Einmalig am 15.03.2027", "Once on 15 Mar 2027"),
            Case(
                "bill",
                Trigger.KeptBill(billId = "b1", dueDate = "2026-12-31", status = "open"),
                "Rechnung fällig am 31.12.2026",
                "Bill due on 31 Dec 2026",
            ),
            Case("warranty", Trigger.Warranty(until = "2027-11-20"), "Garantie bis 20.11.2027", "Warranty until 20 Nov 2027"),
            Case(
                "extended warranty",
                Trigger.Warranty(until = "2027-11-20", extendedUntil = "2029-11-20"),
                "Garantie bis 20.11.2027, verlängert bis 20.11.2029",
                "Warranty until 20 Nov 2027, extended until 20 Nov 2029",
            ),
        )

    @Test
    fun describesEveryTriggerInBothLanguages() {
        cases.forEach { c ->
            I18n.locale = "de"
            assertEquals(c.de, describeTrigger(c.trigger), "de: ${c.name}")
            I18n.locale = "en"
            assertEquals(c.en, describeTrigger(c.trigger), "en: ${c.name}")
        }
    }

    @Test
    fun anUnknownTriggerHasAText() {
        assertEquals("Ein Rhythmus, den diese App-Version nicht kennt", describeTrigger(Trigger.Unknown))
    }
}
