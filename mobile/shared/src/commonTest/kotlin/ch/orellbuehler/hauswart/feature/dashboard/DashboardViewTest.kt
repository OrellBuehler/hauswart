package ch.orellbuehler.hauswart.feature.dashboard

import ch.orellbuehler.hauswart.feature.tasks.completionJson
import ch.orellbuehler.hauswart.feature.tasks.taskJson
import ch.orellbuehler.hauswart.i18n.I18n
import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.seconds

class DashboardViewTest {
    private val server = TestApp().also { it.signIn() }

    @BeforeTest
    fun german() {
        I18n.locale = "de"
    }

    @AfterTest
    fun tearDown() = server.close()

    private fun task(
        id: String,
        status: String,
        date: String?,
        room: String? = null,
        odometerAssetId: String? = null,
        nextAppointment: String = "null",
    ) = """{"taskId":"$id","title":"Task $id","category":"cleaning","priority":"normal","assetId":null,"assetName":null,
        "roomId":null,"roomName":${if (room == null) "null" else "\"$room\""},"assigneeUserId":null,"assigneeName":"Anna","status":"$status",
        "dueKind":"exact","date":${if (date == null) "null" else "\"$date\""},"estimated":false,"estimate":null,"progress":null,
        "openNoteCount":0,"odometerAssetId":${if (odometerAssetId == null) "null" else "\"$odometerAssetId\""},
        "nextAppointment":$nextAppointment}"""

    private fun dashboard(
        overdue: String = "",
        later: String = "",
        balances: String = "null",
        preparations: String = "",
        finance: Int = 0,
        review: Int = 0,
        receipts: Int = 0,
    ) = """{"today":"2026-11-21","generatedAt":"2026-11-21T08:00:00.000Z",
        "counts":{"overdue":${if (overdue.isEmpty()) 0 else 1},"today":0,"thisWeek":0,"preparations":0},
        "upcoming":{"overdue":[$overdue],"today":[],"thisWeek":[],"later":[$later],"signalBased":[]},
        "preparations":[$preparations],"recentCompletions":[],"openDefects":[
          {"id":"d1","title":"Leak","date":"2026-11-01","number":4,"status":"open","severity":"high","roomName":"Kitchen","assetName":null}],
        "expiringWarranties":[],"orderNow":[],
        "costsYearToDate":{"year":2026,"currency":"CHF","totalMinor":123450,"byCategory":[],"byBook":[]},
        "balances":$balances,"budgetAlerts":null,"pendingFinanceSuggestions":$finance,"reviewNeededCount":$review,"pendingReceiptCount":$receipts}"""

    @Test
    fun loadsTheDashboardIntoSectionsAndCards() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/notifications/unread-count", """{"count":3}""")
            server.on("GET", "/api/v1/dashboard", dashboard(overdue = task("t1", "overdue", "2026-11-19", room = "Kitchen")))
            val store = DashboardStore(server.app)
            val state = store.await { !it.loading }
            assertNull(state.error)
            assertEquals(3, state.unreadNotifications)
            assertEquals(tr("dashboard_greeting", "name" to "Anna"), state.greeting)
            val view = assertNotNull(state.view)
            assertEquals(listOf(SECTION_OVERDUE), view.sections.map { it.id })
            val item =
                view.sections
                    .single()
                    .items
                    .single()
            assertEquals("Task t1", item.title)
            assertEquals("Kitchen", item.place)
            assertEquals("vor 2 Tagen · 19.11.", item.whenText)
            assertEquals(TONE_OVERDUE, item.tone)
            assertEquals(tr("status_overdue"), item.statusLabel)
            assertEquals(TONE_OVERDUE, view.tiles.first().tone)
            val defect = assertNotNull(view.defects).items.single()
            assertEquals(TONE_OVERDUE, defect.deadlineTone)
            assertEquals("CHF 1'234.50", assertNotNull(view.costs).yearTotal)
            store.close()
        }

    @Test
    fun cardsThatAskForSomethingAppearForCountsAboveZeroInTheWebsOrder() =
        runTest {
            val store = load(dashboard(finance = 3, review = 1, receipts = 2))
            val cards = store.await { it.view != null }.view!!.attention
            assertEquals(listOf(ATTENTION_FINANCE, ATTENTION_RECEIPTS, ATTENTION_REVIEW), cards.map { it.id })
            assertEquals(listOf(3L, 2L, 1L), cards.map { it.count })
            assertEquals(tr("finance_count", "count" to 3), cards[0].text)
            assertEquals(tr("costs_receipts_pending", "count" to 2), cards[1].text)
            assertEquals(tr("costs_review_banner", "count" to 1), cards[2].text)
            assertEquals(tr("dashboard_to_review"), cards[2].linkLabel)
            store.close()
        }

    @Test
    fun noCardWithoutACount() =
        runTest {
            val store = load(dashboard(review = 4))
            val cards = store.await { it.view != null }.view!!.attention
            assertEquals(listOf(ATTENTION_REVIEW), cards.map { it.id })
            store.close()
        }

    @Test
    fun theLaterSectionFoldsAfterFiveTasks() =
        runTest {
            val later = (1..7).joinToString(",") { task("l$it", "ok", "2026-12-0$it") }
            server.household()
            server.on("GET", "/api/v1/notifications/unread-count", """{"count":0}""")
            server.on("GET", "/api/v1/dashboard", dashboard(later = later))
            val store = DashboardStore(server.app)
            val folded =
                store
                    .await { it.view != null }
                    .view!!
                    .sections
                    .single()
            assertEquals(5, folded.items.size)
            assertEquals(7, folded.total)
            assertTrue(folded.collapsible)
            store.toggleLater()
            val open =
                store
                    .await { it.laterExpanded }
                    .view!!
                    .sections
                    .single()
            assertEquals(7, open.items.size)
            store.close()
        }

    private fun load(dashboard: String): DashboardStore {
        server.household()
        server.on("GET", "/api/v1/notifications/unread-count", """{"count":0}""")
        server.on("GET", "/api/v1/dashboard", dashboard)
        return DashboardStore(server.app)
    }

    @Test
    fun rowsKnowTheirAppointmentTheReadingAndWhetherTheyCanBeActedOn() =
        runTest {
            val appointment = """{"id":"ap1","allDay":true,"startsAt":null,"startDate":"2099-05-04"}"""
            val prep =
                """{"taskId":"t9","taskTitle":"Service car","prepId":"p1","title":"Order oil","state":"now","date":"2026-11-20"}"""
            val store =
                load(
                    dashboard(
                        overdue =
                            task("t1", "overdue", "2026-11-19", nextAppointment = appointment) + "," +
                                task("t2", "due", "2026-11-20", odometerAssetId = "a1"),
                        preparations = prep,
                    ),
                )
            val view = assertNotNull(store.await { it.view != null }.view)
            val items = view.sections.first { it.id == SECTION_OVERDUE }.items
            val chip = assertNotNull(items[0].appointment)
            assertEquals("ap1", chip.id)
            assertTrue(chip.text.contains("04.05.2099"), chip.text)
            assertEquals("Termin: " + chip.text, chip.label)
            assertFalse(items[0].needsReading)
            assertNull(items[1].appointment)
            assertTrue(items[1].needsReading)
            assertTrue(items.all { it.actionable })
            val preps = view.sections.first { it.id == SECTION_PREPARATIONS }.items
            assertTrue(preps.none { it.actionable })
            store.close()
        }

    @Test
    fun aQuickCompletionOffersUndoAndTellsTheOtherScreens() =
        runTest {
            val store = load(dashboard(overdue = task("t1", "overdue", "2026-11-19")))
            store.await { it.view != null }
            server.on(
                "POST",
                "/api/v1/tasks/t1/complete",
                """{"completion":${completionJson("c1", "t1")},"task":${taskJson("t1", "Task t1")},"serviceLog":null}""",
                HttpStatusCode.Created,
            )
            server.on("DELETE", "/api/v1/completions/c1", "{}", HttpStatusCode.NoContent)
            val changes = async(start = CoroutineStart.UNDISPATCHED) { server.app.changes.first { it == "tasks" } }
            store.complete("t1")
            val done = store.await { it.notice != null }
            assertEquals("Erledigt: «Task t1»", done.notice?.message)
            assertNull(done.busyId)
            assertTrue(
                server
                    .requestsTo("POST", "/api/v1/tasks/t1/complete")
                    .single()
                    .json
                    .containsKey("idempotencyKey"),
            )
            withContext(Dispatchers.Default) { withTimeout(60.seconds) { changes.await() } }
            store.undo(assertNotNull(done.notice?.undo))
            store.await { it.notice != null && it.notice?.undo == null }
            assertEquals(1, server.requestsTo("DELETE", "/api/v1/completions/c1").size)
            store.close()
        }

    @Test
    fun aFailedQuickCompletionShowsTheErrorAndAPreparationIsNotCompletedByTheRow() =
        runTest {
            val prep =
                """{"taskId":"t9","taskTitle":"Service car","prepId":"p1","title":"Order oil","state":"now","date":"2026-11-20"}"""
            val store = load(dashboard(overdue = task("t1", "overdue", "2026-11-19"), preparations = prep))
            store.await { it.view != null }
            server.onError("POST", "/api/v1/tasks/t1/complete", HttpStatusCode.InternalServerError, "internal_error")
            store.complete("t9")
            store.complete("t1")
            val failed = store.await { it.actionError != null }
            assertNull(failed.busyId)
            assertNull(failed.notice)
            assertTrue(server.requestsTo("POST", "/api/v1/tasks/t9/complete").isEmpty())
            store.dismissActionError()
            assertNull(store.await { it.actionError == null }.actionError)
            store.close()
        }

    @Test
    fun defectsWithoutADateOrClosedHaveNoUrgency() {
        assertEquals(tr("defect_deadline_none") to TONE_MUTED, defectDeadline(null, "open", "2026-11-21"))
        assertEquals(TONE_MUTED, defectDeadline("2026-01-01", "fixed", "2026-11-21").second)
        assertEquals(TONE_DUE, defectDeadline("2026-12-01", "open", "2026-11-21").second)
        assertEquals(TONE_MUTED, defectDeadline("2027-06-01", "open", "2026-11-21").second)
    }
}
