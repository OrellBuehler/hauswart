package ch.orellbuehler.hauswart.feature.reminders

import ch.orellbuehler.hauswart.feature.applink.AppLink
import ch.orellbuehler.hauswart.feature.applink.LINK_HOME
import ch.orellbuehler.hauswart.feature.applink.LINK_TASK
import ch.orellbuehler.hauswart.feature.notifications.notificationText
import ch.orellbuehler.hauswart.i18n.I18n
import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ReminderSyncTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    // 2026-11-21 06:00 in Zurich.
    private val now = requireNotNull(zonedMillis("2026-11-21", "06:00", "Europe/Zurich"))

    @BeforeTest
    fun german() {
        I18n.locale = "de"
        server.household()
        ReminderPrefs(server.settings).save(ReminderSettings(enabled = true))
        server.on("GET", "/api/v1/dashboard", dashboard())
        server.on("GET", "/api/v1/appointments", """{"items":[],"nextCursor":null}""")
        server.on("GET", "/api/v1/notifications", """{"items":[],"nextCursor":null}""")
    }

    @AfterTest
    fun tearDown() = server.close()

    private fun sync() = ReminderSync(app) { now }

    private fun task(
        id: String,
        date: String?,
        status: String = "due",
        estimated: Boolean = false,
    ) = """{"taskId":"$id","title":"Task $id","category":"cleaning","priority":"normal","assetId":null,"assetName":null,
        "roomId":null,"roomName":null,"assigneeUserId":null,"assigneeName":null,"status":"$status","dueKind":"exact",
        "date":${if (date == null) "null" else "\"$date\""},"estimated":$estimated,"estimate":null,"progress":null,
        "stepCount":0,"openNoteCount":0,"odometerAssetId":null,"nextAppointment":null}"""

    private fun dashboard(vararg today: String) =
        """{"today":"2026-11-21","generatedAt":"2026-11-21T05:00:00.000Z",
        "counts":{"overdue":0,"today":0,"thisWeek":0,"preparations":0},
        "upcoming":{"overdue":[],"today":[${today.joinToString(",")}],"thisWeek":[],"later":[],"signalBased":[]},
        "preparations":[],"recentCompletions":[],"openDefects":[],"expiringWarranties":[],"orderNow":[],
        "costsYearToDate":{"year":2026,"currency":"CHF","totalMinor":0,"byCategory":[],"byBook":[]},
        "balances":null,"budgetAlerts":null,"pendingFinanceSuggestions":0,"reviewNeededCount":0,"pendingReceiptCount":0}"""

    private fun notification(
        id: String,
        kind: String = "comment",
        createdAt: String = "2026-11-21T04:00:00.000Z",
    ) = """{"id":"$id","kind":"$kind","taskId":"t1","titleKey":"notification_info","params":{"title":"Hello"},
        "url":"/tasks/t1","createdAt":"$createdAt","readAt":null}"""

    private fun notifications(vararg items: String) =
        server.on("GET", "/api/v1/notifications", """{"items":[${items.joinToString(",")}],"nextCursor":null}""")

    @Test
    fun plansTheDatedTasksOfTheDashboard() =
        runTest {
            server.on(
                "GET",
                "/api/v1/dashboard",
                dashboard(
                    task("a", "2026-11-21"),
                    task("b", null),
                    task("c", "2026-11-21", status = "snoozed"),
                    task("d", "2026-11-21", estimated = true),
                ),
            )
            val plan = sync().plan()
            assertEquals(listOf("task:a:2026-11-21:due"), plan.map { it.id })
            assertNull(sync().lastError)
        }

    @Test
    fun nothingIsFetchedWhileRemindersAreOff() =
        runTest {
            ReminderPrefs(server.settings).save(ReminderSettings(enabled = false))
            assertTrue(sync().plan().isEmpty())
            assertTrue(server.requests.isEmpty())
        }

    @Test
    fun theFirstSyncRemembersNotificationsWithoutShowingThem() =
        runTest {
            notifications(notification("n1"))
            val reminders = sync()
            assertTrue(reminders.plan().none { it.id.startsWith("note:") })

            notifications(notification("n1"), notification("n2"))
            val second = reminders.plan()
            assertEquals(listOf("note:n2"), second.filter { it.id.startsWith("note:") }.map { it.id })
            assertEquals(AppLink(LINK_TASK, "t1"), second.first { it.id == "note:n2" }.link)
            assertEquals(
                notificationText("notification_info", mapOf("title" to JsonPrimitive("Hello"))),
                second.first { it.id == "note:n2" }.body,
            )

            val third = reminders.plan()
            assertTrue(third.none { it.id.startsWith("note:") })
        }

    @Test
    fun oldNotificationsAreNotShown() =
        runTest {
            val reminders = sync()
            reminders.plan()
            notifications(notification("n9", createdAt = "2026-11-10T04:00:00.000Z"))
            assertTrue(reminders.plan().isEmpty())
        }

    @Test
    fun aFailedSyncHandsBackTheLastPlanAndKeepsTheError() =
        runTest {
            server.on("GET", "/api/v1/dashboard", dashboard(task("a", "2026-11-21")))
            val reminders = sync()
            val good = reminders.plan()
            assertEquals(1, good.size)

            server.onError("GET", "/api/v1/dashboard", HttpStatusCode.InternalServerError, "internal_error")
            val again = reminders.plan()
            assertEquals(good, again)
            assertNotNull(reminders.lastError)
        }

    @Test
    fun twoSyncsAtOnceShareOneRun() =
        runTest {
            val reminders = sync()
            reminders.plan()
            val before = server.requestsTo("GET", "/api/v1/dashboard").size
            notifications(notification("n2"))
            server.latencyMillis = 300
            val both = listOf(async { reminders.plan() }, async { reminders.plan() }).awaitAll()
            assertEquals(1, server.requestsTo("GET", "/api/v1/dashboard").size - before)
            assertEquals(listOf("note:n2"), both[0].filter { it.id.startsWith("note:") }.map { it.id })
            assertEquals(both[0], both[1])
        }

    @Test
    fun aRefusedTokenEndsTheSessionAndIsReported() =
        runTest {
            val reminders = sync()
            server.onError("GET", "/api/v1/dashboard", HttpStatusCode.Unauthorized, "unauthenticated")
            reminders.plan()
            assertTrue(reminders.sessionEnded)
            assertTrue(!app.session.state.value.signedIn)
            val notice = reminders.sessionEndedNotice()
            assertEquals(tr("m_session_ended_title"), notice.title)
            assertEquals(tr("m_session_ended_body"), notice.body)
            assertEquals(AppLink(LINK_HOME, null), notice.link)
        }

    @Test
    fun aFailureThatLeavesTheSessionAloneIsNotReported() =
        runTest {
            val reminders = sync()
            server.onError("GET", "/api/v1/dashboard", HttpStatusCode.InternalServerError, "internal_error")
            reminders.plan()
            assertTrue(!reminders.sessionEnded)
            assertTrue(app.session.state.value.signedIn)
        }

    @Test
    fun theStoredPlanSurvivesAndDropsWhatPassed() =
        runTest {
            server.on("GET", "/api/v1/dashboard", dashboard(task("a", "2026-11-21")))
            sync().plan()
            assertEquals(1, ReminderSync(app) { now }.stored().size)
            assertTrue(ReminderSync(app) { now + 4 * 3_600_000L }.stored().isEmpty())
        }

    @Test
    fun forgettingClearsThePlan() =
        runTest {
            server.on("GET", "/api/v1/dashboard", dashboard(task("a", "2026-11-21")))
            val reminders = sync()
            reminders.plan()
            reminders.forget()
            assertTrue(reminders.stored().isEmpty())
        }

    @Test
    fun signedOutPlansNothing() =
        runTest {
            app.session.signOut()
            assertTrue(sync().plan().isEmpty())
        }

    @Test
    fun runHandsThePlanToTheCallback() =
        runTest {
            server.on("GET", "/api/v1/dashboard", dashboard(task("a", "2026-11-21")))
            val got = CompletableDeferred<List<PlannedReminder>>()
            sync().run { got.complete(it) }
            val plan = withContext(Dispatchers.Default) { withTimeout(60_000) { got.await() } }
            assertEquals(1, plan.size)
        }
}
