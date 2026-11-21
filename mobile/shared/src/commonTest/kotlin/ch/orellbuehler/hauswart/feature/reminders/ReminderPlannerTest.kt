package ch.orellbuehler.hauswart.feature.reminders

import ch.orellbuehler.hauswart.feature.applink.AppLink
import ch.orellbuehler.hauswart.feature.applink.LINK_APPOINTMENT
import ch.orellbuehler.hauswart.feature.applink.LINK_NOTIFICATIONS
import ch.orellbuehler.hauswart.feature.applink.LINK_TASK
import ch.orellbuehler.hauswart.feature.applink.LINK_TASKS
import ch.orellbuehler.hauswart.i18n.I18n
import ch.orellbuehler.hauswart.i18n.tr
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class ReminderPlannerTest {
    private val zone = "Europe/Zurich"

    @BeforeTest
    fun german() {
        I18n.locale = "de"
    }

    private fun at(
        date: String,
        time: String,
    ): Long = requireNotNull(zonedMillis(date, time, zone))

    private fun input(
        now: Long,
        today: String,
        tasks: List<ReminderTask> = emptyList(),
        appointments: List<ReminderAppointment> = emptyList(),
        notifications: List<ReminderServerNotification> = emptyList(),
        settings: ReminderSettings = ReminderSettings(enabled = true),
    ) = ReminderPlanInput(tasks, appointments, notifications, settings, today, now, zone)

    private fun task(
        id: String,
        date: String,
    ) = ReminderTask(id, "Task $id", date)

    @Test
    fun nothingWhenSwitchedOff() {
        val plan =
            ReminderPlanner.plan(
                input(at("2026-11-21", "06:00"), "2026-11-21", listOf(task("a", "2026-11-21")), settings = ReminderSettings()),
            )
        assertTrue(plan.isEmpty())
    }

    @Test
    fun aTaskDueTodayRemindsAtTheTimeOfDayWhenItIsStillAhead() {
        val plan = ReminderPlanner.plan(input(at("2026-11-21", "06:00"), "2026-11-21", listOf(task("a", "2026-11-21"))))
        val reminder = plan.single()
        assertEquals(at("2026-11-21", "08:00"), reminder.fireAt)
        assertEquals("task:a:2026-11-21:due", reminder.id)
        assertEquals(tr("m_reminder_task_due"), reminder.title)
        assertEquals("Task a", reminder.body)
        assertEquals(AppLink(LINK_TASK, "a"), reminder.link)
    }

    @Test
    fun aTaskDueTodayAfterTheTimeOfDayIsNotRemindedAgainToday() {
        val plan = ReminderPlanner.plan(input(at("2026-11-21", "09:00"), "2026-11-21", listOf(task("a", "2026-11-21"))))
        assertEquals(listOf("task:a:2026-11-22:due"), plan.map { it.id })
        assertEquals(tr("m_reminder_task_overdue"), plan.single().title)
    }

    @Test
    fun anOverdueTaskRemindsAtTheNextTimeOfDay() {
        val early = ReminderPlanner.plan(input(at("2026-11-21", "06:00"), "2026-11-21", listOf(task("a", "2026-11-10"))))
        assertEquals(at("2026-11-21", "08:00"), early.single().fireAt)
        assertEquals(tr("m_reminder_task_overdue"), early.single().title)
        val late = ReminderPlanner.plan(input(at("2026-11-21", "23:00"), "2026-11-21", listOf(task("a", "2026-11-10"))))
        assertEquals(at("2026-11-22", "08:00"), late.single().fireAt)
    }

    @Test
    fun dueSoonAddsAReminderTheDayBefore() {
        val settings = ReminderSettings(enabled = true, timeOfDay = "07:30", dueSoon = true)
        val plan =
            ReminderPlanner.plan(
                input(at("2026-11-21", "06:00"), "2026-11-21", listOf(task("a", "2026-11-25")), settings = settings),
            )
        assertEquals(listOf("task:a:2026-11-24:soon", "task:a:2026-11-25:due"), plan.map { it.id })
        assertEquals(at("2026-11-24", "07:30"), plan.first().fireAt)
        assertEquals(tr("m_reminder_task_soon"), plan.first().title)
    }

    @Test
    fun dueSoonForTomorrowIsSkippedOnceTheTimeHasPassed() {
        val settings = ReminderSettings(enabled = true, dueSoon = true)
        val plan =
            ReminderPlanner.plan(
                input(at("2026-11-21", "09:00"), "2026-11-21", listOf(task("a", "2026-11-22")), settings = settings),
            )
        assertEquals(listOf("task:a:2026-11-22:due"), plan.map { it.id })
    }

    @Test
    fun tasksFurtherAheadThanTheHorizonAreLeftOut() {
        val plan =
            ReminderPlanner.plan(
                input(at("2026-11-21", "06:00"), "2026-11-21", listOf(task("a", "2027-02-01"), task("b", "2026-12-21"))),
            )
        assertEquals(listOf("task:b:2026-12-21:due"), plan.map { it.id })
    }

    @Test
    fun manyTasksAtTheSameTimeBecomeOneNotification() {
        val tasks = (1..5).map { task("t$it", "2026-11-21") }
        val plan = ReminderPlanner.plan(input(at("2026-11-21", "06:00"), "2026-11-21", tasks))
        val reminder = plan.single()
        assertEquals("tasks:2026-11-21:due", reminder.id)
        assertEquals(tr("m_reminder_tasks_due", "count" to 5), reminder.title)
        assertEquals("Task t1, Task t2, Task t3 …", reminder.body)
        assertEquals(AppLink(LINK_TASKS, null), reminder.link)
    }

    @Test
    fun exactlyThreeTasksStayIndividual() {
        val tasks = (1..3).map { task("t$it", "2026-11-21") }
        assertEquals(3, ReminderPlanner.plan(input(at("2026-11-21", "06:00"), "2026-11-21", tasks)).size)
    }

    @Test
    fun aTimedAppointmentRemindsTheLeadTimeBeforeItStarts() {
        val start = at("2026-11-21", "14:30")
        val appointment = ReminderAppointment("p1", "Boiler service", "Cellar", false, start, null)
        val plan = ReminderPlanner.plan(input(at("2026-11-21", "10:00"), "2026-11-21", appointments = listOf(appointment)))
        val reminder = plan.single()
        assertEquals(start - 60 * 60_000L, reminder.fireAt)
        assertEquals("appt:p1:$start", reminder.id)
        assertEquals(tr("m_reminder_appointment", "title" to "Boiler service"), reminder.title)
        assertEquals("14:30 · Cellar", reminder.body)
        assertEquals(AppLink(LINK_APPOINTMENT, "p1"), reminder.link)
    }

    @Test
    fun theLeadTimeIsConfigurableAndANearAppointmentHasNoReminderLeft() {
        val start = at("2026-11-21", "14:30")
        val appointment = ReminderAppointment("p1", "Boiler service", null, false, start, null)
        val settings = ReminderSettings(enabled = true, appointmentLeadMinutes = 15)
        val plan =
            ReminderPlanner.plan(
                input(at("2026-11-21", "10:00"), "2026-11-21", appointments = listOf(appointment), settings = settings),
            )
        assertEquals(start - 15 * 60_000L, plan.single().fireAt)
        assertTrue(ReminderPlanner.plan(input(at("2026-11-21", "14:00"), "2026-11-21", appointments = listOf(appointment))).isEmpty())
    }

    @Test
    fun anAppointmentOnALaterDayNamesTheDate() {
        val start = at("2026-11-24", "09:00")
        val appointment = ReminderAppointment("p1", "Chimney sweep", null, false, start, null)
        val plan = ReminderPlanner.plan(input(at("2026-11-21", "10:00"), "2026-11-21", appointments = listOf(appointment)))
        assertEquals("24.11. 09:00", plan.single().body)
    }

    @Test
    fun anAllDayAppointmentRemindsAtTheTimeOfDay() {
        val appointment = ReminderAppointment("p2", "Delivery", null, true, null, "2026-11-23")
        val plan = ReminderPlanner.plan(input(at("2026-11-21", "10:00"), "2026-11-21", appointments = listOf(appointment)))
        assertEquals(at("2026-11-23", "08:00"), plan.single().fireAt)
        assertEquals(tr("m_reminder_all_day"), plan.single().body)
    }

    @Test
    fun newServerNotificationsAreShownAtOnceExceptWhatTasksCover() {
        val now = at("2026-11-21", "10:00")
        val notes =
            listOf(
                ReminderServerNotification("n1", "comment", "Anna commented", AppLink(LINK_TASK, "t1")),
                ReminderServerNotification("n2", "overdue", "Task is overdue", null),
                ReminderServerNotification("n3", "info", "Something", null),
            )
        val plan = ReminderPlanner.plan(input(now, "2026-11-21", notifications = notes))
        assertEquals(listOf("note:n1", "note:n3"), plan.map { it.id })
        assertTrue(plan.all { it.fireAt == now })
        assertEquals(AppLink(LINK_NOTIFICATIONS, null), plan.last().link)
    }

    @Test
    fun neverMoreThanSixtyKeepingTheEarliest() {
        val tasks = (1..80).map { task("t$it", "2026-11-21") }
        val dated = (1..29).map { ReminderTask("d$it", "Dated $it", "2026-12-${(it % 28 + 1).toString().padStart(2, '0')}") }
        val spread =
            (0 until 70).map {
                ReminderAppointment(
                    "p$it",
                    "A$it",
                    null,
                    false,
                    at("2026-11-22", "12:00") + it * 60_000L * 120,
                    null,
                )
            }
        val plan = ReminderPlanner.plan(input(at("2026-11-21", "06:00"), "2026-11-21", tasks + dated, spread))
        assertEquals(MAX_PLANNED_REMINDERS, plan.size)
        assertEquals(plan.sortedBy { it.fireAt }.map { it.id }, plan.map { it.id })
        assertEquals(plan.size, plan.map { it.id }.toSet().size)
    }

    @Test
    fun idsStayTheSameWhenPlanningAgain() {
        val tasks = listOf(task("a", "2026-11-22"), task("b", "2026-11-25"))
        val first = ReminderPlanner.plan(input(at("2026-11-21", "06:00"), "2026-11-21", tasks))
        val second = ReminderPlanner.plan(input(at("2026-11-21", "07:00"), "2026-11-21", tasks))
        assertEquals(first, second)
    }

    @Test
    fun springForwardMovesAMissingTimeAfterTheGap() {
        val settings = ReminderSettings(enabled = true, timeOfDay = "02:30")
        val plan =
            ReminderPlanner.plan(
                input(at("2026-03-28", "12:00"), "2026-03-28", listOf(task("a", "2026-03-29")), settings = settings),
            )
        // 02:30 does not exist on 2026-03-29 in Zurich: the reminder lands at 03:30 (01:30 UTC).
        assertEquals(1_774_747_800_000L, plan.single().fireAt)
    }

    @Test
    fun dayLengthChangesDoNotShiftTheTimeOfDay() {
        val settings = ReminderSettings(enabled = true, timeOfDay = "08:00")
        val before =
            ReminderPlanner.plan(
                input(
                    at("2026-10-24", "06:00"),
                    "2026-10-24",
                    listOf(task("a", "2026-10-24"), task("b", "2026-10-25")),
                    settings = settings,
                ),
            )
        assertEquals(at("2026-10-24", "08:00"), before[0].fireAt)
        assertEquals(at("2026-10-25", "08:00"), before[1].fireAt)
        // The clocks went back in between: the gap is 25 hours, the wall-clock time is still 08:00.
        assertEquals(25 * 3_600_000L, before[1].fireAt - before[0].fireAt)
        assertNotEquals(24 * 3_600_000L, before[1].fireAt - before[0].fireAt)
    }

    @Test
    fun anAppointmentLeadCrossesTheClockChangeInRealTime() {
        val start = at("2026-10-25", "03:30")
        val appointment = ReminderAppointment("p1", "Early", null, false, start, null)
        val plan = ReminderPlanner.plan(input(at("2026-10-24", "12:00"), "2026-10-24", appointments = listOf(appointment)))
        assertEquals(start - 3_600_000L, plan.single().fireAt)
    }
}
