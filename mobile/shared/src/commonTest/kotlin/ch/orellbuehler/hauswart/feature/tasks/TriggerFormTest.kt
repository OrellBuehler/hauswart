package ch.orellbuehler.hauswart.feature.tasks

import ch.orellbuehler.hauswart.api.generated.Trigger
import ch.orellbuehler.hauswart.api.generated.TriggerCounterDeltaAutoCompleteOnReset
import ch.orellbuehler.hauswart.api.generated.TriggerCounterDeltaOrEvery
import ch.orellbuehler.hauswart.api.generated.TriggerIntervalAutoCompleteItem
import ch.orellbuehler.hauswart.api.generated.TriggerIntervalSeasonsItem
import ch.orellbuehler.hauswart.api.generated.TriggerStateConditionEstimateFrom
import ch.orellbuehler.hauswart.i18n.I18n
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TriggerFormTest {
    private val today = "2026-11-21"

    @AfterTest
    fun reset() {
        I18n.locale = "de"
    }

    private val rules =
        listOf(
            TriggerIntervalAutoCompleteItem.CounterReset("sensor.filter", 5.5),
            TriggerIntervalAutoCompleteItem.StateChange("binary_sensor.filter", "off", "on"),
        )

    private val roundTrips: List<Pair<String, Trigger>> =
        listOf(
            "interval" to
                Trigger.Interval(
                    every = 3,
                    unit = "month",
                    anchor = "schedule",
                    startDate = "2026-10-01",
                    seasons = listOf(TriggerIntervalSeasonsItem(11, 3, 1, "month")),
                    autoComplete = rules,
                ),
            "interval plain" to Trigger.Interval(every = 1, unit = "week", anchor = "completion", startDate = "2026-10-01"),
            "calendar weekly" to
                Trigger.Calendar(freq = "weekly", interval = 2, byWeekday = listOf(1, 3, 5), startDate = "2026-10-05", earlyDays = 3),
            "calendar monthly day" to
                Trigger.Calendar(freq = "monthly", interval = 1, byMonthDay = -1, byMonth = listOf(3, 9), startDate = "2026-09-25"),
            "calendar nth" to Trigger.Calendar(freq = "monthly", interval = 1, byWeekday = listOf(5), nth = -1, startDate = "2026-09-25"),
            "calendar yearly" to
                Trigger.Calendar(freq = "yearly", interval = 1, byMonthDay = 1, byMonth = listOf(3, 9), startDate = "2026-03-01"),
            "min per period" to Trigger.MinPerPeriod(period = "quarter", count = 3, remindFromFraction = 0.5, startDate = "2026-01-01"),
            "one off" to Trigger.OneOff(date = "2027-03-15"),
            "warranty" to Trigger.Warranty(until = "2027-11-20", extendedUntil = "2029-11-20", leadDays = 14),
            "counter" to
                Trigger.CounterDelta(
                    entityId = "odometer:abc",
                    threshold = 15000.0,
                    unit = "km",
                    orEvery = TriggerCounterDeltaOrEvery(12, "month"),
                    autoCompleteOnReset = TriggerCounterDeltaAutoCompleteOnReset(2.0),
                    autoComplete = rules,
                ),
            "state number" to
                Trigger.StateCondition(
                    entityId = "sensor.p",
                    op = "gt",
                    value = JsonPrimitive(80),
                    forMinutes = 30,
                    estimateFrom = TriggerStateConditionEstimateFrom("sensor.r", 10.5, "down"),
                ),
            "state text" to Trigger.StateCondition(entityId = "binary_sensor.w", op = "eq", value = JsonPrimitive("on")),
            "ha calendar" to Trigger.HaCalendar(entityId = "calendar.waste", summaryMatch = "Karton", offsetDays = -1, time = "07:30"),
        )

    @Test
    fun everyEditableTriggerSurvivesTheFormUnchanged() {
        roundTrips.forEach { (name, trigger) ->
            val form = assertNotNull(triggerFormOf(trigger), name)
            val built = form.toTrigger()
            assertEquals(emptyMap(), built.errors, name)
            assertEquals(trigger, built.trigger, name)
        }
    }

    @Test
    fun triggersTheBuildCannotEditHaveNoForm() {
        assertNull(triggerFormOf(Trigger.Unknown))
        assertNull(triggerFormOf(Trigger.KeptBill(billId = "b", dueDate = "2026-12-31", status = "open")))
        val withUnknownRule =
            Trigger.Interval(
                every = 1,
                unit = "week",
                anchor = "completion",
                startDate = today,
                autoComplete = listOf(TriggerIntervalAutoCompleteItem.Unknown),
            )
        assertNull(triggerFormOf(withUnknownRule))
    }

    private fun errorsOf(form: TriggerForm): Map<String, String> = form.toTrigger().errors

    @Test
    fun invalidFormsReportTheFieldsThatAreWrong() {
        val interval = defaultTriggerForm(TRIGGER_INTERVAL, today)
        assertEquals(setOf("every"), errorsOf(interval.copy(every = "0")).keys)
        assertEquals(setOf("every"), errorsOf(interval.copy(every = "")).keys)
        assertEquals(setOf("startDate"), errorsOf(interval.copy(startDate = "2026-13-01")).keys)
        assertEquals(setOf("seasons.0.every"), errorsOf(interval.addSeason().withSeason(0, "every", "x")).keys)
        val calendar = defaultTriggerForm(TRIGGER_CALENDAR, today)
        assertEquals(setOf("weekdays"), errorsOf(calendar.copy(weekdays = emptyList())).keys)
        val monthly = calendar.withField("freq", "monthly")
        assertEquals(setOf("monthDay"), errorsOf(monthly.copy(monthDay = "0")).keys)
        assertEquals(setOf("monthDay"), errorsOf(monthly.copy(monthDay = "32")).keys)
        assertEquals(emptyMap(), errorsOf(monthly))
        assertEquals(setOf("count"), errorsOf(defaultTriggerForm(TRIGGER_MIN_PER_PERIOD, today).copy(count = "-1")).keys)
        assertEquals(setOf("date"), errorsOf(defaultTriggerForm(TRIGGER_ONE_OFF, today).copy(date = "")).keys)
        assertEquals(setOf("until"), errorsOf(defaultTriggerForm(TRIGGER_WARRANTY, today).copy(until = "soon")).keys)
        val counter = defaultTriggerForm(TRIGGER_COUNTER_DELTA, today)
        assertEquals(setOf("entityId"), errorsOf(counter).keys)
        assertEquals(setOf("entityId", "threshold"), errorsOf(counter.copy(threshold = "0")).keys)
        assertEquals(setOf("orEveryEvery"), errorsOf(counter.copy(entityId = "sensor.c", orEvery = true, orEveryEvery = "")).keys)
        val state = defaultTriggerForm(TRIGGER_STATE_CONDITION, today).copy(entityId = "sensor.p")
        assertEquals(setOf("value"), errorsOf(state).keys)
        assertEquals(setOf("value"), errorsOf(state.copy(value = "high")).keys)
        assertEquals(emptyMap(), errorsOf(state.copy(value = "high", op = "eq")))
        assertEquals(setOf("estimateEntityId", "estimateTarget"), errorsOf(state.copy(value = "5", estimate = true)).keys)
        val ha = defaultTriggerForm(TRIGGER_HA_CALENDAR, today).copy(entityId = "calendar.x")
        assertEquals(setOf("offsetDays"), errorsOf(ha.copy(offsetDays = "400")).keys)
        val withRule = interval.addRule(RULE_STATE_CHANGE)
        assertEquals(setOf("autoComplete.0.entityId", "autoComplete.0.to"), errorsOf(withRule).keys)
    }

    @Test
    fun messagesAreTheWebTexts() {
        val errors = errorsOf(defaultTriggerForm(TRIGGER_INTERVAL, today).copy(every = ""))
        assertEquals("Pflichtfeld.", errors["every"])
        assertEquals("Bitte eine Zahl angeben.", errorsOf(defaultTriggerForm(TRIGGER_INTERVAL, today).copy(every = "x"))["every"])
        assertEquals("Höchstens 3650.", errorsOf(defaultTriggerForm(TRIGGER_INTERVAL, today).copy(every = "9999"))["every"])
    }

    @Test
    fun changingTheTypeStartsFromTheDefaultsAndKeepsTheStartDate() {
        val interval = defaultTriggerForm(TRIGGER_INTERVAL, today).copy(startDate = "2027-01-01", every = "9")
        val calendar = changeTriggerType(interval, TRIGGER_CALENDAR, today)
        assertEquals("2027-01-01", calendar.startDate)
        assertEquals(listOf("6"), calendar.weekdays)
        val oneOff = changeTriggerType(calendar, TRIGGER_ONE_OFF, today)
        assertEquals("2026-11-28", oneOff.date)
        assertFalse(oneOff.hasAutoComplete)
        assertEquals(interval, changeTriggerType(interval, TRIGGER_INTERVAL, today))
    }

    @Test
    fun calendarFrequencyAndDayModeAdjustTheDependentFields() {
        var form = defaultTriggerForm(TRIGGER_CALENDAR, today).copy(startDate = "2026-03-05")
        form = form.withField("freq", "yearly")
        assertEquals(listOf("3"), form.months)
        assertEquals("5", form.monthDay)
        assertTrue(form.weekdays.isEmpty())
        form = form.withField("dayMode", "nth")
        assertEquals(listOf("4"), form.weekdays)
        form = form.toggle("weekdays", "2")
        assertEquals(listOf("2"), form.weekdays)
        form = form.toggle("months", "9").toggle("months", "3")
        assertEquals(listOf("9"), form.months)
        form = form.withField("freq", "weekly")
        assertEquals(listOf("2"), form.weekdays)
        assertEquals("day", form.dayMode)
        form = form.toggle("weekdays", "1").toggle("weekdays", "2")
        assertEquals(listOf("1"), form.weekdays)
    }

    @Test
    fun intervalPresetsSetAndRecognizeTheRhythm() {
        val form = defaultTriggerForm(TRIGGER_INTERVAL, today).withIntervalPreset(4)
        assertEquals("1", form.every)
        assertEquals("year", form.unit)
        assertEquals(4, form.activeIntervalPreset())
        assertEquals(-1, form.copy(every = "2").activeIntervalPreset())
    }

    @Test
    fun rulesAreAddedRetypedAndLimited() {
        var form = defaultTriggerForm(TRIGGER_INTERVAL, today)
        repeat(7) { form = form.addRule(RULE_COUNTER_RESET) }
        assertEquals(5, form.autoComplete.size)
        form = form.withRule(0, "entityId", "sensor.a").withRule(0, "type", RULE_STATE_CHANGE)
        assertEquals(RULE_STATE_CHANGE, form.autoComplete[0].type)
        assertEquals("sensor.a", form.autoComplete[0].entityId)
        form = form.removeRule(0)
        assertEquals(4, form.autoComplete.size)
        assertFalse(defaultTriggerForm(TRIGGER_ONE_OFF, today).addRule(RULE_COUNTER_RESET).autoComplete.isNotEmpty())
    }

    @Test
    fun odometerCounterFillsTheEntityAndUnit() {
        val form = odometerCounterForm(defaultTriggerForm(TRIGGER_COUNTER_DELTA, today), "a1", "mi")
        assertEquals("odometer:a1", form.entityId)
        assertEquals("mi", form.counterUnit)
        val trigger = assertNotNull(form.toTrigger().trigger)
        assertEquals("a1", odometerAssetOf(trigger))
    }

    @Test
    fun stateValuesAreNumbersWhenTheyLookLikeOne() {
        val form = defaultTriggerForm(TRIGGER_STATE_CONDITION, today).copy(entityId = "sensor.p", value = "80,5")
        val trigger = form.toTrigger().trigger as Trigger.StateCondition
        assertEquals(JsonPrimitive(80.5), trigger.value)
        assertEquals(JsonPrimitive(80), (form.copy(value = "80").toTrigger().trigger as Trigger.StateCondition).value)
    }
}
