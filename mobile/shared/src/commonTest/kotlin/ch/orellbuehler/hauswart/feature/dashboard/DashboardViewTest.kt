package ch.orellbuehler.hauswart.feature.dashboard

import ch.orellbuehler.hauswart.i18n.I18n
import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

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
    ) = """{"taskId":"$id","title":"Task $id","category":"cleaning","priority":"normal","assetId":null,"assetName":null,
        "roomId":null,"roomName":${if (room == null) "null" else "\"$room\""},"assigneeUserId":null,"assigneeName":"Anna","status":"$status",
        "dueKind":"exact","date":${if (date == null) "null" else "\"$date\""},"estimated":false,"estimate":null,"progress":null,
        "openNoteCount":0,"odometerAssetId":null,"nextAppointment":null}"""

    private fun dashboard(
        overdue: String = "",
        later: String = "",
        balances: String = "null",
    ) = """{"today":"2026-11-21","generatedAt":"2026-11-21T08:00:00.000Z",
        "counts":{"overdue":${if (overdue.isEmpty()) 0 else 1},"today":0,"thisWeek":0,"preparations":0},
        "upcoming":{"overdue":[$overdue],"today":[],"thisWeek":[],"later":[$later],"signalBased":[]},
        "preparations":[],"recentCompletions":[],"openDefects":[
          {"id":"d1","title":"Leak","date":"2026-11-01","number":4,"status":"open","severity":"high","roomName":"Kitchen","assetName":null}],
        "expiringWarranties":[],"orderNow":[],
        "costsYearToDate":{"year":2026,"currency":"CHF","totalMinor":123450,"byCategory":[],"byBook":[]},
        "balances":$balances,"budgetAlerts":null,"pendingFinanceSuggestions":0,"reviewNeededCount":0,"pendingReceiptCount":0}"""

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

    @Test
    fun defectsWithoutADateOrClosedHaveNoUrgency() {
        assertEquals(tr("defect_deadline_none") to TONE_MUTED, defectDeadline(null, "open", "2026-11-21"))
        assertEquals(TONE_MUTED, defectDeadline("2026-01-01", "fixed", "2026-11-21").second)
        assertEquals(TONE_DUE, defectDeadline("2026-12-01", "open", "2026-11-21").second)
        assertEquals(TONE_MUTED, defectDeadline("2027-06-01", "open", "2026-11-21").second)
    }
}
