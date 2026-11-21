package ch.orellbuehler.hauswart.feature.costs

import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class QuickEntryStoreTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private suspend fun open(
        book: String? = null,
        recent: String = """{"entriesPerBook":100,"items":[]}""",
    ): Pair<QuickEntryStore, QuickForm> {
        server.costsHousehold()
        server.on("GET", "/api/v1/costs/recent-categories", recent)
        val store = QuickEntryStore(app, book)
        val form = assertNotNull(store.await { it.initial != null }.initial)
        return store to form
    }

    @Test
    fun startsInTheDefaultBookPaidByMeForEverybody() =
        runTest {
            val (store, form) = open()
            assertEquals("b1", form.bookId)
            assertEquals("u1", form.paidByUserId)
            assertEquals(listOf("u1", "u2"), form.participants)
            assertEquals(Dates.today("Europe/Zurich"), form.date)
            assertEquals("", form.category)
            assertEquals("CHF", store.value.currency)
            assertEquals(listOf("b1", "b2"), store.value.books.map { it.id })
            store.close()
        }

    @Test
    fun theAskedBookThenTheLastUsedBookWin() =
        runTest {
            val (asked, form) = open("b2")
            assertEquals("b2", form.bookId)
            asked.close()

            app.settings.save("costs.quickBook", "b2")
            val (last, lastForm) = open()
            assertEquals("b2", lastForm.bookId)
            last.close()
        }

    @Test
    fun theChipsAreRankedByWhatTheBookUsed() =
        runTest {
            val (store, form) =
                open(
                    recent =
                        """{"entriesPerBook":100,"items":[{"bookId":"b1","category":"gifts","count":5},
                        {"bookId":"b2","category":"repair","count":9}]}""",
                )
            val view = store.view(form, expanded = false)
            assertEquals("gifts", view.categoryChips.first().value)
            assertEquals(VISIBLE_CATEGORIES, view.categoryChips.size)
            assertTrue(view.canExpand)
            assertEquals(tr("quick_categories_more"), view.expandLabel)
            val all = store.view(form, expanded = true)
            assertEquals(COST_CATEGORIES.size, all.categoryChips.size)
            assertEquals(tr("quick_categories_fewer"), all.expandLabel)
            assertEquals(listOf("b1", "b2"), view.bookChips.map { it.value })
            assertEquals(tr("quick_save"), view.saveLabel)
            assertEquals(tr("quick_save_amount", "amount" to "CHF 12.50"), store.view(form.copy(amount = "12.5"), false).saveLabel)
            store.close()
        }

    @Test
    fun theChipsStillWorkWhenTheRecentCategoriesCannotBeRead() =
        runTest {
            server.costsHousehold()
            server.onError("GET", "/api/v1/costs/recent-categories", HttpStatusCode.InternalServerError, "internal_error")
            val store = QuickEntryStore(app, null)
            val form = assertNotNull(store.await { it.initial != null }.initial)
            assertEquals(
                "groceries",
                store
                    .view(form, false)
                    .categoryChips
                    .first()
                    .value,
            )
            store.close()
        }

    @Test
    fun savingNeedsAnAmountAndACategory() =
        runTest {
            val (store, form) = open()
            store.save(form.copy(amount = ""))
            val state = store.await { it.fieldErrors.isNotEmpty() }
            assertEquals(tr("m_field_required"), state.fieldErrors["amountMinor"])
            assertEquals(tr("quick_category_required"), state.fieldErrors["category"])
            assertTrue(server.requestsTo("POST", "/api/v1/costs").isEmpty())
            store.close()
        }

    @Test
    fun anEntryIsBookedWithTheBooksSplitAndAKey() =
        runTest {
            val (store, form) = open()
            server.on("POST", "/api/v1/costs", costEntry("c9"), HttpStatusCode.Created)
            store.save(form.copy(amount = "12.", category = "groceries", payee = " Beispiel Markt "))
            assertEquals("c9", store.await { it.savedId != null }.savedId)
            val body = server.requestsTo("POST", "/api/v1/costs").single().json
            assertEquals(1200L, body.getValue("amountMinor").jsonPrimitive.longOrNull)
            assertEquals("groceries", body.getValue("category").jsonPrimitive.content)
            assertEquals("Beispiel Markt", body.getValue("title").jsonPrimitive.content)
            assertEquals("Beispiel Markt", body.getValue("payee").jsonPrimitive.content)
            assertEquals("b1", body.getValue("bookId").jsonPrimitive.content)
            assertEquals("u1", body.getValue("paidByUserId").jsonPrimitive.content)
            assertNull(body["splitMode"])
            assertNull(body["participantIds"])
            assertTrue(
                body
                    .getValue("idempotencyKey")
                    .jsonPrimitive.content.length in 8..128,
            )
            assertEquals("b1", app.settings.load("costs.quickBook"))
            store.close()
        }

    @Test
    fun theTitleIsWhatWasTypedElseThePayeeElseTheCategory() =
        runTest {
            val (store, form) = open()
            server.on("POST", "/api/v1/costs", costEntry("c9"), HttpStatusCode.Created)
            store.save(form.copy(amount = "5", category = "dining", title = "Znacht"))
            store.await { it.savedId != null }
            assertEquals(
                "Znacht",
                server
                    .requestsTo("POST", "/api/v1/costs")
                    .last()
                    .json
                    .getValue("title")
                    .jsonPrimitive.content,
            )
            store.close()

            val (second, secondForm) = open()
            second.save(secondForm.copy(amount = "5", category = "dining"))
            second.await { it.savedId != null }
            assertEquals(
                costCategoryLabel("dining"),
                server
                    .requestsTo("POST", "/api/v1/costs")
                    .last()
                    .json
                    .getValue("title")
                    .jsonPrimitive.content,
            )
            second.close()
        }

    @Test
    fun narrowingWhoItIsForBooksAnEqualSplitAmongThem() =
        runTest {
            val (store, form) = open("b2")
            server.on("POST", "/api/v1/costs", costEntry("c9"), HttpStatusCode.Created)
            val narrowed = store.toggleParticipant(form, "u2")
            assertEquals(false, narrowed.notShared)
            store.save(narrowed.copy(amount = "5", category = "gifts"))
            store.await { it.savedId != null }
            val body = server.requestsTo("POST", "/api/v1/costs").single().json
            assertEquals("equal", body.getValue("splitMode").jsonPrimitive.content)
            assertEquals(listOf("u1"), body.getValue("participantIds").jsonArray.map { it.jsonPrimitive.content })
            store.close()
        }

    @Test
    fun nobodyTickedIsNotGuessedUntilNotSharedIsChosen() =
        runTest {
            val (store, form) = open()
            val nobody = store.toggleParticipant(store.toggleParticipant(form, "u1"), "u2").copy(amount = "5", category = "gifts")
            val view = store.view(nobody, false)
            assertTrue(view.unchosen)
            assertEquals(false, view.notSharedOn)
            assertEquals(tr("quick_split_unchosen"), view.splitText)
            store.save(nobody)
            assertEquals(tr("quick_split_unchosen"), store.await { it.fieldErrors.isNotEmpty() }.fieldErrors["participants"])
            assertTrue(server.requestsTo("POST", "/api/v1/costs").isEmpty())

            server.on("POST", "/api/v1/costs", costEntry("c9"), HttpStatusCode.Created)
            val none = store.chooseNotShared(nobody)
            assertTrue(store.view(none, false).notSharedOn)
            assertEquals(tr("quick_split_none"), store.view(none, false).splitText)
            store.save(none)
            store.await { it.savedId != null }
            val body = server.requestsTo("POST", "/api/v1/costs").single().json
            assertEquals("none", body.getValue("splitMode").jsonPrimitive.content)
            store.close()
        }

    @Test
    fun theSplitSentenceSaysWhatTheChipsMean() =
        runTest {
            val (store, form) = open()
            assertEquals(tr("quick_split_equal_all"), store.view(form, false).splitText)
            assertEquals(tr("quick_split_equal_some", "names" to "Anna"), store.view(store.toggleParticipant(form, "u2"), false).splitText)
            assertEquals(tr("quick_split_ownership"), store.view(store.withBook(form, "b2"), false).splitText)
            store.close()
        }

    @Test
    fun anotherBookResetsWhoItIsForUnlessTheChipsWereTouched() =
        runTest {
            val (store, form) = open()
            val touched = store.toggleParticipant(form, "u2")
            assertEquals(listOf("u1"), store.withBook(touched, "b2").participants)
            assertEquals(listOf("u1", "u2"), store.withBook(form, "b2").participants)
            store.close()
        }

    @Test
    fun aRetryAfterNoAnswerUsesTheSameKey() =
        runTest {
            val (store, form) = open()
            server.offline = true
            val filled = form.copy(amount = "5", category = "gifts")
            store.save(filled)
            val failed = store.await { !it.saving && it.error != null }
            assertEquals(tr("quick_error_network"), failed.error?.message)

            server.offline = false
            server.on("POST", "/api/v1/costs", costEntry("c9"), HttpStatusCode.Created)
            store.save(filled)
            store.await { it.savedId != null }
            val keys =
                server.requestsTo("POST", "/api/v1/costs").map {
                    it.json
                        .getValue("idempotencyKey")
                        .jsonPrimitive.content
                }
            assertEquals(1, keys.size)
            store.close()
        }

    @Test
    fun aKeyUsedForAnotherEntryIsExplainedAndRenewed() =
        runTest {
            val (store, form) = open()
            val filled = form.copy(amount = "5", category = "gifts")
            server.onError("POST", "/api/v1/costs", HttpStatusCode.Conflict, "conflict", details = """{"code":"idempotency_key_reused"}""")
            store.save(filled)
            val state = store.await { !it.saving && it.error != null }
            assertEquals(tr("quick_error_key_used"), state.error?.message)
            server.on("POST", "/api/v1/costs", costEntry("c9"), HttpStatusCode.Created)
            store.save(filled)
            store.await { it.savedId != null }
            val keys =
                server.requestsTo("POST", "/api/v1/costs").map {
                    it.json
                        .getValue("idempotencyKey")
                        .jsonPrimitive.content
                }
            assertEquals(2, keys.size)
            assertTrue(keys[0] != keys[1])
            store.close()
        }

    @Test
    fun theLoadFailingOffersARetry() =
        runTest {
            server.costsHousehold()
            server.onError("GET", "/api/v1/cost-books", HttpStatusCode.InternalServerError, "internal_error")
            val store = QuickEntryStore(app, null)
            val state = store.await { it.loadError != null }
            assertEquals(tr("m_error_server"), state.loadError?.message)
            assertNull(state.initial)
            store.close()
        }
}
