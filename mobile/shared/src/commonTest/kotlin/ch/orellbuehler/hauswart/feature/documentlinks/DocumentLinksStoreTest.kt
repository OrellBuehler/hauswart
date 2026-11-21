package ch.orellbuehler.hauswart.feature.documentlinks

import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DocumentLinksStoreTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private fun link(
        id: String,
        externalId: Long = 7,
        title: String = "Boiler manual",
        available: Boolean = true,
        role: String = "manual",
        label: String? = null,
    ): String =
        """{"id":"$id","provider":"paperless","externalId":$externalId,"ownerType":"asset","ownerId":"a1","ownerTitle":"Boiler","ownerUrl":"/assets/a1",
            "role":"$role","label":${if (label == null) "null" else "\"$label\""},"available":$available,
            "document":${if (available) """{"title":"$title","createdDate":"2026-01-05","correspondentName":"Example Corp","mimeType":"application/pdf","pageCount":12,"tagNames":[]}""" else "null"},
            "thumbUrl":${if (available) "\"/api/v1/documents/paperless/$externalId/thumb\"" else "null"},
            "previewUrl":${if (available) "\"/api/v1/documents/paperless/$externalId/preview\"" else "null"},
            "downloadUrl":${if (available) "\"/api/v1/documents/paperless/$externalId/download\"" else "null"},
            "createdBy":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}"""

    private fun page(vararg items: String) = """{"items":[${items.joinToString(",")}],"nextCursor":null}"""

    private fun integrations(connected: Boolean) =
        server.on(
            "GET",
            "/api/v1/integrations",
            page(
                """{"kind":"paperless","level":"user","available":true,"capabilities":[],"configured":$connected,"enabled":true,"baseUrl":null,
                    "allowInsecureTls":false,"config":{},"status":"ok","lastError":null,"lastOkAt":null,"lastCheckedAt":null,"consecutiveFailures":0}""",
            ),
        )

    @Test
    fun listsTheLinkedDocumentsOfTheOwner() =
        runTest {
            integrations(true)
            server.on(
                "GET",
                "/api/v1/document-links",
                page(link("l1", label = "Page 3"), link("l2", 8, available = false, role = "invoice")),
            )
            val store = DocumentLinksStore(app, "asset", "a1")
            val state = store.await { !it.loading }
            assertNull(state.error)
            assertTrue(state.visible)
            assertTrue(state.canLink)
            val first = state.rows[0]
            assertEquals("Boiler manual", first.title)
            assertEquals(tr("document_role_manual"), first.roleLabel)
            assertEquals("Example Corp · 05.01.2026 · ${tr("document_pages", "count" to 12)} · Page 3", first.details)
            assertTrue(first.canOpen && first.hasThumb && first.available)
            val second = state.rows[1]
            assertEquals(tr("document_unavailable"), second.title)
            assertFalse(second.available || second.canOpen || second.hasThumb)
            val query = server.requests.first { it.path == "/api/v1/document-links" }.query
            assertTrue("ownerType=asset" in query && "ownerId=a1" in query)
            store.close()
        }

    @Test
    fun showsNothingWithoutADocumentSystemAndWithoutLinks() =
        runTest {
            integrations(false)
            server.on("GET", "/api/v1/document-links", page())
            val store = DocumentLinksStore(app, "asset", "a1")
            val state = store.await { !it.loading }
            assertFalse(state.visible)
            assertFalse(state.canLink)
            store.close()
        }

    @Test
    fun keepsShowingLinksThatRemainWhenTheConnectionIsGone() =
        runTest {
            integrations(false)
            server.on("GET", "/api/v1/document-links", page(link("l1")))
            val store = DocumentLinksStore(app, "asset", "a1")
            val state = store.await { !it.loading }
            assertTrue(state.visible)
            assertFalse(state.canLink)
            store.close()
        }

    @Test
    fun linkingStaysOutWhenTheConnectionsCannotBeAsked() =
        runTest {
            server.onError("GET", "/api/v1/integrations", HttpStatusCode.Forbidden, "forbidden")
            server.on("GET", "/api/v1/document-links", page(link("l1")))
            val store = DocumentLinksStore(app, "asset", "a1")
            val state = store.await { !it.loading }
            assertNull(state.connected)
            assertFalse(state.canLink)
            assertEquals(1, state.rows.size)
            store.close()
        }

    @Test
    fun aFailedLoadShowsTheSectionWithItsError() =
        runTest {
            integrations(true)
            server.onError("GET", "/api/v1/document-links", HttpStatusCode.InternalServerError, "internal_error")
            val store = DocumentLinksStore(app, "asset", "a1")
            val state = store.await { !it.loading }
            assertEquals(tr("m_error_server"), state.error?.message)
            assertTrue(state.visible)
            store.close()
        }

    @Test
    fun unlinkingRemovesTheRow() =
        runTest {
            integrations(true)
            server.on("GET", "/api/v1/document-links", page(link("l1"), link("l2", 8)))
            val store = DocumentLinksStore(app, "asset", "a1")
            store.await { !it.loading }
            server.on("GET", "/api/v1/document-links", page(link("l2", 8)))
            server.on("DELETE", "/api/v1/document-links/l1", "", HttpStatusCode.NoContent)
            store.unlink("l1")
            val state = store.await { it.rows.map { r -> r.id } == listOf("l2") && it.unlinkingId == null }
            assertNull(state.actionError)
            store.close()
        }

    @Test
    fun aFailedUnlinkReports() =
        runTest {
            integrations(true)
            server.on("GET", "/api/v1/document-links", page(link("l1")))
            server.onError("DELETE", "/api/v1/document-links/l1", HttpStatusCode.Forbidden, "forbidden")
            val store = DocumentLinksStore(app, "asset", "a1")
            store.await { !it.loading }
            store.unlink("l1")
            val state = store.await { it.actionError != null }
            assertEquals(1, state.rows.size)
            assertNull(state.unlinkingId)
            store.close()
        }

    @Test
    fun openingFetchesThePreviewAndNamesTheFile() =
        runTest {
            integrations(true)
            server.on("GET", "/api/v1/document-links", page(link("l1")))
            server.on("GET", "/api/v1/documents/paperless/7/preview", "%PDF")
            val store = DocumentLinksStore(app, "asset", "a1")
            store.await { !it.loading }
            store.open("l1")
            val opened = assertNotNull(store.await { it.opened != null }.opened)
            assertEquals("Boiler manual", opened.name)
            assertEquals("application/json", opened.mime)
            assertContentEquals("%PDF".encodeToByteArray(), opened.bytes)
            store.clearOpened()
            assertNull(store.value.opened)

            server.on("GET", "/api/v1/documents/paperless/7/download", "ORIGINAL")
            store.openOriginal("l1")
            store.await { it.opened != null }
            assertTrue("original=1" in server.requestsTo("GET", "/api/v1/documents/paperless/7/download").single().query)
            store.close()
        }

    @Test
    fun thumbnailsLoadLazily() =
        runTest {
            integrations(true)
            server.on("GET", "/api/v1/document-links", page(link("l1")))
            server.on("GET", "/api/v1/documents/paperless/7/thumb", "T")
            val store = DocumentLinksStore(app, "asset", "a1")
            store.await { !it.loading }
            assertTrue(server.requestsTo("GET", "/api/v1/documents/paperless/7/thumb").isEmpty())
            store.requestThumbnail("l1")
            store.await { store.thumbnail("l1") != null }
            assertEquals("VA==", store.thumbnailBase64("l1"))
            store.close()
        }
}
