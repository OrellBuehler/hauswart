package ch.orellbuehler.hauswart.feature.costs

import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class BankMatchingTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private fun integrations(connected: Boolean) =
        """{"items":[{"kind":"kept","level":"user","available":true,"capabilities":["categories"],"configured":$connected,"enabled":$connected,
        "baseUrl":null,"allowInsecureTls":false,"config":{},"status":"ok","lastError":null,"lastOkAt":null,"lastCheckedAt":null,"consecutiveFailures":0}],"nextCursor":null}"""

    private fun match(
        id: String,
        date: String = "2026-11-12",
        amountMinor: Long = 4250,
        title: String = "BEISPIEL MARKT ZUERICH",
        payee: String? = "Beispiel Markt",
    ) = """{"id":"$id","kind":"cost","status":"pending","acceptedEntityId":null,"createdAt":"2026-11-12T10:00:00.000Z",
        "updatedAt":"2026-11-12T10:00:00.000Z","payload":{"source":"finance_transaction","date":"$date","amountMinor":$amountMinor,
        "currency":"CHF","title":"$title","payee":${payee?.let {
        "\"$it\""
    } ?: "null"},"category":"groceries","url":null,"assetId":null,"bookId":null}}"""

    private fun serveForms(
        connected: Boolean = true,
        matches: String = """{"items":[${match("s1")},${match("s2", date = "2026-11-14", title = "Kiosk", payee = null)}]}""",
    ) {
        server.costsHousehold()
        server.on("GET", "/api/v1/integrations", integrations(connected))
        server.on("GET", "/api/v1/finance/matches", matches)
        server.on("GET", "/api/v1/cost-tags", """{"items":[]}""")
        server.on("GET", "/api/v1/assets", page())
        server.on("GET", "/api/v1/costs/recent-categories", """{"entriesPerBook":100,"items":[]}""")
    }

    private suspend fun editForm(): Pair<CostEditStore, CostForm> {
        val store = CostEditStore(app, null, null, null).also { it.matchDelayMs = 0 }
        val form = assertNotNull(store.await { it.initial != null }.initial)
        return store to form.copy(title = "Wocheneinkauf", amount = "42.50", date = "2026-11-12")
    }

    @Test
    fun theFormOffersTheTransactionsThatFitAndSendsTheChosenOne() =
        runTest {
            serveForms()
            val (store, form) = editForm()
            store.matchesFor(form)
            val matches = store.await { it.matches.items.isNotEmpty() }.matches
            assertEquals(listOf("s1", "s2"), matches.items.map { it.id })
            assertEquals("BEISPIEL MARKT ZUERICH", matches.items[0].title)
            assertEquals(tr("match_booked", "date" to "12.11.2026", "when" to tr("match_same_day")), matches.items[0].booked)
            assertEquals(
                tr("match_booked", "date" to "14.11.2026", "when" to tr("match_days_later", "count" to 2)),
                matches.items[1].booked,
            )
            assertEquals("CHF 42.50", matches.items[0].amount)
            val query = server.requestsTo("GET", "/api/v1/finance/matches").single().query
            assertTrue(query.contains("amountMinor=4250") && query.contains("date=2026-11-12"), query)

            store.chooseMatch("s1")
            assertTrue(
                store.value.matches.items[0]
                    .chosen,
            )
            server.on("POST", "/api/v1/costs", costEntry("c9"), HttpStatusCode.Created)
            store.save(form)
            store.await { it.savedId != null }
            assertEquals(
                "s1",
                server
                    .requestsTo("POST", "/api/v1/costs")
                    .single()
                    .json
                    .getValue("financeSuggestionId")
                    .jsonPrimitive.content,
            )
            store.close()
        }

    @Test
    fun withoutAFinanceConnectionNothingIsAskedOrSent() =
        runTest {
            serveForms(connected = false)
            val (store, form) = editForm()
            store.matchesFor(form)
            assertFalse(store.value.matches.visible)
            server.on("POST", "/api/v1/costs", costEntry("c9"), HttpStatusCode.Created)
            store.save(form)
            store.await { it.savedId != null }
            assertTrue(server.requestsTo("GET", "/api/v1/finance/matches").isEmpty())
            assertFalse(
                server
                    .requestsTo("POST", "/api/v1/costs")
                    .single()
                    .json
                    .containsKey("financeSuggestionId"),
            )
            store.close()
        }

    @Test
    fun aChoiceLetGoOfWhenTheAmountMovesAwayIsNotSent() =
        runTest {
            serveForms()
            val (store, form) = editForm()
            store.matchesFor(form)
            store.await { it.matches.items.isNotEmpty() }
            store.chooseMatch("s1")
            val changed = form.copy(amount = "50")
            store.matchesFor(changed)
            val state = store.await { it.matches.released }
            assertTrue(state.matches.items.none { it.chosen })
            assertEquals(tr("match_reset"), state.matches.releasedNote)
            server.on("POST", "/api/v1/costs", costEntry("c9"), HttpStatusCode.Created)
            store.save(changed)
            store.await { it.savedId != null }
            assertFalse(
                server
                    .requestsTo("POST", "/api/v1/costs")
                    .single()
                    .json
                    .containsKey("financeSuggestionId"),
            )
            store.close()
        }

    @Test
    fun aRefusedTransactionIsLetGoOfAndSaidSoUnderTheList() =
        runTest {
            serveForms()
            val (store, form) = editForm()
            store.matchesFor(form)
            store.await { it.matches.items.isNotEmpty() }
            store.chooseMatch("s1")
            server.onError("POST", "/api/v1/costs", HttpStatusCode.Conflict, "conflict", details = """{"code":"suggestion_decided"}""")
            store.save(form)
            val state = store.await { !it.saving && it.error != null }
            assertEquals(tr("match_error_decided"), state.matches.error)
            assertEquals(tr("match_error_decided"), state.fieldErrors["financeSuggestionId"])
            assertEquals(tr("form_check_fields"), state.error?.message)
            assertTrue(state.matches.items.none { it.chosen })
            store.close()
        }

    @Test
    fun aFailedLookupOffersARetry() =
        runTest {
            serveForms()
            server.onError("GET", "/api/v1/finance/matches", HttpStatusCode.BadGateway, "upstream_error")
            val (store, form) = editForm()
            store.matchesFor(form)
            val state = store.await { it.matches.failed }
            assertTrue(state.matches.visible)
            assertTrue(state.matches.items.isEmpty())
            server.on("GET", "/api/v1/finance/matches", """{"items":[${match("s1")}]}""")
            store.matchesFor(form)
            assertEquals(
                listOf("s1"),
                store
                    .await { it.matches.items.isNotEmpty() }
                    .matches.items
                    .map { it.id },
            )
            store.close()
        }

    @Test
    fun anEntryThatIsTiedToABankItemAlreadyIsNotOffered() =
        runTest {
            serveForms()
            server.on("GET", "/api/v1/costs/c1", costEntry("c1").replace("\"financeLinked\":false", "\"financeLinked\":true"))
            val store = CostEditStore(app, "c1", null, null).also { it.matchDelayMs = 0 }
            val form = assertNotNull(store.await { it.initial != null }.initial)
            store.matchesFor(form)
            assertFalse(store.value.matches.visible)
            assertTrue(server.requestsTo("GET", "/api/v1/finance/matches").isEmpty())
            store.close()
        }

    @Test
    fun theQuickFormTiesTheEntryToo() =
        runTest {
            serveForms()
            val store = QuickEntryStore(app, null).also { it.matchDelayMs = 0 }
            val form =
                assertNotNull(
                    store.await { it.initial != null }.initial,
                ).copy(amount = "42.50", date = "2026-11-12", category = "groceries")
            store.matchesFor(form)
            store.await { it.matches.items.isNotEmpty() }
            store.chooseMatch("s1")
            server.on("POST", "/api/v1/costs", costEntry("c9"), HttpStatusCode.Created)
            store.save(form)
            store.await { it.savedId != null }
            val body = server.requestsTo("POST", "/api/v1/costs").single().json
            assertEquals("s1", body.getValue("financeSuggestionId").jsonPrimitive.content)
            store.close()
        }

    @Test
    fun theQuickFormKeepsItsKeyWhenTheTransactionWasDecided() =
        runTest {
            serveForms()
            val store = QuickEntryStore(app, null).also { it.matchDelayMs = 0 }
            val form =
                assertNotNull(
                    store.await { it.initial != null }.initial,
                ).copy(amount = "42.50", date = "2026-11-12", category = "groceries")
            store.matchesFor(form)
            store.await { it.matches.items.isNotEmpty() }
            store.chooseMatch("s1")
            server.onError("POST", "/api/v1/costs", HttpStatusCode.Conflict, "conflict", details = """{"code":"suggestion_decided"}""")
            store.save(form)
            val state = store.await { !it.saving && it.error != null }
            assertEquals(tr("match_error_decided"), state.matches.error)
            server.on("POST", "/api/v1/costs", costEntry("c9"), HttpStatusCode.Created)
            store.save(form)
            store.await { it.savedId != null }
            val keys =
                server.requestsTo("POST", "/api/v1/costs").map {
                    it.json
                        .getValue("idempotencyKey")
                        .jsonPrimitive.content
                }
            assertEquals(2, keys.size)
            assertEquals(keys[0], keys[1])
            assertNull(server.requestsTo("POST", "/api/v1/costs").last().json["financeSuggestionId"])
            store.close()
        }
}
