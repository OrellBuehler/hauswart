package ch.orellbuehler.hauswart.feature.documents

import ch.orellbuehler.hauswart.feature.applink.LINK_ASSET
import ch.orellbuehler.hauswart.feature.inventory.assetJson
import ch.orellbuehler.hauswart.feature.inventory.json
import ch.orellbuehler.hauswart.feature.inventory.page
import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DocumentsStoresTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private fun integrations(
        configured: Boolean,
        status: String = "ok",
        lastError: String? = null,
    ) = server.on(
        "GET",
        "/api/v1/integrations",
        page(
            """{"kind":"paperless","level":"user","available":true,"capabilities":[],"configured":$configured,"enabled":true,"baseUrl":null,
                    "allowInsecureTls":false,"config":{},"status":"$status","lastError":${lastError.json()},"lastOkAt":null,"lastCheckedAt":null,"consecutiveFailures":0}""",
        ),
    )

    private fun doc(
        id: Long,
        title: String,
        tags: List<String> = emptyList(),
        linked: Boolean = false,
        warranty: String? = null,
    ) =
        """{"provider":"paperless","externalId":$id,"title":"$title","createdDate":"2026-01-05","correspondentId":1,"correspondentName":"Example Corp",
        "tagIds":[],"tagNames":[${tags.joinToString(",") { "\"$it\"" }}],"mimeType":"application/pdf","pageCount":2,"noteCount":0,
        "warrantyUntil":${warranty.json()},"warrantyExtendedUntil":null,
        "linkedTo":[${if (linked) """{"linkId":"l1","ownerType":"asset","ownerId":"a1","ownerTitle":"Boiler","ownerUrl":"/assets/a1","role":"manual"}""" else ""}],
        "thumbUrl":"/t","previewUrl":"/p","downloadUrl":"/d"}"""

    @Test
    fun withoutAConnectionTheAreaSaysSo() =
        runTest {
            integrations(configured = false)
            val store = DocumentsListStore(app)
            val state = store.await { it.connected != null }
            assertEquals(false, state.connected)
            assertTrue(server.requests.none { it.path == "/api/v1/documents" })
            store.close()
        }

    @Test
    fun theListShowsDocumentsWithTagsAndWhereTheyAreUsed() =
        runTest {
            integrations(configured = true, status = "error", lastError = "timeout")
            server.on(
                "GET",
                "/api/v1/documents",
                page(doc(1, "Boiler manual", tags = listOf("a", "b", "c", "d"), linked = true), doc(2, "Receipt", warranty = "2027-01-01")),
            )
            val store = DocumentsListStore(app)
            val state = store.await { !it.loading && it.rows.isNotEmpty() }
            assertTrue(state.connectionWarning.endsWith("timeout"))
            val first = state.rows[0]
            assertEquals(listOf("a", "b", "c"), first.tags)
            assertEquals(1, first.moreTags)
            assertEquals(tr("documents_used_in", "places" to "Boiler"), first.usedIn)
            assertTrue(state.rows[1].unused)
            assertEquals(tr("document_suggestion_warranty", "date" to "01.01.2027"), state.rows[1].warranty)
            assertTrue("Example Corp" in first.details && "05.01.2026" in first.details)
            store.close()
        }

    @Test
    fun searchAndLinkedFilterGoToTheServer() =
        runTest {
            integrations(configured = true)
            server.on("GET", "/api/v1/documents", page(doc(1, "Boiler manual")))
            val store = DocumentsListStore(app)
            store.await { !it.loading && it.rows.isNotEmpty() }
            store.setQuery("boiler")
            store.await { it.query == "boiler" && !it.loading }
            store.setLinked(DOCUMENTS_LINKED_NO)
            store.await { it.linked == DOCUMENTS_LINKED_NO && !it.loading }
            val last = server.requestsTo("GET", "/api/v1/documents").last()
            assertTrue("q=boiler" in last.query && "linked=false" in last.query, last.query)
            assertTrue(store.value.filtered)
            store.close()
        }

    @Test
    fun anUpstreamFailureIsShownWithRetry() =
        runTest {
            integrations(configured = true)
            server.onError("GET", "/api/v1/documents", HttpStatusCode.BadGateway, "upstream_error")
            val store = DocumentsListStore(app)
            val state = store.await { !it.loading && it.error != null }
            assertEquals(tr("m_error_upstream"), state.error?.message)
            store.close()
        }

    private fun detailJson() =
        doc(7, "Boiler manual", tags = listOf("manual")).dropLast(1) +
            ""","webUrl":"https://docs.example.org/documents/7","links":[{"id":"l1","provider":"paperless","externalId":7,"ownerType":"asset","ownerId":"a1",
            "ownerTitle":"Boiler","ownerUrl":"/assets/a1","role":"manual","label":"p. 3","available":true,"document":null,"thumbUrl":null,"previewUrl":null,
            "downloadUrl":null,"createdBy":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}]}"""

    @Test
    fun theDetailShowsFactsAndUsesAndUnlinks() =
        runTest {
            server.on("GET", "/api/v1/documents/paperless/7", detailJson())
            server.on("DELETE", "/api/v1/document-links/l1", "", HttpStatusCode.NoContent)
            val store = DocumentDetailStore(app, "7")
            val state = store.await { it.title.isNotEmpty() }
            assertEquals("Boiler manual", state.title)
            assertTrue(state.facts.any { it.label == tr("documents_field_correspondent") && it.value == "Example Corp" })
            val use = state.uses.single()
            assertEquals(LINK_ASSET, use.link?.kind)
            assertEquals("a1", use.link?.id)
            assertEquals("p. 3", use.label)
            store.unlink("l1")
            assertEquals(tr("document_unlinked_toast"), store.await { it.notice != null }.notice)
            assertEquals(1, server.requestsTo("DELETE", "/api/v1/document-links/l1").size)
            store.close()
        }

    @Test
    fun openingFetchesThePreviewAndTheOriginalForSharing() =
        runTest {
            server.on("GET", "/api/v1/documents/paperless/7", detailJson())
            server.on("GET", "/api/v1/documents/paperless/7/preview", "PDF")
            server.on("GET", "/api/v1/documents/paperless/7/download", "ORIGINAL")
            val store = DocumentDetailStore(app, "7")
            store.await { it.title.isNotEmpty() }
            store.open()
            val opened = store.await { it.opened != null }.opened!!
            assertEquals(false, opened.share)
            assertEquals("PDF", opened.file.bytes.decodeToString())
            store.clearOpened()
            store.openOriginal()
            val original = store.await { it.opened != null }.opened!!
            assertTrue(original.share)
            assertTrue("original=1" in server.requestsTo("GET", "/api/v1/documents/paperless/7/download").single().query)
            store.close()
        }

    private fun assetSuggestion(
        id: Long,
        title: String,
    ) =
        """{"kind":"asset","provider":"paperless","externalId":$id,"title":"$title","createdDate":"2026-01-05","correspondentName":"Example Corp",
            "warrantyUntil":"2028-01-05","warrantyExtendedUntil":null}"""

    private fun contactSuggestion(
        id: Long,
        name: String,
    ) =
        """{"kind":"contact","provider":"paperless","correspondentId":$id,"name":"$name","documentCount":3,"externalSource":"document_correspondent","externalRef":"paperless:$id"}"""

    @Test
    fun adoptingAReceiptCreatesTheDeviceAndLinksIt() =
        runTest {
            server.on(
                "GET",
                "/api/v1/documents/suggestions",
                page(assetSuggestion(5, "Washer receipt"), contactSuggestion(9, "Ignored kind")),
            )
            server.on("POST", "/api/v1/assets", assetJson("a9", "Washer receipt"), HttpStatusCode.Created)
            server.on(
                "POST",
                "/api/v1/document-links",
                """{"id":"l9","provider":"paperless","externalId":5,"ownerType":"asset","ownerId":"a9","ownerTitle":null,"ownerUrl":null,"role":"receipt","label":null,"available":true,"document":null,"thumbUrl":null,"previewUrl":null,"downloadUrl":null,"createdBy":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}""",
                HttpStatusCode.Created,
            )
            val store = DocumentSuggestionsStore(app, SUGGESTION_ASSET)
            val state = store.await { !it.loading && it.visible.isNotEmpty() }
            assertEquals(listOf("asset:paperless:5"), state.visible.map { it.key })
            store.adopt("asset:paperless:5")
            val done = store.await { it.notice != null }
            assertTrue(done.visible.isEmpty())
            assertEquals("a9", done.createdLink?.id)
            val asset = server.requestsTo("POST", "/api/v1/assets").single().json
            assertEquals("device", asset["kind"]!!.jsonPrimitive.content)
            assertEquals("2026-01-05", asset["purchaseDate"]!!.jsonPrimitive.content)
            val link = server.requestsTo("POST", "/api/v1/document-links").single().json
            assertEquals("receipt", link["role"]!!.jsonPrimitive.content)
            assertEquals("a9", link["ownerId"]!!.jsonPrimitive.content)
            store.close()
        }

    @Test
    fun aFailedLinkTakesTheNewDeviceBack() =
        runTest {
            server.on("GET", "/api/v1/documents/suggestions", page(assetSuggestion(5, "Washer receipt")))
            server.on("POST", "/api/v1/assets", assetJson("a9", "Washer receipt"), HttpStatusCode.Created)
            server.onError("POST", "/api/v1/document-links", HttpStatusCode.NotFound, "not_found")
            server.on("DELETE", "/api/v1/assets/a9", "", HttpStatusCode.NoContent)
            val store = DocumentSuggestionsStore(app, SUGGESTION_ASSET)
            store.await { it.visible.isNotEmpty() }
            store.adopt("asset:paperless:5")
            val state = store.await { it.busyKey == null && it.rowErrors.isNotEmpty() }
            assertEquals(1, server.requestsTo("DELETE", "/api/v1/assets/a9").size)
            assertEquals(1, state.visible.size)
            store.close()
        }

    @Test
    fun contactsFromCorrespondentsCarryTheirOrigin() =
        runTest {
            server.on("GET", "/api/v1/documents/suggestions", page(contactSuggestion(9, "Example Utility")))
            server.on(
                "POST",
                "/api/v1/contacts",
                """{"id":"c9","kind":"other","name":"Example Utility","company":null,"phone":null,"email":null,"url":null,"address":null,"notes":null,
                    "emergency":false,"guestVisible":false,"sortOrder":0,"externalSource":"document_correspondent","externalRef":"paperless:9",
                    "createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}""",
                HttpStatusCode.Created,
            )
            val store = DocumentSuggestionsStore(app, SUGGESTION_CONTACT)
            store.await { it.visible.isNotEmpty() }
            store.adopt("contact:paperless:9")
            store.await { it.notice != null }
            val body = server.requestsTo("POST", "/api/v1/contacts").single().json
            assertEquals("paperless:9", body["externalRef"]!!.jsonPrimitive.content)
            assertEquals("document_correspondent", body["externalSource"]!!.jsonPrimitive.content)
            store.close()
        }

    @Test
    fun ignoredSuggestionsAreRememberedPerPerson() =
        runTest {
            server.on("GET", "/api/v1/documents/suggestions", page(contactSuggestion(9, "Example Utility"), contactSuggestion(10, "Other")))
            val store = DocumentSuggestionsStore(app, SUGGESTION_CONTACT)
            store.await { it.visible.size == 2 }
            store.dismiss("contact:paperless:9")
            val state = store.await { it.ignored.isNotEmpty() }
            assertEquals(listOf("contact:paperless:10"), state.visible.map { it.key })
            store.close()
            val again = DocumentSuggestionsStore(app, SUGGESTION_CONTACT)
            assertEquals(listOf("contact:paperless:9"), again.await { !it.loading && it.visible.isNotEmpty() }.ignored.map { it.key })
            again.restore("contact:paperless:9")
            assertEquals(2, again.await { it.ignored.isEmpty() }.visible.size)
            assertNull(again.value.error)
            assertNotNull(again.value)
            again.close()
        }
}
