package ch.orellbuehler.hauswart.feature.costs

import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class BalancesStoreTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private fun serve(
        withPayment: Boolean = true,
        cross: String = "null",
    ) {
        server.costsHousehold()
        server.on("GET", "/api/v1/costs/balances", balances(withPayment, cross = cross))
        server.on(
            "GET",
            "/api/v1/settlements",
            page(settlement("s1", note = "bar übergeben"), settlement("s2", amountMinor = 500, bookId = null)),
        )
    }

    @Test
    fun showsWhoOwesWhomAndTheRecordedPayments() =
        runTest {
            serve()
            val store = BalancesStore(app, null)
            val state = store.await { !it.loading && it.settlements.isNotEmpty() }
            assertEquals(BALANCE_OPEN, state.status)
            assertEquals("Du bekommst CHF 21.25", state.you?.text)
            assertEquals(listOf("Anna", "Ben"), state.people.map { it.name })
            assertEquals(listOf(true, false), state.people.map { it.isYou })
            assertEquals("bekommt CHF 21.25", state.people[0].balance.text)
            assertEquals("schuldet CHF 21.25", state.people[1].balance.text)
            assertEquals("CHF 42.50", state.people[0].paid)
            val payment = state.payments.single()
            assertEquals("Ben schuldet Anna", payment.sentence)
            assertEquals("CHF 21.25", payment.amount)
            assertEquals("21.25", payment.amountInput)
            assertEquals("u2", payment.fromUserId)
            assertEquals("u1", payment.toUserId)
            assertEquals(listOf("s1", "s2"), state.settlements.map { it.id })
            assertEquals(tr("settlements_count", "count" to 2), state.settlementsCount)
            assertEquals(true, state.isOpen)
            assertEquals(false, state.isNothingYet)
            assertEquals("Ben hat Anna bezahlt", state.settlements[0].title)
            assertEquals("CHF 21.25", state.settlements[0].amount)
            assertTrue(state.settlements[0].meta.contains("bar übergeben"))
            assertTrue(state.settlements[1].meta.contains(tr("costbook_all")))
            assertEquals(true, state.showSwitcher)
            store.close()
        }

    @Test
    fun whenEverythingIsEvenItSaysSo() =
        runTest {
            serve(withPayment = false)
            val store = BalancesStore(app, null)
            val state = store.await { !it.loading }
            assertEquals(BALANCE_SQUARE, state.status)
            assertEquals("Du bist ausgeglichen", state.you?.text)
            assertTrue(state.payments.isEmpty())
            store.close()
        }

    @Test
    fun aBookNarrowsBalancesAndPaymentsAndNamesWhatItLeavesOut() =
        runTest {
            serve(cross = """{"count":2,"totalMinor":3000}""")
            val store = BalancesStore(app, "b1")
            val state = store.await { !it.loading && it.scopeNote != null }
            assertEquals("b1", state.bookId)
            assertTrue("bookId=b1" in server.requestsTo("GET", "/api/v1/costs/balances").last().query)
            assertTrue("bookId=b1" in server.requestsTo("GET", "/api/v1/settlements").last().query)
            val note = state.scopeNote.orEmpty()
            assertTrue(note.startsWith(tr("balances_scope_book_only", "name" to "Haushalt")), note)
            assertTrue(note.contains("CHF 30.00"), note)
            store.close()
        }

    @Test
    fun theArgumentAllMeansEveryBook() =
        runTest {
            serve()
            val store = BalancesStore(app, "all")
            val state = store.await { !it.loading }
            assertEquals(ALL_BOOKS, state.bookId)
            assertNull(state.scopeNote)
            assertTrue("all=true" in server.requestsTo("GET", "/api/v1/costs/balances").last().query)
            store.selectBook("b2")
            store.await { it.bookId == "b2" && it.scopeNote != null }
            assertEquals("b2", app.settings.load("costs.book"))
            store.close()
        }

    @Test
    fun theYearAndPersonFiltersAskTheServer() =
        runTest {
            serve()
            val store = BalancesStore(app, null)
            store.await { !it.loading && it.years.isNotEmpty() }
            store.setYear("2026")
            store.setPerson("u2")
            store.await { !it.refreshing && it.year == 2026 && it.person == "u2" }
            // The state can be there before the mock server has recorded the request that led to it.
            server.awaitRequest("GET", "/api/v1/settlements") { "year=2026" in it.query && "userId=u2" in it.query }
            store.resetFilters()
            assertEquals(false, store.await { !it.refreshing && !it.settlementsFiltered }.settlementsFiltered)
            assertEquals(
                "0",
                store.value.years
                    .first()
                    .value,
            )
            assertEquals(
                "",
                store.value.persons
                    .first()
                    .value,
            )
            store.close()
        }

    @Test
    fun deletingAPaymentReloads() =
        runTest {
            serve()
            server.on("DELETE", "/api/v1/settlements/s1", "", HttpStatusCode.NoContent)
            val store = BalancesStore(app, null)
            store.await { it.settlements.isNotEmpty() }
            assertEquals(
                tr("settlement_delete_description", "from" to "Ben", "to" to "Anna", "amount" to "CHF 21.25"),
                store.deleteText("s1"),
            )
            server.on("GET", "/api/v1/settlements", page(settlement("s2", amountMinor = 500, bookId = null)))
            store.deleteSettlement("s1")
            store.await { !it.deleting && it.settlements.map { s -> s.id } == listOf("s2") }
            assertEquals(1, server.requestsTo("DELETE", "/api/v1/settlements/s1").size)
            store.close()
        }

    @Test
    fun aFailedDeleteKeepsThePaymentsAndReports() =
        runTest {
            serve()
            server.onError("DELETE", "/api/v1/settlements/s1", HttpStatusCode.Forbidden, "forbidden")
            val store = BalancesStore(app, null)
            store.await { it.settlements.isNotEmpty() }
            store.deleteSettlement("s1")
            val state = store.await { it.actionError != null }
            assertEquals(tr("m_error_forbidden"), state.actionError?.message)
            assertEquals(2, state.settlements.size)
            store.dismissActionError()
            assertNull(store.await { it.actionError == null }.actionError)
            store.close()
        }

    @Test
    fun aFailedLoadSetsTheError() =
        runTest {
            serve()
            server.onError("GET", "/api/v1/costs/balances", HttpStatusCode.InternalServerError, "internal_error")
            val store = BalancesStore(app, null)
            val state = store.await { !it.loading }
            assertEquals(tr("m_error_server"), state.error?.message)
            store.close()
        }
}
