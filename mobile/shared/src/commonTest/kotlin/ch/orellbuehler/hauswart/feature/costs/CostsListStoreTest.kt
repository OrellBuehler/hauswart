package ch.orellbuehler.hauswart.feature.costs

import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CostsListStoreTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app
    private val thisYear = Dates.today("Europe/Zurich").take(4).toInt()

    @AfterTest
    fun tearDown() = server.close()

    private fun serve(
        withPayment: Boolean = true,
        books: String? = null,
    ) {
        server.costsHousehold()
        books?.let { server.on("GET", "/api/v1/cost-books", it) }
        server.on(
            "GET",
            "/api/v1/costs",
            page(
                costEntry("c1", title = "Wocheneinkauf", date = "2026-11-12", amountMinor = 4250, payee = "Beispiel Markt"),
                costEntry(
                    "c2",
                    title = "Velo-Service",
                    date = "2026-11-03",
                    amountMinor = 8000,
                    category = "maintenance",
                    paidBy = "u2",
                    paidByName = "Ben",
                    reviewNeeded = true,
                ),
                costEntry("c3", title = "Rückerstattung Brille", date = "2026-10-20", amountMinor = -3000, category = "health"),
                costEntry(
                    "c4",
                    title = "Amortisation",
                    date = "2026-10-01",
                    amountMinor = 50000,
                    category = "mortgage_principal",
                    countsAsExpense = false,
                    bookId = "b2",
                    bookName = "Wohnung",
                ),
            ),
        )
        server.on("GET", "/api/v1/costs/summary", summary(reviewNeededCount = 1, equityTotalMinor = 50000, otherCurrencyCount = 2))
        server.on("GET", "/api/v1/costs/balances", balances(withPayment))
    }

    @Test
    fun loadsTheYearGroupedByMonthNewestFirst() =
        runTest {
            serve()
            val store = CostsListStore(app)
            val state = store.await { !it.loading && it.groups.isNotEmpty() }
            assertNull(state.error)
            assertEquals(listOf("2026-11", "2026-10"), state.groups.map { it.key })
            assertEquals(listOf("November 2026", "Oktober 2026"), state.groups.map { it.title })
            assertEquals(listOf("c1", "c2"), state.groups[0].rows.map { it.id })
            assertEquals("CHF 122.50", state.groups[0].total)
            assertEquals("CHF -30.00", state.groups[1].total)
            assertEquals(4, state.total)
            assertEquals(4, state.shown)
            assertEquals(thisYear, state.year)
            store.close()
        }

    @Test
    fun aRowSaysWhatTheEntryIs() =
        runTest {
            serve()
            val store = CostsListStore(app)
            val state = store.await { it.groups.isNotEmpty() }
            val first = state.groups[0].rows[0]
            assertEquals("Wocheneinkauf", first.title)
            assertEquals("12.11. · ${tr("cost_category_groceries")} · Beispiel Markt", first.meta)
            assertEquals("CHF 42.50", first.amount)
            assertEquals("Anna", first.payer)
            assertEquals("Haushalt", first.place.substringAfter(" · ", "Haushalt"))
            val review = state.groups[0].rows[1]
            assertEquals(listOf(tr("cost_badge_review")), review.badges.map { it.text })
            val refund = state.groups[1].rows[0]
            assertTrue(refund.refund)
            assertEquals(listOf(tr("cost_badge_refund")), refund.badges.map { it.text })
            val equity = state.groups[1].rows[1]
            assertEquals(listOf(tr("cost_badge_equity")), equity.badges.map { it.text })
            store.close()
        }

    @Test
    fun theSummaryAndTheBalanceLineComeFromTheServer() =
        runTest {
            serve()
            val store = CostsListStore(app)
            val state = store.await { it.summary != null && it.balance != null }
            val summary = assertNotNull(state.summary)
            assertEquals("CHF 123.00", summary.total)
            assertEquals(tr("costs_expenses_count", "count" to 3), summary.count)
            assertEquals("CHF 500.00", summary.equity)
            assertNotNull(summary.otherCurrency)
            assertEquals(1, state.reviewCount)
            val balance = assertNotNull(state.balance)
            assertEquals("Du bekommst CHF 21.25", balance.you?.text)
            assertEquals("ok", balance.you?.tone)
            assertEquals(listOf("Ben schuldet Anna CHF 21.25"), balance.payments)
            store.close()
        }

    @Test
    fun withNothingToSettleTheBalanceSaysSo() =
        runTest {
            serve(withPayment = false)
            val store = CostsListStore(app)
            val balance = assertNotNull(store.await { it.balance != null }.balance)
            assertEquals("Du bist ausgeglichen", balance.you?.text)
            assertEquals(tr("balances_square"), balance.status)
            assertTrue(balance.payments.isEmpty())
            store.close()
        }

    @Test
    fun theSwitcherListsTheBooksAndTheChoiceIsRememberedPerDevice() =
        runTest {
            serve()
            val store = CostsListStore(app)
            val first = store.await { !it.loading }
            assertTrue(first.showSwitcher)
            assertEquals(listOf("b1", "b2"), first.books.map { it.id })
            assertEquals(ALL_BOOKS, first.bookId)

            store.selectBook("b2")
            val state = store.await { it.bookId == "b2" && !it.loading && it.title == "Wohnung" }
            assertEquals("Wohnung", state.title)
            assertEquals("b2", app.settings.load("costs.book"))
            val query = server.requestsTo("GET", "/api/v1/costs").last().query
            assertTrue("bookId=b2" in query, query)
            assertTrue("year=$thisYear" in query, query)
            assertTrue(
                server
                    .requestsTo("GET", "/api/v1/costs/balances")
                    .last()
                    .query
                    .contains("bookId=b2"),
            )
            store.close()

            val again = CostsListStore(app)
            assertEquals("b2", again.await { !it.loading }.bookId)
            again.selectBook(ALL_BOOKS)
            again.await { it.bookId == ALL_BOOKS && it.title == tr("costbook_all") }
            assertEquals("all", app.settings.load("costs.book"))
            assertTrue(
                server
                    .requestsTo("GET", "/api/v1/costs/balances")
                    .last()
                    .query
                    .contains("all=true"),
            )
            again.close()
        }

    @Test
    fun aRememberedBookThatIsGoneShowsEveryBook() =
        runTest {
            serve()
            app.settings.save("costs.book", "deleted-book")
            val store = CostsListStore(app)
            assertEquals(ALL_BOOKS, store.await { !it.loading }.bookId)
            store.close()
        }

    @Test
    fun withOneBookTheSwitcherIsHidden() =
        runTest {
            serve(books = page(costBook("b1", "Haushalt", isDefault = true)))
            val store = CostsListStore(app)
            val state = store.await { !it.loading }
            assertEquals(false, state.showSwitcher)
            store.close()
        }

    @Test
    fun filtersNarrowTheListWithoutAskingTheServerAgain() =
        runTest {
            serve()
            val store = CostsListStore(app)
            store.await { it.groups.isNotEmpty() }
            val loads = server.requestsTo("GET", "/api/v1/costs").size

            store.search("velo")
            assertEquals(
                listOf("c2"),
                store
                    .await { it.query == "velo" }
                    .groups
                    .flatMap { g -> g.rows }
                    .map { it.id },
            )

            store.search("markt")
            assertEquals(
                listOf("c1"),
                store
                    .await { it.query == "markt" }
                    .groups
                    .flatMap { g -> g.rows }
                    .map { it.id },
            )

            store.resetFilters()
            store.setCategory("health")
            assertEquals(
                listOf("c3"),
                store
                    .await { it.category == "health" }
                    .groups
                    .flatMap { g -> g.rows }
                    .map { it.id },
            )

            store.setCategory("")
            store.setPaidBy("u2")
            assertEquals(
                listOf("c2"),
                store
                    .await { it.paidBy == "u2" }
                    .groups
                    .flatMap { g -> g.rows }
                    .map { it.id },
            )

            store.setPaidBy("")
            store.setReviewOnly(true)
            val review = store.await { it.reviewOnly }
            assertEquals(listOf("c2"), review.groups.flatMap { g -> g.rows }.map { it.id })
            assertEquals(1, review.shown)
            assertEquals(4, review.total)
            assertTrue(review.filtered)

            store.search("zzz")
            assertTrue(store.await { it.query == "zzz" }.groups.isEmpty())

            store.resetFilters()
            val reset = store.await { !it.filtered }
            assertEquals(4, reset.shown)
            assertEquals(loads, server.requestsTo("GET", "/api/v1/costs").size)
            store.close()
        }

    @Test
    fun anotherYearIsAskedFor() =
        runTest {
            serve()
            val store = CostsListStore(app)
            store.await { it.groups.isNotEmpty() }
            store.previousYear()
            store.await { it.yearLabel == (thisYear - 1).toString() }
            assertTrue("year=${thisYear - 1}" in server.requestsTo("GET", "/api/v1/costs").last().query)
            assertTrue("year=${thisYear - 1}" in server.requestsTo("GET", "/api/v1/costs/summary").last().query)
            store.nextYear()
            store.await { it.yearLabel == thisYear.toString() }
            store.close()
        }

    @Test
    fun theBalancesFailingDoesNotHideTheEntries() =
        runTest {
            serve()
            server.onError("GET", "/api/v1/costs/balances", HttpStatusCode.InternalServerError, "internal_error")
            val store = CostsListStore(app)
            val state = store.await { !it.loading && it.groups.isNotEmpty() }
            assertTrue(state.balancesUnavailable)
            assertNull(state.balance)
            assertNull(state.error)
            store.close()
        }

    @Test
    fun aFailedLoadSetsTheError() =
        runTest {
            serve()
            server.onError("GET", "/api/v1/costs", HttpStatusCode.InternalServerError, "internal_error")
            val store = CostsListStore(app)
            val state = store.await { !it.loading }
            assertEquals(tr("m_error_server"), state.error?.message)
            assertTrue(state.groups.isEmpty())
            store.close()
        }

    @Test
    fun aChangeOfCostsReloadsTheList() =
        runTest {
            serve()
            val store = CostsListStore(app)
            store.await { it.groups.isNotEmpty() }
            val before = server.requestsTo("GET", "/api/v1/costs").size
            server.on("GET", "/api/v1/costs", page(costEntry("c9", title = "Neu", date = "2026-11-20")))
            app.changed("costs")
            val state = store.await { it.total == 1 && it.shown == 1 }
            assertEquals(listOf("c9"), state.groups.flatMap { g -> g.rows }.map { it.id })
            assertTrue(server.requestsTo("GET", "/api/v1/costs").size > before)
            store.close()
        }
}
