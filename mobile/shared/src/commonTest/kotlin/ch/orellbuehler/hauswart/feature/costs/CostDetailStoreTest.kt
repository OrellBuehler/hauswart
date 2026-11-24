package ch.orellbuehler.hauswart.feature.costs

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

class CostDetailStoreTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private fun serve(entry: String) {
        server.costsHousehold()
        server.on("GET", "/api/v1/costs/c1", entry)
    }

    @Test
    fun showsWhatTheEntryIs() =
        runTest {
            serve(
                costEntry(
                    "c1",
                    payee = "Beispiel Markt",
                    notes = "Für das Wochenende",
                    assetId = "a1",
                    assetName = "Kühlschrank",
                    tags = """[{"id":"t1","name":"Fest","color":"blue"}]""",
                ),
            )
            val store = CostDetailStore(app, "c1")
            val cost = assertNotNull(store.await { it.cost != null }.cost)
            assertEquals("Wocheneinkauf", cost.title)
            assertEquals("CHF 42.50", cost.amount)
            assertEquals(tr("cost_category_groceries"), cost.category)
            assertEquals("12.11.2026", cost.date)
            assertEquals("Für das Wochenende", cost.notes)
            assertEquals(listOf("Fest"), cost.tags.map { it.name })
            assertEquals(tr("cost_split_equal"), cost.splitTitle)
            assertEquals(listOf("Anna", "Ben"), cost.shares.map { it.name })
            assertEquals(listOf("50 %", "50 %"), cost.shares.map { it.percent })
            assertEquals(listOf("CHF 21.25", "CHF 21.25"), cost.shares.map { it.amount })
            assertEquals(tr("cost_shares_frozen"), cost.sharesNote)
            val facts = cost.facts.associate { it.label to it }
            assertEquals("Haushalt", facts.getValue(tr("cost_book")).value)
            assertEquals("Anna", facts.getValue(tr("cost_paid_by")).value)
            assertEquals("Beispiel Markt", facts.getValue(tr("cost_payee")).value)
            assertEquals("asset", facts.getValue(tr("cost_asset")).linkKind)
            assertEquals("a1", facts.getValue(tr("cost_asset")).linkId)
            assertEquals(tr("common_yes"), facts.getValue(tr("cost_counts_as_expense")).value)
            assertEquals(tr("cost_source_manual"), facts.getValue(tr("cost_source")).value)
            assertNull(facts[tr("cost_deductible")])
            assertTrue(facts.getValue(tr("cost_created")).value.contains(tr("cost_created_by", "name" to "Anna")))
            store.close()
        }

    @Test
    fun anEntryWithoutSharesSaysItIsNotSplit() =
        runTest {
            serve(costEntry("c1", splitMode = "none", shares = "[]", taxRelevant = true, deductible = "maintenance"))
            val store = CostDetailStore(app, "c1")
            val cost = assertNotNull(store.await { it.cost != null }.cost)
            assertTrue(cost.shares.isEmpty())
            assertEquals(tr("cost_shares_none"), cost.sharesNote)
            assertEquals(tr("cost_deductible_maintenance"), cost.facts.first { it.label == tr("cost_deductible") }.value)
            store.close()
        }

    @Test
    fun aMissingEntryIsAnError() =
        runTest {
            server.costsHousehold()
            val store = CostDetailStore(app, "gone")
            val state = store.await { !it.loading }
            assertEquals(tr("m_error_not_found"), state.error?.message)
            assertNull(state.cost)
            store.close()
        }

    @Test
    fun deletingClosesTheScreenAndReportsTheChange() =
        runTest {
            serve(costEntry("c1"))
            server.on("DELETE", "/api/v1/costs/c1", "", HttpStatusCode.NoContent)
            val store = CostDetailStore(app, "c1")
            store.await { it.cost != null }
            store.delete()
            assertTrue(store.await { it.deleted }.deleted)
            assertEquals(1, server.requestsTo("DELETE", "/api/v1/costs/c1").size)
            assertEquals(tr("cost_delete_description", "title" to "Wocheneinkauf"), store.deleteText())
            store.close()
        }

    @Test
    fun aFailedDeleteKeepsTheEntry() =
        runTest {
            serve(costEntry("c1"))
            server.onError("DELETE", "/api/v1/costs/c1", HttpStatusCode.Forbidden, "forbidden")
            val store = CostDetailStore(app, "c1")
            store.await { it.cost != null }
            store.delete()
            val state = store.await { it.actionError != null }
            assertEquals(tr("m_error_forbidden"), state.actionError?.message)
            assertEquals(false, state.deleted)
            assertNotNull(state.cost)
            store.dismissActionError()
            assertNull(store.await { it.actionError == null }.actionError)
            store.close()
        }

    @Test
    fun anEntryOfTheFuelLogCannotBeDeletedHere() =
        runTest {
            serve(costEntry("c1", fuelLogId = "f1"))
            val store = CostDetailStore(app, "c1")
            val cost = assertNotNull(store.await { it.cost != null }.cost)
            assertTrue(cost.fuelOwned)
            assertEquals(tr("cost_fuel_owned_delete_hint"), cost.fuelHint)
            store.delete()
            assertTrue(server.requestsTo("DELETE", "/api/v1/costs/c1").isEmpty())
            store.close()
        }

    @Test
    fun markingAsReviewedAsksTheServerAndReloads() =
        runTest {
            serve(costEntry("c1", reviewNeeded = true, source = "manual"))
            server.on("POST", "/api/v1/costs/c1/review", costEntry("c1"))
            val store = CostDetailStore(app, "c1")
            assertTrue(assertNotNull(store.await { it.cost != null }.cost).reviewNeeded)
            server.on("GET", "/api/v1/costs/c1", costEntry("c1", reviewNeeded = false))
            store.markReviewed()
            val state = store.await { it.reviewedMessage != null && it.cost?.reviewNeeded == false }
            assertEquals(tr("cost_review_done_toast", "title" to "Wocheneinkauf"), state.reviewedMessage)
            assertEquals(1, server.requestsTo("POST", "/api/v1/costs/c1/review").size)
            store.dismissReviewedMessage()
            assertNull(store.await { it.reviewedMessage == null }.reviewedMessage)
            store.close()
        }
}
