package ch.orellbuehler.hauswart.feature.costs

import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CostsReportAndMoveTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private fun serveList() {
        server.costsHousehold()
        server.on(
            "GET",
            "/api/v1/costs",
            page(
                costEntry("c1", title = "Wocheneinkauf", date = "2026-11-12", reviewNeeded = true),
                costEntry(
                    "c2",
                    title = "Velo-Service",
                    date = "2025-03-03",
                    reviewNeeded = true,
                    deductible = "maintenance",
                    taxRelevant = true,
                ),
                costEntry("c3", title = "Kino", date = "2025-03-01", reviewNeeded = true),
            ),
        )
    }

    @Test
    fun theReviewListAsksForEveryYearAndBookAndSkipsTheSummary() =
        runTest {
            serveList()
            val store = CostsListStore(app, true)
            val state = store.await { it.ready && it.groups.isNotEmpty() }
            val query = server.requestsTo("GET", "/api/v1/costs").single().query
            assertTrue(query.contains("reviewNeeded=true"), query)
            assertFalse(query.contains("year="), query)
            assertFalse(query.contains("bookId="), query)
            assertTrue(server.requestsTo("GET", "/api/v1/costs/summary").isEmpty())
            assertEquals(tr("dashboard_review_title"), state.title)
            assertEquals(listOf("2026-11", "2025-03"), state.groups.map { it.key })
            assertEquals(3, state.total)
            assertNull(state.summary)
            store.close()
        }

    @Test
    fun pickingEntriesCountsThemAndKeepsOnlyWhatIsStillShown() =
        runTest {
            serveList()
            val store = CostsListStore(app, true)
            store.await { it.ready && it.groups.isNotEmpty() }
            store.startSelecting()
            store.toggleSelected("c1")
            store.toggleSelected("c2")
            var state = store.await { it.selectedCount == 2 }
            assertEquals(tr("costs_selected_count", "count" to 2), state.selectionText)
            assertTrue(
                state.groups
                    .flatMap { it.rows }
                    .filter { it.selected }
                    .map { it.id }
                    .toSet() == setOf("c1", "c2"),
            )
            assertFalse(state.allSelected)
            store.toggleSelectAll()
            state = store.await { it.allSelected }
            assertEquals(3, state.selectedCount)
            store.search("Kino")
            state = store.await { it.shown == 1 }
            assertEquals(1, state.selectedCount)
            assertTrue(state.allSelected)
            val pick = store.movePick()
            assertEquals(listOf("c3"), pick.ids)
            assertEquals(listOf("b1"), pick.bookIds)
            assertEquals(0, pick.taxClassed)
            store.stopSelecting()
            assertFalse(store.await { !it.selecting }.selecting)
            assertEquals(0, store.value.selectedCount)
            store.close()
        }

    @Test
    fun theTaxClassedEntriesAreCounted() =
        runTest {
            serveList()
            val store = CostsListStore(app, true)
            store.await { it.ready && it.groups.isNotEmpty() }
            store.startSelecting()
            store.toggleSelectAll()
            store.await { it.allSelected }
            assertEquals(1, store.movePick().taxClassed)
            store.close()
        }

    @Test
    fun movingStartsInAnotherBookWarnsAboutTheTaxClassAndSendsTheIds() =
        runTest {
            server.costsHousehold()
            val store = MoveCostsStore(app, MovePick(listOf("c1", "c2", "c1"), listOf("b1"), 2))
            var state = store.await { !it.loading }
            assertEquals(listOf("b1", "b2"), state.books.map { it.id })
            assertEquals("b2", state.bookId)
            assertNull(state.taxNote)
            store.chooseBook("b1")
            state = store.await { it.bookId == "b1" }
            assertEquals(tr("costs_move_tax_ids", "count" to 2), state.taxNote)

            server.on(
                "POST",
                "/api/v1/costs/move-to-book",
                """{"bookId":"b1","moved":2,"unchanged":1,"deductibleReset":2,"dryRun":false,"years":{"from":2025,"to":2026}}""",
            )
            server.on("GET", "/api/v1/costs", page())
            store.move()
            state = store.await { it.doneText != null }
            val body = server.requestsTo("POST", "/api/v1/costs/move-to-book").single().json
            assertEquals("b1", body.getValue("bookId").jsonPrimitive.content)
            assertEquals(listOf("c1", "c2"), body.getValue("ids").jsonArray.map { it.jsonPrimitive.content })
            assertEquals(
                listOf(
                    tr("costs_move_moved", "count" to 2, "book" to "Haushalt"),
                    tr("costs_move_unchanged", "count" to 1),
                    tr("costs_move_reset", "count" to 2),
                ).joinToString(" · "),
                state.doneText,
            )
            store.close()
        }

    @Test
    fun aBookThatTakesNoEntriesAnyMoreIsSaidUnderTheChoice() =
        runTest {
            server.costsHousehold()
            val store = MoveCostsStore(app, MovePick(listOf("c1"), listOf("b1"), 0))
            store.await { !it.loading }
            server.onError(
                "POST",
                "/api/v1/costs/move-to-book",
                HttpStatusCode.BadRequest,
                "invalid_request",
                details = """{"body":{"formErrors":[],"fieldErrors":{"bookId":["Invalid"]}}}""",
            )
            store.move()
            val state = store.await { !it.moving && it.bookError != null }
            assertEquals(tr("costs_move_book_closed"), state.bookError)
            assertNull(state.doneText)
            store.close()
        }

    @Test
    fun theReportListsMonthsCategoriesDevicesAndTaxClasses() =
        runTest {
            server.costsHousehold()
            server.on(
                "GET",
                "/api/v1/costs/summary",
                """{"year":2026,"currency":"CHF","otherCurrencyCount":0,"expenseTotalMinor":10000,"equityTotalMinor":0,
                "byCategory":[{"category":"groceries","totalMinor":7500,"count":3},{"category":"health","totalMinor":-500,"count":1}],
                "byMonth":[{"month":"2026-01","totalMinor":0,"count":0},{"month":"2026-11","totalMinor":10000,"count":4}],
                "byAsset":[{"assetId":"a1","assetName":"Waschmaschine","totalMinor":2500,"count":1}],
                "byDeductible":[{"deductible":"maintenance","totalMinor":3000,"count":1},{"deductible":"no","totalMinor":1000,"count":1},
                                {"deductible":"unknown","totalMinor":0,"count":0}],
                "people":[],"settlement":[],"unassignedPayerCount":0,"reviewNeededCount":0}""",
            )
            val store = CostsReportStore(app, "b1", 2026)
            val state = store.await { it.cards.isNotEmpty() }
            assertEquals(listOf(CARD_MONTH, CARD_CATEGORY, CARD_ASSET, CARD_TAX), state.cards.map { it.id })
            assertEquals("b1", state.bookId)
            assertTrue(
                server
                    .requestsTo("GET", "/api/v1/costs/summary")
                    .single()
                    .query
                    .contains("bookId=b1"),
            )
            val months = state.cards[0].rows
            assertEquals(listOf("November"), months.map { it.label })
            assertEquals("CHF 100.00", months[0].amount)
            assertEquals(tr("cost_percent", "value" to "100"), months[0].percent)
            val categories = state.cards[1].rows
            assertEquals(tr("cost_percent", "value" to "75"), categories[0].percent)
            assertEquals(1f, categories[0].fraction)
            assertTrue(categories[1].negative)
            assertEquals(tr("cost_percent", "value" to "-5"), categories[1].percent)
            assertEquals(listOf("Waschmaschine"), state.cards[2].rows.map { it.label })
            val tax = state.cards[3]
            assertEquals(listOf("maintenance", "no"), tax.rows.map { it.key })
            assertEquals(tr("cost_percent", "value" to "75"), tax.rows[0].percent)
            assertEquals("CHF 40.00", tax.footerValue)
            store.close()
        }

    @Test
    fun anEmptyYearSaysSoAndTheYearCanBeChanged() =
        runTest {
            server.costsHousehold()
            server.on(
                "GET",
                "/api/v1/costs/summary",
                """{"year":2026,"currency":"CHF","otherCurrencyCount":0,"expenseTotalMinor":0,"equityTotalMinor":0,"byCategory":[],
                "byMonth":[{"month":"2026-01","totalMinor":0,"count":0}],"byAsset":[],"byDeductible":[],"people":[],"settlement":[],
                "unassignedPayerCount":0,"reviewNeededCount":0}""",
            )
            val store = CostsReportStore(app, null, 2026)
            val state = store.await { !it.loading && it.empty }
            assertEquals(tr("costs_report_empty", "year" to 2026), state.emptyText)
            store.previousYear()
            store.await { it.yearLabel == "2025" }
            assertTrue(
                server
                    .requestsTo("GET", "/api/v1/costs/summary")
                    .last()
                    .query
                    .contains("year=2025"),
            )
            assertNotNull(store.value)
            store.close()
        }
}
