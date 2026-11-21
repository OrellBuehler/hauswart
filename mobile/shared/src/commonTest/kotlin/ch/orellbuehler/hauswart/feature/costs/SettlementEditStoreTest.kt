package ch.orellbuehler.hauswart.feature.costs

import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SettlementEditStoreTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private suspend fun open(
        id: String? = null,
        from: String? = null,
        to: String? = null,
        amount: String? = null,
        book: String? = null,
    ): Pair<SettlementEditStore, SettlementForm> {
        server.costsHousehold()
        server.on("GET", "/api/v1/settlements/s1", settlement("s1", note = "bar"))
        val store = SettlementEditStore(app, id, from, to, amount, book)
        return store to assertNotNull(store.await { it.initial != null }.initial)
    }

    @Test
    fun aNewPaymentStartsFromMe() =
        runTest {
            val (store, form) = open()
            assertEquals("u1", form.fromUserId)
            assertEquals("", form.toUserId)
            assertEquals("CHF", form.currency)
            assertEquals(Dates.today("Europe/Zurich"), form.date)
            assertEquals("", form.bookId)
            assertEquals(listOf("", "b1", "b2"), store.value.books.map { it.value })
            assertEquals(listOf("u1", "u2"), store.value.people.map { it.value })
            store.close()
        }

    @Test
    fun aSuggestedPaymentFillsTheForm() =
        runTest {
            val (store, form) = open(from = "u2", to = "u1", amount = "21.25", book = "b1")
            assertEquals("u2", form.fromUserId)
            assertEquals("u1", form.toUserId)
            assertEquals("21.25", form.amount)
            assertEquals("b1", form.bookId)
            store.close()
        }

    @Test
    fun theAllBooksArgumentMeansNoBook() =
        runTest {
            val (store, form) = open(book = "all")
            assertEquals("", form.bookId)
            store.close()
        }

    @Test
    fun theDirectionCanBeSwapped() =
        runTest {
            val (store, form) = open(from = "u2", to = "u1")
            val swapped = store.swap(form)
            assertEquals("u1", swapped.fromUserId)
            assertEquals("u2", swapped.toUserId)
            store.close()
        }

    @Test
    fun savingChecksPeopleAmountAndDateBeforeAskingTheServer() =
        runTest {
            val (store, form) = open()
            store.save(form.copy(toUserId = "u1", amount = "0"))
            val state = store.await { it.fieldErrors.isNotEmpty() }
            assertEquals(tr("settlement_same_person"), state.fieldErrors["toUserId"])
            assertEquals(tr("cost_amount_zero").let { tr("settlement_amount_positive") }, state.fieldErrors["amountMinor"])
            store.save(form.copy(fromUserId = "", toUserId = "", amount = "5", date = ""))
            val empty = store.await { it.fieldErrors.containsKey("fromUserId") }
            assertEquals(tr("m_field_required"), empty.fieldErrors["toUserId"])
            assertEquals(tr("m_field_required"), empty.fieldErrors["date"])
            store.save(form.copy(toUserId = "u2", amount = "-5"))
            assertEquals(
                tr("settlement_amount_positive"),
                store
                    .await {
                        it.fieldErrors["amountMinor"] != null && it.fieldErrors.size == 1
                    }.fieldErrors["amountMinor"],
            )
            assertTrue(server.requestsTo("POST", "/api/v1/settlements").isEmpty())
            store.close()
        }

    @Test
    fun recordingSendsMinorUnitsAndAKey() =
        runTest {
            val (store, form) = open(from = "u2", to = "u1", amount = "21.25", book = "b1")
            server.on("POST", "/api/v1/settlements", settlement("s9"), HttpStatusCode.Created)
            store.save(form.copy(note = "  bar "))
            assertEquals("s9", store.await { it.savedId != null }.savedId)
            val body = server.requestsTo("POST", "/api/v1/settlements").single().json
            assertEquals("u2", body.getValue("fromUserId").jsonPrimitive.content)
            assertEquals("u1", body.getValue("toUserId").jsonPrimitive.content)
            assertEquals(2125L, body.getValue("amountMinor").jsonPrimitive.longOrNull)
            assertEquals("CHF", body.getValue("currency").jsonPrimitive.content)
            assertEquals("b1", body.getValue("bookId").jsonPrimitive.content)
            assertEquals("bar", body.getValue("note").jsonPrimitive.content)
            assertTrue(
                body
                    .getValue("idempotencyKey")
                    .jsonPrimitive.content.length >= 8,
            )
            store.close()
        }

    @Test
    fun aPaymentAcrossAllBooksSendsNoBook() =
        runTest {
            val (store, form) = open(from = "u2", to = "u1", amount = "5")
            server.on("POST", "/api/v1/settlements", settlement("s9", bookId = null), HttpStatusCode.Created)
            store.save(form)
            store.await { it.savedId != null }
            assertNull(server.requestsTo("POST", "/api/v1/settlements").single().json["bookId"])
            store.close()
        }

    @Test
    fun editingSendsOnlyWhatChanged() =
        runTest {
            val (store, form) = open(id = "s1")
            assertEquals("21.25", form.amount)
            assertEquals("bar", form.note)
            assertEquals("b1", form.bookId)
            server.on("PATCH", "/api/v1/settlements/s1", settlement("s1", amountMinor = 3000))
            store.save(form.copy(amount = "30", note = "", bookId = ""))
            store.await { it.savedId != null }
            val body = server.requestsTo("PATCH", "/api/v1/settlements/s1").single().json
            assertEquals(setOf("amountMinor", "note", "bookId"), body.keys)
            assertEquals(3000L, body.getValue("amountMinor").jsonPrimitive.longOrNull)
            assertEquals(JsonNull, body["note"])
            assertEquals(JsonNull, body["bookId"])
            store.close()
        }

    @Test
    fun editingWithoutChangesAsksNoServer() =
        runTest {
            val (store, form) = open(id = "s1")
            store.save(form)
            assertEquals("s1", store.await { it.savedId != null }.savedId)
            assertTrue(server.requestsTo("PATCH", "/api/v1/settlements/s1").isEmpty())
            store.close()
        }

    @Test
    fun serverFieldErrorsLandInFieldErrors() =
        runTest {
            val (store, form) = open(from = "u2", to = "u1", amount = "5")
            server.onError(
                "POST",
                "/api/v1/settlements",
                HttpStatusCode.BadRequest,
                "invalid_request",
                details = """{"body":{"formErrors":[],"fieldErrors":{"toUserId":["User does not exist"]}}}""",
            )
            store.save(form)
            val state = store.await { !it.saving && it.fieldErrors.isNotEmpty() }
            assertEquals(mapOf("toUserId" to "User does not exist"), state.fieldErrors)
            assertNull(state.error)
            store.close()
        }

    @Test
    fun aMissingPaymentIsALoadError() =
        runTest {
            server.costsHousehold()
            val store = SettlementEditStore(app, "gone", null, null, null, null)
            val state = store.await { !it.loading }
            assertEquals(tr("m_error_not_found"), state.loadError?.message)
            store.close()
        }
}
