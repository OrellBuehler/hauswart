package ch.orellbuehler.hauswart.feature.documentlinks

import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class LinkDocumentStoreTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private fun document(
        id: Long,
        title: String,
        linkedTo: String = "[]",
    ): String =
        """{"provider":"paperless","externalId":$id,"title":"$title","createdDate":"2026-02-01","correspondentId":null,"correspondentName":"Example Corp",
            "tagIds":[],"tagNames":["Invoice","Heating"],"mimeType":"application/pdf","pageCount":2,"noteCount":0,"warrantyUntil":null,
            "warrantyExtendedUntil":null,"linkedTo":$linkedTo,"thumbUrl":"/t","previewUrl":"/p","downloadUrl":"/d"}"""

    private fun linked(
        ownerType: String,
        ownerId: String,
        title: String?,
    ) =
        """{"linkId":"x","ownerType":"$ownerType","ownerId":"$ownerId","ownerTitle":${if (title == null) "null" else "\"$title\""},"ownerUrl":null,"role":"manual"}"""

    private fun page(
        vararg items: String,
        next: String? = null,
    ) = """{"items":[${items.joinToString(",")}],"nextCursor":${if (next == null) "null" else "\"$next\""}}"""

    @Test
    fun startsWithTheSyncedDocumentsAndTheRoleOfTheOwner() =
        runTest {
            server.on(
                "GET",
                "/api/v1/documents",
                page(
                    document(1, "Boiler invoice"),
                    document(2, "Manual", linked("asset", "a1", "Boiler").let { "[$it]" }),
                    document(
                        3,
                        "Other",
                        "[${linked("room", "r1", "Cellar")},${linked("task", "t1", null)},${linked("asset", "a9", "Washer")}]",
                    ),
                ),
            )
            val store = LinkDocumentStore(app, "asset", "a1")
            val state = store.await { !it.loading }
            assertEquals("manual", state.initial.role)
            assertEquals(listOf("1", "2", "3"), state.rows.map { it.id })
            assertEquals("Example Corp · 01.02.2026", state.rows[0].details)
            assertEquals("Invoice, Heating", state.rows[0].tags)
            assertEquals(listOf(false, true, false), state.rows.map { it.linkedHere })
            assertEquals("", state.rows[1].usedIn)
            assertEquals(tr("document_link_used_in", "places" to "Cellar, ${tr("document_owner_task")} +1"), state.rows[2].usedIn)
            assertEquals(
                "",
                server
                    .requestsTo("GET", "/api/v1/documents")
                    .single()
                    .query
                    .substringAfter("q=", "")
                    .substringBefore("&"),
            )
            store.close()
        }

    @Test
    fun theDefaultRoleDependsOnTheOwner() {
        val cases =
            listOf(
                "asset" to "manual",
                "part" to "datasheet",
                "defect" to "correspondence",
                "contact" to "correspondence",
                "service_log" to "invoice",
                "cost" to "invoice",
                "insurance_policy" to "policy",
                "room" to "other",
                "task" to "other",
            )
        cases.forEach { (owner, role) -> assertEquals(role, defaultDocumentRole(owner), owner) }
        assertTrue(DOCUMENT_LINK_ROLES.containsAll(cases.map { it.second }))
    }

    @Test
    fun typingSearchesTheProviderLive() =
        runTest {
            server.on("GET", "/api/v1/documents", page(document(1, "Boiler invoice")))
            val store = LinkDocumentStore(app, "asset", "a1")
            store.await { !it.loading }
            server.on("GET", "/api/v1/documents", page(document(5, "Tax return")))
            store.setQuery("tax")
            val state = store.await { !it.loading && it.rows.map { r -> r.id } == listOf("5") }
            assertEquals("tax", state.query)
            assertTrue("q=tax" in server.requests.last { it.path == "/api/v1/documents" }.query)
            store.close()
        }

    @Test
    fun aFailedSearchSetsTheErrorAndRetryRecovers() =
        runTest {
            server.onError("GET", "/api/v1/documents", HttpStatusCode.BadGateway, "upstream_error")
            val store = LinkDocumentStore(app, "asset", "a1")
            val failed = store.await { !it.loading }
            assertEquals(tr("m_error_upstream"), failed.error?.message)
            server.on("GET", "/api/v1/documents", page(document(1, "Boiler invoice")))
            store.retry()
            val state = store.await { !it.loading && it.error == null }
            assertEquals(1, state.rows.size)
            store.close()
        }

    @Test
    fun moreResultsAreAppended() =
        runTest {
            server.on("GET", "/api/v1/documents", page(document(1, "One"), next = "c2"))
            val store = LinkDocumentStore(app, "asset", "a1")
            val first = store.await { !it.loading }
            assertTrue(first.hasMore)
            server.on("GET", "/api/v1/documents", page(document(2, "Two")))
            store.loadMore()
            val state = store.await { it.rows.size == 2 && !it.loadingMore }
            assertEquals(listOf("1", "2"), state.rows.map { it.id })
            assertTrue(!state.hasMore)
            assertTrue("cursor=c2" in server.requests.last { it.path == "/api/v1/documents" }.query)
            store.close()
        }

    @Test
    fun linkingNeedsASelection() =
        runTest {
            server.on("GET", "/api/v1/documents", page(document(1, "One")))
            val store = LinkDocumentStore(app, "asset", "a1")
            store.await { !it.loading }
            store.submit(LinkDocumentForm("manual", ""))
            assertEquals(tr("document_link_choose"), store.value.submitError)
            assertTrue(server.requestsTo("POST", "/api/v1/document-links").isEmpty())
            store.close()
        }

    @Test
    fun linkingSendsTheChosenDocumentRoleAndLabel() =
        runTest {
            server.on("GET", "/api/v1/documents", page(document(1, "One"), document(2, "Two")))
            server.on(
                "POST",
                "/api/v1/document-links",
                """{"id":"l1","provider":"paperless","externalId":2,"ownerType":"asset","ownerId":"a1","ownerTitle":null,"ownerUrl":null,"role":"receipt",
                    "label":"Page 3","available":true,"document":null,"thumbUrl":null,"previewUrl":null,"downloadUrl":null,"createdBy":null,
                    "createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}""",
                HttpStatusCode.Created,
            )
            val store = LinkDocumentStore(app, "asset", "a1")
            store.await { !it.loading }
            store.select("2")
            assertEquals("Two", store.value.selectedTitle)
            store.submit(LinkDocumentForm("receipt", "  Page 3 "))
            store.await { it.linked == 1 }
            val body = server.requestsTo("POST", "/api/v1/document-links").single().json
            assertEquals("paperless", body.getValue("provider").jsonPrimitive.content)
            assertEquals("2", body.getValue("externalId").jsonPrimitive.content)
            assertEquals("asset", body.getValue("ownerType").jsonPrimitive.content)
            assertEquals("a1", body.getValue("ownerId").jsonPrimitive.content)
            assertEquals("receipt", body.getValue("role").jsonPrimitive.content)
            assertEquals("Page 3", body.getValue("label").jsonPrimitive.content)
            store.close()
        }

    @Test
    fun refusalsAreExplained() =
        runTest {
            server.on("GET", "/api/v1/documents", page(document(1, "One")))
            val store = LinkDocumentStore(app, "asset", "a1")
            store.await { !it.loading }
            store.select("1")
            server.onError("POST", "/api/v1/document-links", HttpStatusCode.Conflict, "conflict")
            store.submit(LinkDocumentForm("manual", ""))
            assertEquals(tr("document_link_taken"), store.await { it.submitError != null }.submitError)

            server.onError("POST", "/api/v1/document-links", HttpStatusCode.NotFound, "not_found")
            store.submit(LinkDocumentForm("manual", ""))
            assertEquals(tr("document_link_not_visible"), store.await { it.submitError == tr("document_link_not_visible") }.submitError)
            assertEquals(0, store.value.linked)
            assertNull(
                store.value.initial.label
                    .takeIf { it.isNotEmpty() },
            )
            store.close()
        }
}
