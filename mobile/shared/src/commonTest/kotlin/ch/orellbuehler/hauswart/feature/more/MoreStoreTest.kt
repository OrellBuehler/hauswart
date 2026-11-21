package ch.orellbuehler.hauswart.feature.more

import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.seconds

class MoreStoreTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private fun integration(
        enabled: Boolean,
        configured: Boolean = true,
        available: Boolean = true,
        kind: String = "paperless",
    ) = """{"kind":"$kind","level":"user","available":$available,"capabilities":[],"configured":$configured,"enabled":$enabled,
        "baseUrl":null,"allowInsecureTls":false,"config":{},"status":"ok","lastError":null,"lastOkAt":null,
        "lastCheckedAt":null,"consecutiveFailures":0}"""

    /** Waits until the store asked [count] times and has had time to read the answer. */
    private suspend fun answered(count: Int) =
        withContext(Dispatchers.Default) {
            withTimeout(10.seconds) { while (server.requestsTo("GET", "/api/v1/integrations").size < count) delay(10) }
            delay(150)
        }

    private fun ids(state: MoreState) = state.groups.flatMap { g -> g.items.map { it.id } }

    @Test
    fun theDocumentsRowIsHiddenUntilADocumentSystemIsKnownToWork() =
        runTest {
            server.on("GET", "/api/v1/integrations", """{"items":[${integration(enabled = true)}],"nextCursor":null}""")
            assertFalse("documents" in ids(MoreState(userName = "", username = "", groups = moreGroups(documentSystem = false))))
            val store = MoreStore(app)
            val state = store.await { it.documentSystem }
            assertTrue("documents" in ids(state))
            assertEquals(listOf("inventory", "rooms", "plants", "docs", "documents"), state.groups[1].items.map { it.id })
            store.close()
        }

    @Test
    fun aConnectionThatIsOffOrNotSetUpShowsNoRow() =
        runTest {
            server.on(
                "GET",
                "/api/v1/integrations",
                """{"items":[${integration(enabled = false)},${integration(enabled = true, kind = "kept")}],"nextCursor":null}""",
            )
            val store = MoreStore(app)
            answered(1)
            assertFalse("documents" in ids(store.value))
            server.on("GET", "/api/v1/integrations", """{"items":[${integration(enabled = true, configured = false)}],"nextCursor":null}""")
            app.changed("integrations")
            answered(2)
            assertFalse("documents" in ids(store.value))
            server.on("GET", "/api/v1/integrations", """{"items":[${integration(enabled = true)}],"nextCursor":null}""")
            app.changed("integrations")
            assertTrue("documents" in ids(store.await { it.documentSystem }))
            store.close()
        }

    @Test
    fun theRowStaysHiddenWhenTheConnectionsCannotBeRead() =
        runTest {
            server.onError("GET", "/api/v1/integrations", HttpStatusCode.InternalServerError, "internal")
            val store = MoreStore(app)
            answered(1)
            assertFalse("documents" in ids(store.value))
            store.close()
        }
}
