package ch.orellbuehler.hauswart.feature.inbox

import ch.orellbuehler.hauswart.feature.costs.page
import ch.orellbuehler.hauswart.feature.costsplit.settle
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

class InboxStoreTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private val stamps = """"createdAt":"2026-11-01T00:00:00.000Z","updatedAt":"2026-11-01T00:00:00.000Z""""

    private fun cost(id: String) =
        """{"kind":"cost","id":"$id","status":"pending","acceptedEntityId":null,$stamps,"payload":{"source":"finance_transaction",
        "date":"2026-11-10","amountMinor":4250,"currency":"CHF","title":"Beispiel Markt","payee":"Beispiel Markt","category":"groceries",
        "url":"https://finance.example.org/t/1","assetId":null,"bookId":null}}"""

    private val entryJson =
        """{"id":"e1","title":"Einkauf","date":"2026-11-10","amountMinor":4250,"currency":"CHF","payee":null,"bookId":"b1","bookName":"Haushalt"}"""

    private fun link(
        id: String,
        entry: Boolean = true,
    ) = """{"kind":"link","id":"$id","status":"pending","acceptedEntityId":null,$stamps,"payload":{"entryId":"e1","entry":${
        if (entry) entryJson else "null"
    },"transaction":{"source":"finance_transaction","date":"2026-11-11","amountMinor":4250,"currency":"CHF","title":"Markt Zahlung",
        "payee":null,"category":"groceries","url":null,"assetId":null,"bookId":null}}}"""

    private fun integrations(connected: Boolean) =
        """{"items":[{"kind":"kept","level":"user","available":true,"capabilities":["categories"],"configured":$connected,"enabled":$connected,
        "baseUrl":null,"allowInsecureTls":false,"config":{},"status":"ok","lastError":null,"lastOkAt":null,"lastCheckedAt":null,"consecutiveFailures":0}],"nextCursor":null}"""

    @Test
    fun withoutAFinanceAppThereIsNothingToShow() =
        runTest {
            server.on("GET", "/api/v1/integrations", integrations(false))
            server.on("GET", "/api/v1/finance/suggestions", page())
            val store = InboxStore(app)
            val state = store.await { !it.loading }
            assertEquals(false, state.financeConnected)
            assertTrue(state.groups.isEmpty())
            settle()
            store.close()
        }

    @Test
    fun groupsFollowTheKindOrderAndLinksShowTheirEntry() =
        runTest {
            server.on("GET", "/api/v1/integrations", integrations(true))
            server.on("GET", "/api/v1/finance/suggestions", page(link("s2"), cost("s1"), link("s3", entry = false)))
            val store = InboxStore(app)
            val state = store.await { !it.loading }
            assertEquals(listOf("cost", "link"), state.groups.map { it.kind })
            val links = state.groups.last().items
            assertEquals("Einkauf", links.first().linkedEntry?.title)
            assertTrue(links.last().linkGone)
            assertEquals(
                "https://finance.example.org/t/1",
                state.groups
                    .first()
                    .items
                    .single()
                    .url,
            )
            assertNotNull(state.groups.last().hint)
            assertEquals(3, state.total)
            settle()
            store.close()
        }

    @Test
    fun acceptingSendsAnEmptyBodyAndOffersTheEntry() =
        runTest {
            server.on("GET", "/api/v1/integrations", integrations(true))
            server.on("GET", "/api/v1/finance/suggestions", page(cost("s1")))
            server.on(
                "POST",
                "/api/v1/finance/suggestions/s1/accept",
                """{"suggestion":${cost("s1")},"entity":{"type":"cost","id":"e9"}}""",
            )
            val store = InboxStore(app)
            store.await { !it.loading }
            store.accept("s1")
            val state = store.await { it.notice != null }
            assertEquals("e9", state.notice?.targetId)
            assertEquals("cost", state.notice?.targetKind)
            assertEquals("{}", server.requestsTo("POST", "/api/v1/finance/suggestions/s1/accept").single().body)
            settle()
            store.close()
        }

    @Test
    fun aDecidedSuggestionIsAConflictWorded() =
        runTest {
            server.on("GET", "/api/v1/integrations", integrations(true))
            server.on("GET", "/api/v1/finance/suggestions", page(cost("s1")))
            server.onError("POST", "/api/v1/finance/suggestions/s1/accept", HttpStatusCode.Conflict, "conflict")
            val store = InboxStore(app)
            store.await { !it.loading }
            store.accept("s1")
            val state = store.await { it.actionError != null }
            assertEquals(tr("finance_conflict"), state.actionError)
            settle()
            store.close()
        }

    @Test
    fun dismissingALinkSaysItComesBackAsABooking() =
        runTest {
            server.on("GET", "/api/v1/integrations", integrations(true))
            server.on("GET", "/api/v1/finance/suggestions", page(link("s2")))
            server.on("POST", "/api/v1/finance/suggestions/s2/dismiss", link("s2"))
            val store = InboxStore(app)
            store.await { !it.loading }
            assertEquals(tr("finance_dismiss_link_title"), store.dismissTitle("s2"))
            store.dismiss("s2")
            val state = store.await { it.notice != null }
            assertEquals(tr("finance_dismissed_link_toast", "title" to "Markt Zahlung"), state.notice?.message)
            settle()
            store.close()
        }

    @Test
    fun aFailedSyncIsReportedByItsCode() =
        runTest {
            server.on("GET", "/api/v1/integrations", integrations(true))
            server.on("GET", "/api/v1/finance/suggestions", page())
            server.on("POST", "/api/v1/finance/sync", """{"ok":false,"error":{"code":"upstream_unreachable","message":"x"},"stats":{}}""")
            val store = InboxStore(app)
            store.await { !it.loading }
            store.sync()
            val state = store.await { it.syncError != null }
            assertEquals(tr("finance_sync_failed", "code" to "upstream_unreachable"), state.syncError)
            assertEquals(false, state.syncing)
            settle()
            store.close()
        }

    @Test
    fun syncingWithoutAConnectionSaysSo() =
        runTest {
            server.on("GET", "/api/v1/integrations", integrations(true))
            server.on("GET", "/api/v1/finance/suggestions", page())
            server.onError("POST", "/api/v1/finance/sync", HttpStatusCode.NotFound, "not_found")
            val store = InboxStore(app)
            store.await { !it.loading }
            store.sync()
            assertEquals(tr("finance_sync_not_connected"), store.await { it.syncError != null }.syncError)
            settle()
            store.close()
        }

    @Test
    fun theMenuShowsTheInboxOnlyWhileConnectedAndCountsReceipts() =
        runTest {
            server.on("GET", "/api/v1/integrations", integrations(false))
            server.on("GET", "/api/v1/ai-tasks/count", """{"count":3}""")
            val off = CostsMenuStore(app)
            val menu = off.await { it.entries.any { e -> e.badge != null } }
            assertNull(menu.entries.firstOrNull { it.key == MENU_INBOX })
            assertEquals("3", menu.entries.first { it.key == MENU_RECEIPTS }.badge)
            settle()
            off.close()

            server.on("GET", "/api/v1/integrations", integrations(true))
            val on = CostsMenuStore(app)
            assertNotNull(on.await { it.entries.any { e -> e.key == MENU_INBOX } }.entries)
            settle()
            on.close()
        }

    @Test
    fun theAcceptFormSendsOnlyWhatChanged() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/finance/suggestions", page(cost("s1")))
            server.on(
                "GET",
                "/api/v1/cost-books",
                page(
                    ch.orellbuehler.hauswart.feature.costs
                        .costBook("b1", "Haushalt", isDefault = true, split = "ownership"),
                ),
            )
            server.on("GET", "/api/v1/cost-tags", """{"items":[]}""")
            server.on("GET", "/api/v1/assets", page())
            server.on("GET", "/api/v1/rooms", page())
            server.on(
                "POST",
                "/api/v1/finance/suggestions/s1/accept",
                """{"suggestion":${cost("s1")},"entity":{"type":"cost","id":"e9"}}""",
            )
            val store = SuggestionAcceptStore(app, "s1")
            val form = assertNotNull(store.await { it.initial != null }.initial)
            store.save(form.copy(title = "Wocheneinkauf", category = "household"))
            val state = store.await { it.done != null }
            assertEquals("e9", state.done?.targetId)
            val body = server.requestsTo("POST", "/api/v1/finance/suggestions/s1/accept").single().json
            assertEquals("Wocheneinkauf", body.getValue("title").toString().trim('"'))
            assertEquals("household", body.getValue("category").toString().trim('"'))
            assertNull(body["bookId"])
            assertNull(body["splitMode"])
            settle()
            store.close()
        }
}
