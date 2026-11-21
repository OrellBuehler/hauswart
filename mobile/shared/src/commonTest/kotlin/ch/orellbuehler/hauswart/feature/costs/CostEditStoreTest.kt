package ch.orellbuehler.hauswart.feature.costs

import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CostEditStoreTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private fun serve(entry: String? = null) {
        server.costsHousehold()
        server.on(
            "GET",
            "/api/v1/cost-tags",
            """{"items":[{"id":"t1","name":"Fest","color":"blue","entryCount":1,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}]}""",
        )
        server.on("GET", "/api/v1/assets", page())
        entry?.let { server.on("GET", "/api/v1/costs/c1", it) }
    }

    private suspend fun newStore(
        book: String? = null,
        asset: String? = null,
    ): Pair<CostEditStore, CostForm> {
        serve()
        val store = CostEditStore(app, null, book, asset)
        val form = assertNotNull(store.await { it.initial != null }.initial)
        return store to form
    }

    private suspend fun editStore(entry: String = costEntry("c1", payee = "Beispiel Markt")): Pair<CostEditStore, CostForm> {
        serve(entry)
        val store = CostEditStore(app, "c1", null, null)
        val form = assertNotNull(store.await { it.initial != null }.initial)
        return store to form
    }

    @Test
    fun aNewEntryStartsInTheDefaultBookPaidByMe() =
        runTest {
            val (store, form) = newStore()
            val state = store.value
            assertEquals("b1", form.bookId)
            assertEquals("equal", form.splitMode)
            assertEquals("CHF", form.currency)
            assertEquals("u1", form.paidByUserId)
            assertEquals(listOf("u1", "u2"), form.participants)
            assertEquals("other", form.category)
            assertEquals(mapOf("u1" to "50", "u2" to "50"), form.shares)
            assertEquals(listOf("b1", "b2"), state.books.map { it.id })
            assertEquals(listOf("Fest"), state.tags.map { it.name })
            assertTrue(state.isNew)
            store.close()
        }

    @Test
    fun aRequestedBookAndDeviceAreTaken() =
        runTest {
            val (store, form) = newStore(book = "b2", asset = "a7")
            assertEquals("b2", form.bookId)
            assertEquals("ownership", form.splitMode)
            assertEquals("a7", form.assetId)
            store.close()
        }

    @Test
    fun pickingABookChangesTheSplitUnlessThePersonChoseOne() =
        runTest {
            val (store, form) = newStore()
            val moved = store.withBook(form, "b2")
            assertEquals("ownership", moved.splitMode)
            assertEquals("b2", moved.bookId)
            val chosen = store.withSplitMode(form, "custom")
            assertEquals("custom", store.withBook(chosen, "b2").splitMode)
            assertEquals(form, store.withBook(form, "unknown"))
            store.close()
        }

    @Test
    fun theExpenseFlagFollowsTheCategoryUntilItIsSetByHand() =
        runTest {
            val (store, form) = newStore()
            val mortgage = store.withCategory(form, "mortgage_principal")
            assertEquals(false, mortgage.countsAsExpense)
            assertEquals(true, store.withCategory(mortgage, "groceries").countsAsExpense)
            val byHand = store.withCounts(form, false)
            assertEquals(false, store.withCategory(byHand, "groceries").countsAsExpense)
            store.close()
        }

    @Test
    fun savingWithoutTitleOrAmountAsksNoServer() =
        runTest {
            val (store, form) = newStore()
            store.save(form.copy(title = "  ", amount = "abc"))
            val state = store.await { it.fieldErrors.isNotEmpty() }
            assertEquals(tr("m_field_required"), state.fieldErrors["title"])
            assertEquals(tr("cost_amount_invalid", "decimals" to 2), state.fieldErrors["amountMinor"])
            assertTrue(server.requestsTo("POST", "/api/v1/costs").isEmpty())
            assertNull(state.savedId)
            store.close()
        }

    @Test
    fun creatingSendsMinorUnitsAndTheTrimmedFields() =
        runTest {
            val (store, form) = newStore()
            server.on("POST", "/api/v1/costs", costEntry("c9"), HttpStatusCode.Created)
            store.save(
                form.copy(
                    title = " Velo-Service ",
                    amount = "1'234,5",
                    category = "maintenance",
                    payee = " Beispiel Velo ",
                    notes = "  ",
                    tagIds = listOf("t1"),
                    date = "2026-11-05",
                ),
            )
            assertEquals("c9", store.await { it.savedId != null }.savedId)
            val body = server.requestsTo("POST", "/api/v1/costs").single().json
            assertEquals("Velo-Service", body.getValue("title").jsonPrimitive.content)
            assertEquals(123450L, body.getValue("amountMinor").jsonPrimitive.longOrNull)
            assertEquals("CHF", body.getValue("currency").jsonPrimitive.content)
            assertEquals("2026-11-05", body.getValue("date").jsonPrimitive.content)
            assertEquals("b1", body.getValue("bookId").jsonPrimitive.content)
            assertEquals("maintenance", body.getValue("category").jsonPrimitive.content)
            assertEquals("Beispiel Velo", body.getValue("payee").jsonPrimitive.content)
            assertNull(body["notes"])
            assertEquals("u1", body.getValue("paidByUserId").jsonPrimitive.content)
            assertEquals("equal", body.getValue("splitMode").jsonPrimitive.content)
            assertNull(body["participantIds"])
            assertNull(body["shares"])
            assertEquals(true, body.getValue("countsAsExpense").jsonPrimitive.booleanOrNull)
            assertEquals("unknown", body.getValue("deductible").jsonPrimitive.content)
            assertEquals(JsonArray(listOf(JsonPrimitive("t1"))), body.getValue("tagIds"))
            store.close()
        }

    @Test
    fun aRefundIsBookedNegativeAndAnEqualSplitCanBeNarrowed() =
        runTest {
            val (store, form) = newStore()
            server.on("POST", "/api/v1/costs", costEntry("c9"), HttpStatusCode.Created)
            store.save(store.toggleParticipant(form.copy(title = "Rückerstattung", amount = "10", refund = true), "u2"))
            store.await { it.savedId != null }
            val body = server.requestsTo("POST", "/api/v1/costs").single().json
            assertEquals(-1000L, body.getValue("amountMinor").jsonPrimitive.longOrNull)
            assertEquals(listOf("u1"), body.getValue("participantIds").jsonArray.map { it.jsonPrimitive.content })
            store.close()
        }

    @Test
    fun anEqualSplitNeedsAtLeastOnePerson() =
        runTest {
            val (store, form) = newStore()
            val nobody = store.toggleParticipant(store.toggleParticipant(form.copy(title = "x", amount = "1"), "u1"), "u2")
            store.save(nobody)
            assertEquals(tr("cost_for_whom_none"), store.await { it.fieldErrors.isNotEmpty() }.fieldErrors["participantIds"])
            store.close()
        }

    @Test
    fun aCustomSplitMustAddUpToOneHundredPercent() =
        runTest {
            val (store, form) = newStore()
            val custom = store.withSplitMode(form.copy(title = "Möbel", amount = "100"), "custom")
            store.save(custom.copy(shares = mapOf("u1" to "70", "u2" to "20")))
            val state = store.await { it.fieldErrors.isNotEmpty() }
            assertEquals(tr("cost_shares_sum", "total" to "90"), state.fieldErrors["shares"])
            assertTrue(server.requestsTo("POST", "/api/v1/costs").isEmpty())

            server.on("POST", "/api/v1/costs", costEntry("c9"), HttpStatusCode.Created)
            store.save(custom.copy(shares = mapOf("u1" to "70", "u2" to "30")))
            store.await { it.savedId != null }
            val body = server.requestsTo("POST", "/api/v1/costs").single().json
            assertEquals("custom", body.getValue("splitMode").jsonPrimitive.content)
            val shares = body.getValue("shares").jsonArray.map { it.toString() }
            assertEquals(2, shares.size)
            assertTrue(shares[0].contains("\"userId\":\"u1\"") && shares[0].contains("7000"))
            store.close()
        }

    @Test
    fun theFormPreviewsEachPersonsPartLikeTheServerBooksIt() =
        runTest {
            val (store, form) = newStore()
            val equal = store.view(form.copy(amount = "100"))
            assertEquals(listOf("CHF 50.00", "CHF 50.00"), equal.preview.map { it.amount })
            assertTrue(equal.showParticipants)
            assertEquals(tr("cost_split_equal_everyone_hint"), equal.splitHint)

            val ownership = store.view(form.copy(amount = "100.01", splitMode = "ownership"))
            assertEquals(listOf("CHF 60.01", "CHF 40.00"), ownership.preview.map { it.amount })
            assertEquals(listOf("60 %", "40 %"), ownership.preview.map { it.percent })

            val custom = store.view(form.copy(amount = "10", splitMode = "custom", shares = mapOf("u1" to "75", "u2" to "20")))
            assertTrue(custom.showShares)
            assertEquals(tr("cost_shares_missing", "percent" to "5"), custom.sharesStatus)
            assertEquals(false, custom.sharesOk)
            val over = store.view(form.copy(amount = "10", splitMode = "custom", shares = mapOf("u1" to "75", "u2" to "30")))
            assertEquals(tr("cost_shares_over", "percent" to "5"), over.sharesStatus)
            val ok = store.view(form.copy(amount = "10", splitMode = "custom", shares = mapOf("u1" to "75", "u2" to "25")))
            assertEquals(tr("cost_shares_total_ok"), ok.sharesStatus)
            assertTrue(ok.sharesOk)
            assertEquals(listOf("CHF 7.50", "CHF 2.50"), ok.preview.map { it.amount })

            assertTrue(store.view(form.copy(amount = "x")).preview.isEmpty())
            assertTrue(store.view(form.copy(amount = "5", splitMode = "none")).preview.isEmpty())
            assertEquals(false, store.view(form.copy(bookId = "b1")).taxClassApplies)
            assertEquals(true, store.view(form.copy(bookId = "b2")).taxClassApplies)
            store.close()
        }

    @Test
    fun theTaxClassIsOnlySentForATaxRelevantBook() =
        runTest {
            val (store, form) = newStore()
            server.on("POST", "/api/v1/costs", costEntry("c9"), HttpStatusCode.Created)
            store.save(form.copy(title = "Heizung", amount = "5", deductible = "maintenance", bookId = "b1"))
            store.await { it.savedId != null }
            assertEquals(
                "unknown",
                server
                    .requestsTo("POST", "/api/v1/costs")
                    .single()
                    .json
                    .getValue("deductible")
                    .jsonPrimitive.content,
            )
            store.close()
        }

    @Test
    fun serverFieldErrorsLandInFieldErrors() =
        runTest {
            val (store, form) = newStore()
            server.onError(
                "POST",
                "/api/v1/costs",
                HttpStatusCode.BadRequest,
                "invalid_request",
                details = """{"body":{"formErrors":[],"fieldErrors":{"bookId":["Book is archived"]}}}""",
            )
            store.save(form.copy(title = "x", amount = "1"))
            val state = store.await { !it.saving && it.fieldErrors.isNotEmpty() }
            assertEquals(mapOf("bookId" to "Book is archived"), state.fieldErrors)
            assertNull(state.error)
            assertNull(state.savedId)
            store.close()
        }

    @Test
    fun anOtherFailureIsShownAsTheError() =
        runTest {
            val (store, form) = newStore()
            server.onError("POST", "/api/v1/costs", HttpStatusCode.InternalServerError, "internal_error")
            store.save(form.copy(title = "x", amount = "1"))
            val state = store.await { !it.saving && it.error != null }
            assertEquals(tr("m_error_server"), state.error?.message)
            assertTrue(state.fieldErrors.isEmpty())
            store.close()
        }

    @Test
    fun editingStartsFromTheEntry() =
        runTest {
            val (store, form) = editStore()
            assertEquals("Wocheneinkauf", form.title)
            assertEquals("42.50", form.amount)
            assertEquals(false, form.refund)
            assertEquals("groceries", form.category)
            assertEquals("Beispiel Markt", form.payee)
            assertEquals("equal", form.splitMode)
            assertEquals(listOf("u1", "u2"), form.participants)
            assertEquals(false, store.value.isNew)
            store.close()
        }

    @Test
    fun editingARefundShowsThePositiveAmountWithTheSwitchOn() =
        runTest {
            val (store, form) = editStore(costEntry("c1", amountMinor = -1250))
            assertEquals("12.50", form.amount)
            assertEquals(true, form.refund)
            store.close()
        }

    @Test
    fun savingWithoutChangesAsksNoServer() =
        runTest {
            val (store, form) = editStore()
            store.save(form)
            assertEquals("c1", store.await { it.savedId != null }.savedId)
            assertTrue(server.requestsTo("PATCH", "/api/v1/costs/c1").isEmpty())
            store.close()
        }

    @Test
    fun updatingSendsOnlyWhatChanged() =
        runTest {
            val (store, form) = editStore()
            server.on("PATCH", "/api/v1/costs/c1", costEntry("c1"))
            store.save(form.copy(title = "Einkauf", payee = "", notes = "Neu"))
            store.await { it.savedId != null }
            val body = server.requestsTo("PATCH", "/api/v1/costs/c1").single().json
            assertEquals(setOf("title", "payee", "notes"), body.keys)
            assertEquals("Einkauf", body.getValue("title").jsonPrimitive.content)
            assertEquals(JsonNull, body["payee"])
            assertEquals("Neu", body.getValue("notes").jsonPrimitive.content)
            store.close()
        }

    @Test
    fun aNewCategoryAlwaysCarriesTheExpenseFlag() =
        runTest {
            val (store, form) = editStore()
            server.on("PATCH", "/api/v1/costs/c1", costEntry("c1"))
            store.save(store.withCategory(form, "household"))
            store.await { it.savedId != null }
            val body = server.requestsTo("PATCH", "/api/v1/costs/c1").single().json
            assertEquals(setOf("category", "countsAsExpense"), body.keys)
            store.close()
        }

    @Test
    fun theAmountIsOnlySentWhenItChanged() =
        runTest {
            val (store, form) = editStore()
            server.on("PATCH", "/api/v1/costs/c1", costEntry("c1"))
            store.save(form.copy(amount = "50"))
            store.await { it.savedId != null }
            val body = server.requestsTo("PATCH", "/api/v1/costs/c1").single().json
            assertEquals(setOf("amountMinor"), body.keys)
            assertEquals(5000L, body.getValue("amountMinor").jsonPrimitive.longOrNull)
            store.close()
        }

    @Test
    fun theSplitIsOnlySentWhenThePersonChangedIt() =
        runTest {
            val (store, form) = editStore()
            server.on("PATCH", "/api/v1/costs/c1", costEntry("c1"))
            store.save(store.withSplitMode(form, "ownership"))
            store.await { it.savedId != null }
            val body = server.requestsTo("PATCH", "/api/v1/costs/c1").single().json
            assertEquals(setOf("splitMode"), body.keys)
            assertEquals("ownership", body.getValue("splitMode").jsonPrimitive.content)
            store.close()
        }

    @Test
    fun narrowingAnEqualSplitSendsTheParticipants() =
        runTest {
            val (store, form) = editStore()
            server.on("PATCH", "/api/v1/costs/c1", costEntry("c1"))
            store.save(store.toggleParticipant(form, "u2"))
            store.await { it.savedId != null }
            val body = server.requestsTo("PATCH", "/api/v1/costs/c1").single().json
            assertEquals("equal", body.getValue("splitMode").jsonPrimitive.content)
            assertEquals(listOf("u1"), body.getValue("participantIds").jsonArray.map { it.jsonPrimitive.content })
            store.close()
        }

    @Test
    fun tagsAreSentAsAWholeWhenTheyChange() =
        runTest {
            val (store, form) = editStore()
            server.on("PATCH", "/api/v1/costs/c1", costEntry("c1"))
            store.save(store.toggleTag(form, "t1"))
            store.await { it.savedId != null }
            val body = server.requestsTo("PATCH", "/api/v1/costs/c1").single().json
            assertEquals(setOf("tagIds"), body.keys)
            store.close()
        }

    @Test
    fun anEntryOfTheFuelLogKeepsAmountDateAndDevice() =
        runTest {
            val (store, form) = editStore(costEntry("c1", fuelLogId = "f1", category = "fuel", assetId = "a1", assetName = "Auto"))
            assertTrue(store.value.fuelOwned)
            assertNotNull(store.value.fuelNote)
            server.on("PATCH", "/api/v1/costs/c1", costEntry("c1"))
            store.save(form.copy(amount = "99", date = "2026-01-01", assetId = "", title = "Tanken"))
            store.await { it.savedId != null }
            val body = server.requestsTo("PATCH", "/api/v1/costs/c1").single().json
            assertEquals(setOf("title"), body.keys)
            store.close()
        }

    @Test
    fun aMissingEntryIsALoadError() =
        runTest {
            serve()
            val store = CostEditStore(app, "gone", null, null)
            val state = store.await { !it.loading }
            assertEquals(tr("m_error_not_found"), state.loadError?.message)
            assertNull(state.initial)
            store.close()
        }

    @Test
    fun tagsAreCappedAtTen() =
        runTest {
            val (store, form) = newStore()
            var current = form
            (1..12).forEach { current = store.toggleTag(current, "t$it") }
            assertEquals(10, current.tagIds.size)
            assertEquals(9, store.toggleTag(current, "t1").tagIds.size)
            store.close()
        }
}
