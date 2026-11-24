package ch.orellbuehler.hauswart.feature.budgets

import ch.orellbuehler.hauswart.feature.costs.costBook
import ch.orellbuehler.hauswart.feature.costs.page
import ch.orellbuehler.hauswart.feature.costsplit.settle
import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class BudgetsStoresTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private fun budget(
        id: String,
        bookId: String? = "b1",
        bookName: String? = "Haushalt",
        category: String? = null,
        period: String = "month",
        amount: Long = 50000,
        active: Boolean = true,
    ) =
        """{"id":"$id","bookId":${bookId.q()},"bookName":${bookName.q()},"category":${category.q()},"period":"$period","amountMinor":$amount,
        "currency":"CHF","active":$active,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}"""

    private fun String?.q() = if (this == null) "null" else "\"$this\""

    private fun item(
        budget: String,
        spent: Long,
        percent: Int,
        state: String,
        remaining: Long,
    ) = """{"budget":$budget,"periodFrom":"2026-11-01","periodTo":"2026-11-30","spentMinor":$spent,"entryCount":2,
        "remainingMinor":$remaining,"percentUsed":$percent,"state":"$state"}"""

    private fun status(vararg items: String) =
        """{"year":2026,"month":11,"currency":"CHF","warningPercent":80,"items":[${items.joinToString(",")}]}"""

    private fun prepare() {
        server.household()
        val ok = budget("g1", category = "groceries", bookName = "Haushalt")
        val over = budget("r1", bookId = null, bookName = null, category = "repair", amount = 10000)
        val yearly = budget("y1", period = "year", amount = 900000)
        val paused = budget("p1", active = false)
        server.on("GET", "/api/v1/cost-budgets", """{"items":[$ok,$over,$yearly,$paused]}""")
        server.on(
            "GET",
            "/api/v1/costs/budgets/status",
            status(
                item(ok, 20000, 40, "ok", 30000),
                item(over, 13000, 130, "exceeded", -3000),
                item(yearly, 100000, 11, "ok", 800000),
            ),
        )
    }

    @Test
    fun periodNavigationStaysInsideTheYearsTheApiTakes() {
        val month = BudgetPeriodView("month", 2026, 1)
        assertEquals(BudgetPeriodView("month", 2025, 12), month.shifted(-1))
        assertEquals(BudgetPeriodView("month", 2026, 2), month.shifted(1))
        assertEquals(BudgetPeriodView("year", 2027, 5), BudgetPeriodView("year", 2026, 5).shifted(1))
        assertNull(BudgetPeriodView("year", BUDGET_MIN_YEAR, 1).shifted(-1))
        assertNull(BudgetPeriodView("month", BUDGET_MAX_YEAR, 12).shifted(1))
        assertEquals(true, BudgetPeriodView("year", 2026, 3).isCurrent("2026-11-21"))
        assertEquals(false, BudgetPeriodView("month", 2026, 3).isCurrent("2026-11-21"))
    }

    @Test
    fun theListShowsMonthBudgetsWorstFirstAndThePausedOnesApart() =
        runTest {
            prepare()
            val store = BudgetsStore(app)
            val state = store.await { !it.loading }
            assertNull(state.error)
            assertEquals(listOf("r1", "g1"), state.rows.map { it.id })
            assertEquals("exceeded", state.rows.first().state)
            assertEquals(100, state.rows.first().barPercent)
            assertEquals(listOf("p1"), state.paused.map { it.id })
            assertTrue(state.isCurrent)
            val query = server.requestsTo("GET", "/api/v1/costs/budgets/status").first().query
            assertTrue("year=2026" in query && "month=" in query, query)

            store.selectPeriod("year")
            val year = store.await { it.period == "year" }
            assertEquals(listOf("y1"), year.rows.map { it.id })
            assertEquals(tr("budgets_empty_year_title"), year.emptyTitle)
            settle()
            store.close()
        }

    @Test
    fun pausingSendsActiveFalseAndSaysSo() =
        runTest {
            prepare()
            server.on("PATCH", "/api/v1/cost-budgets/g1", budget("g1", active = false))
            val store = BudgetsStore(app)
            store.await { !it.loading }
            store.pause("g1")
            val state = store.await { it.notice != null }
            assertEquals(
                false,
                server
                    .requestsTo("PATCH", "/api/v1/cost-budgets/g1")
                    .single()
                    .json
                    .getValue("active")
                    .jsonPrimitive.booleanOrNull,
            )
            assertNotNull(state.notice)
            settle()
            store.close()
        }

    @Test
    fun aFailedDeleteKeepsTheListAndReports() =
        runTest {
            prepare()
            server.onError("DELETE", "/api/v1/cost-budgets/g1", HttpStatusCode.Forbidden, "forbidden")
            val store = BudgetsStore(app)
            store.await { !it.loading }
            store.delete("g1")
            val state = store.await { it.actionError != null }
            assertEquals(tr("m_error_forbidden"), state.actionError?.message)
            assertEquals(2, state.rows.size)
            settle()
            store.close()
        }

    private fun editPrepare() {
        server.household()
        server.on("GET", "/api/v1/cost-books", page(costBook("b1", "Haushalt", isDefault = true), costBook("b2", "Auto")))
    }

    @Test
    fun aBudgetNeedsABookOrACategoryAndAnAmount() =
        runTest {
            editPrepare()
            val store = BudgetEditStore(app, null)
            store.await { it.initial != null }
            store.save(BudgetForm(amount = "abc"))
            val state = store.await { it.fieldErrors.isNotEmpty() }
            assertEquals(tr("budget_error_scope"), state.fieldErrors["bookId"])
            assertNotNull(state.fieldErrors["amountMinor"])
            assertTrue(server.requestsTo("POST", "/api/v1/cost-budgets").isEmpty())
            settle()
            store.close()
        }

    @Test
    fun creatingSendsTheScopeAndTheAmountInMinorUnits() =
        runTest {
            editPrepare()
            server.on("POST", "/api/v1/cost-budgets", budget("n1", category = "fuel"), HttpStatusCode.Created)
            val store = BudgetEditStore(app, null)
            store.await { it.initial != null }
            store.save(BudgetForm(bookId = "b2", category = "fuel", period = "year", amount = "1'200.50"))
            val state = store.await { it.savedId != null }
            assertEquals("n1", state.savedId)
            val body = server.requestsTo("POST", "/api/v1/cost-budgets").single().json
            assertEquals("b2", body.getValue("bookId").jsonPrimitive.content)
            assertEquals("120050", body.getValue("amountMinor").jsonPrimitive.content)
            assertEquals("year", body.getValue("period").jsonPrimitive.content)
            settle()
            store.close()
        }

    @Test
    fun updatingSendsOnlyWhatChangedAndNullForARemovedHalf() =
        runTest {
            editPrepare()
            server.on("GET", "/api/v1/cost-budgets/g1", budget("g1", category = "groceries"))
            server.on("PATCH", "/api/v1/cost-budgets/g1", budget("g1"))
            val store = BudgetEditStore(app, "g1")
            val form = assertNotNull(store.await { it.initial != null }.initial)
            assertEquals("500.00", form.amount)
            store.save(form.copy(category = ""))
            store.await { it.savedId != null }
            val body = server.requestsTo("PATCH", "/api/v1/cost-budgets/g1").single().json
            assertEquals(JsonNull, body["category"])
            assertNull(body["bookId"])
            assertNull(body["amountMinor"])
            settle()
            store.close()
        }

    @Test
    fun aDuplicateBudgetIsAConflictOnTheScope() =
        runTest {
            editPrepare()
            server.onError("POST", "/api/v1/cost-budgets", HttpStatusCode.Conflict, "conflict")
            val store = BudgetEditStore(app, null)
            store.await { it.initial != null }
            store.save(BudgetForm(bookId = "b1", amount = "10"))
            val state = store.await { !it.saving && it.fieldErrors.isNotEmpty() }
            assertEquals(tr("budget_error_exists"), state.fieldErrors["bookId"])
            settle()
            store.close()
        }
}
