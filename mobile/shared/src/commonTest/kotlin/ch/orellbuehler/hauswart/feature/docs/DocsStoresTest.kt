package ch.orellbuehler.hauswart.feature.docs

import ch.orellbuehler.hauswart.feature.inventory.assetJson
import ch.orellbuehler.hauswart.feature.inventory.json
import ch.orellbuehler.hauswart.feature.inventory.page
import ch.orellbuehler.hauswart.feature.inventory.roomJson
import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DocsStoresTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private fun summary(
        slug: String,
        title: String,
        section: String = "general",
        pinned: Boolean = false,
        archived: Boolean = false,
        assetId: String? = null,
        roomId: String? = null,
    ) = """"id":"p-$slug","slug":"$slug","title":"$title","section":"$section","assetId":${assetId.json()},"roomId":${roomId.json()},
        "sortOrder":0,"guestVisible":false,"pinned":$pinned,"rev":3,"excerpt":"About $title","commentCount":2,"updatedBy":null,
        "updatedByName":"Anna","archivedAt":${if (archived) "\"2026-02-01T00:00:00.000Z\"" else "null"},
        "createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-03-01T10:00:00.000Z""""

    private fun pageJson(
        slug: String,
        title: String = "Boiler",
        body: String = "# Boiler",
        html: String = "<h1 id=\"h-boiler\">Boiler</h1>",
        assetId: String? = null,
        rev: Int = 3,
    ) = "{" + summary(slug, title, assetId = assetId).replace("\"rev\":3", "\"rev\":$rev") +
        ""","bodyMd":${body.replace("\n", "\\n").let { "\"$it\"" }},"renderedHtml":${html.replace("\"", "\\\"").let { "\"$it\"" }},
        "headings":[],"backlinks":[{"id":"p-x","slug":"heating","title":"Heating"}]}"""

    private fun places() {
        server.household()
        server.on("GET", "/api/v1/assets", page(assetJson("a1", "Boiler")))
        server.on("GET", "/api/v1/rooms", page(roomJson("r1", "Cellar")))
    }

    @Test
    fun listGroupsPinnedFirstThenBySection() =
        runTest {
            places()
            server.on(
                "GET",
                "/api/v1/pages",
                page(
                    "{" + summary("boiler", "Boiler", section = "device", assetId = "a1") + "}",
                    "{" + summary("rules", "House rules", section = "rules", pinned = true) + "}",
                    "{" + summary("water", "Water", section = "emergency", roomId = "r1") + "}",
                ),
            )
            val store = DocsListStore(app)
            val state = store.await { !it.loading }
            assertEquals(listOf("pinned", "device", "emergency"), state.groups.map { it.key })
            assertEquals(
                "Boiler",
                state.groups[1]
                    .rows
                    .single()
                    .places,
            )
            assertEquals(
                "Cellar",
                state.groups[2]
                    .rows
                    .single()
                    .places,
            )
            assertEquals(
                "01.03.2026",
                state.groups[0]
                    .rows
                    .single()
                    .updated,
            )
            assertEquals(3, state.shown)
            store.close()
        }

    @Test
    fun searchingAsksTheServerAndShowsOneFlatList() =
        runTest {
            places()
            server.on("GET", "/api/v1/pages", page("{" + summary("boiler", "Boiler", pinned = true) + "}"))
            val store = DocsListStore(app)
            store.await { !it.loading }
            store.search("boil")
            val state = store.await { it.query == "boil" && it.groups.singleOrNull()?.key == "results" }
            assertTrue(state.searching)
            assertTrue(server.requests.any { it.path == "/api/v1/pages" && "q=boil" in it.query })
            store.setSection("rules")
            store.await { it.section == "rules" && !it.loading }
            assertTrue(server.requests.any { it.path == "/api/v1/pages" && "section=rules" in it.query })
            store.close()
        }

    @Test
    fun aFailedListSetsTheError() =
        runTest {
            places()
            server.onError("GET", "/api/v1/pages", HttpStatusCode.InternalServerError, "internal_error")
            val store = DocsListStore(app)
            val state = store.await { !it.loading }
            assertEquals(tr("m_error_server"), state.error?.message)
            store.close()
        }

    @Test
    fun aPageShowsItsHeadBodyAndBacklinks() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/pages/boiler", pageJson("boiler", assetId = "a1"))
            server.on("GET", "/api/v1/assets/a1", assetJson("a1", "Boiler <1>"))
            val store = DocViewStore(app, "boiler")
            val state = store.await { it.pageId.isNotEmpty() }
            assertTrue("<h1>Boiler</h1>" in state.bodyHtml)
            assertTrue("href=\"/assets/a1\"" in state.bodyHtml)
            assertTrue("Boiler &lt;1&gt;" in state.bodyHtml)
            assertTrue("href=\"/docs/heating\"" in state.bodyHtml)
            assertTrue("<h1 id=\"h-boiler\">" in state.bodyHtml)
            assertTrue(tr("docs_section_general") in state.bodyHtml)
            store.close()
        }

    @Test
    fun aMissingPageOffersACreateTitle() =
        runTest {
            server.household()
            val store = DocViewStore(app, "water-main-shutoff")
            val state = store.await { it.missing }
            assertEquals("Water main shutoff", state.suggestedTitle)
            assertTrue(state.pageId.isEmpty())
            store.close()
        }

    @Test
    fun imagesOfAPageComeAsDataAddresses() =
        runTest {
            server.household()
            val html = """<p><img src="/api/v1/attachments/img1/content" alt="x"><img src="/api/v1/attachments/img2/content" alt="y"></p>"""
            server.on("GET", "/api/v1/pages/boiler", pageJson("boiler", html = html))
            server.on("GET", "/api/v1/attachments/img1/content", "PNGDATA")
            val store = DocViewStore(app, "boiler")
            val state = store.await { it.pageId.isNotEmpty() }
            assertFalse("/api/v1/attachments/img1/content" in state.bodyHtml)
            assertTrue("src=\"data:application/json;base64," in state.bodyHtml || "src=\"\"" in state.bodyHtml)
            assertTrue("src=\"\"" in state.bodyHtml, "the image that could not be fetched keeps no source")
            store.close()
        }

    @Test
    fun pinningSendsTheRevisionAndReportsTheChange() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/pages/boiler", pageJson("boiler"))
            server.on("PATCH", "/api/v1/pages/boiler", pageJson("boiler", rev = 4))
            val store = DocViewStore(app, "boiler")
            store.await { it.pageId.isNotEmpty() }
            store.togglePin()
            val state = store.await { it.notice != null }
            assertEquals(tr("docs_pinned_toast"), state.notice)
            val body = server.requestsTo("PATCH", "/api/v1/pages/boiler").single().json
            assertEquals(3, body["rev"]!!.jsonPrimitive.content.toInt())
            assertTrue(body["pinned"]!!.jsonPrimitive.boolean)
            store.close()
        }

    @Test
    fun deletingClosesThePage() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/pages/boiler", pageJson("boiler"))
            server.on("DELETE", "/api/v1/pages/boiler", "", HttpStatusCode.NoContent)
            val store = DocViewStore(app, "boiler")
            store.await { it.pageId.isNotEmpty() }
            store.delete()
            assertTrue(store.await { it.deleted }.deleted)
            store.close()
        }

    private fun editStore(slug: String?) = DocEditStore(app, slug, "rules", "a1", "", "Seed title")

    @Test
    fun aNewPageStartsFromTheDefaultsAndIsCreated() =
        runTest {
            places()
            server.on("POST", "/api/v1/pages", pageJson("seed-title", "Seed title"), HttpStatusCode.Created)
            val store = editStore(null)
            val state = store.await { !it.loading }
            val form = state.initial!!
            assertEquals(DocForm("Seed title", "rules", "a1", "", false, false, ""), form)
            assertEquals(listOf("Boiler"), state.assets.map { it.label })
            store.save(form.copy(title = "  Seed title  ", body = "Hello", pinned = true))
            assertEquals("seed-title", store.await { it.savedSlug != null }.savedSlug)
            val body = server.requestsTo("POST", "/api/v1/pages").single().json
            assertEquals("Seed title", body["title"]!!.jsonPrimitive.content)
            assertEquals("rules", body["section"]!!.jsonPrimitive.content)
            assertEquals("a1", body["assetId"]!!.jsonPrimitive.content)
            assertEquals("Hello", body["bodyMd"]!!.jsonPrimitive.content)
            assertNull(body["roomId"])
            store.close()
        }

    @Test
    fun aBlankTitleOrAHugeTextIsRefusedBeforeSending() =
        runTest {
            places()
            val store = editStore(null)
            val form = store.await { !it.loading }.initial!!
            store.save(form.copy(title = " "))
            assertEquals(tr("docs_error_title_required"), store.await { it.fieldErrors.isNotEmpty() }.fieldErrors["title"])
            store.save(form.copy(body = "x".repeat(DOC_BODY_MAX_BYTES + 1)))
            assertEquals(tr("docs_error_too_large"), store.await { "bodyMd" in it.fieldErrors }.fieldErrors["bodyMd"])
            assertTrue(server.requestsTo("POST", "/api/v1/pages").isEmpty())
            store.close()
        }

    @Test
    fun anEditSendsOnlyWhatChanged() =
        runTest {
            places()
            server.on("GET", "/api/v1/pages/boiler", pageJson("boiler", assetId = "a1"))
            server.on("PATCH", "/api/v1/pages/boiler", pageJson("boiler", rev = 4))
            val store = editStore("boiler")
            val form = store.await { !it.loading }.initial!!
            assertEquals("a1", form.assetId)
            store.save(form.copy(body = "Changed", assetId = ""))
            store.await { it.savedSlug != null }
            val body = server.requestsTo("PATCH", "/api/v1/pages/boiler").single().json
            assertEquals(3, body["rev"]!!.jsonPrimitive.content.toInt())
            assertEquals("Changed", body["bodyMd"]!!.jsonPrimitive.content)
            assertEquals(JsonNull, body["assetId"])
            assertNull(body["title"])
            assertNull(body["pinned"])
            store.close()
        }

    @Test
    fun savingWithoutChangesSendsNothing() =
        runTest {
            places()
            server.on("GET", "/api/v1/pages/boiler", pageJson("boiler"))
            val store = editStore("boiler")
            val form = store.await { !it.loading }.initial!!
            store.save(form)
            assertEquals("boiler", store.await { it.savedSlug != null }.savedSlug)
            assertTrue(server.requestsTo("PATCH", "/api/v1/pages/boiler").isEmpty())
            store.close()
        }

    @Test
    fun aConflictAsksWhatToDoAndKeepMineSavesOverTheNewerVersion() =
        runTest {
            places()
            server.on("GET", "/api/v1/pages/boiler", pageJson("boiler"))
            server.onError("PATCH", "/api/v1/pages/boiler", HttpStatusCode.Conflict, "conflict", details = """{"currentRev":5}""")
            val store = editStore("boiler")
            val form = store.await { !it.loading }.initial!!
            store.save(form.copy(body = "Mine"))
            val state = store.await { it.conflict }
            assertEquals(tr("editor_conflict_description", "theirs" to 5, "mine" to 3), state.conflictMessage)

            server.on("PATCH", "/api/v1/pages/boiler", pageJson("boiler", rev = 6))
            store.keepMine(form.copy(body = "Mine"))
            store.await { it.savedSlug != null }
            val sent = server.requestsTo("PATCH", "/api/v1/pages/boiler").last().json
            assertEquals(5, sent["rev"]!!.jsonPrimitive.content.toInt())
            store.close()
        }

    @Test
    fun reloadingTheirsReplacesTheForm() =
        runTest {
            places()
            server.on("GET", "/api/v1/pages/boiler", pageJson("boiler", body = "Old"))
            server.onError("PATCH", "/api/v1/pages/boiler", HttpStatusCode.Conflict, "conflict")
            val store = editStore("boiler")
            val form = store.await { !it.loading }.initial!!
            val version = store.value.initialVersion
            store.save(form.copy(body = "Mine"))
            assertEquals(tr("editor_conflict_description_unknown", "mine" to 3), store.await { it.conflict }.conflictMessage)
            server.on("GET", "/api/v1/pages/boiler", pageJson("boiler", body = "Theirs", rev = 7))
            store.reloadTheirs()
            val state = store.await { !it.conflict && !it.resolving }
            assertEquals("Theirs", state.initial?.body)
            assertEquals(version + 1, state.initialVersion)
            store.close()
        }

    @Test
    fun previewRendersOnTheServer() =
        runTest {
            places()
            server.on("POST", "/api/v1/pages/preview", """{"html":"<p>Hi</p>","headings":[]}""")
            val store = editStore(null)
            store.await { !it.loading }
            store.preview("Hi")
            assertEquals("<p>Hi</p>", store.await { it.previewHtml.isNotEmpty() }.previewHtml)
            store.close()
        }

    @Test
    fun aTooLargeTextOnTheServerIsExplained() =
        runTest {
            places()
            server.onError("POST", "/api/v1/pages", HttpStatusCode.BadRequest, "invalid_request", details = """{"code":"too_large"}""")
            val store = editStore(null)
            val form = store.await { !it.loading }.initial!!
            store.save(form)
            assertEquals(tr("docs_error_too_large"), store.await { it.error != null }.error?.message)
            store.close()
        }

    @Test
    fun revisionsListAndRestore() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/pages/boiler", pageJson("boiler"))
            server.on(
                "GET",
                "/api/v1/pages/boiler/revisions",
                """{"items":[{"rev":3,"title":"Boiler","size":2048,"userId":null,"userName":"Anna","createdAt":"2026-03-01T10:00:00.000Z"},
                    {"rev":2,"title":"Old","size":10,"userId":null,"userName":null,"createdAt":"2026-02-01T10:00:00.000Z"}]}""",
            )
            server.on(
                "GET",
                "/api/v1/pages/boiler/revisions/2",
                """{"rev":2,"title":"Old","size":10,"userId":null,"userName":null,"createdAt":"2026-02-01T10:00:00.000Z","bodyMd":"old text"}""",
            )
            server.on("POST", "/api/v1/pages/boiler/revisions/2/restore", pageJson("boiler", rev = 4))
            val store = DocRevisionsStore(app, "boiler")
            val state = store.await { !it.loading }
            assertEquals(listOf(true, false), state.rows.map { it.current })
            assertTrue("Anna" in state.rows[0].details && "2 KB" in state.rows[0].details)
            assertEquals(tr("docs_unknown_user"), state.rows[1].details.substringBefore(" · "))
            store.open(2)
            val opened = store.await { it.opened != null }.opened!!
            assertEquals("old text", opened.markdown)
            assertFalse(opened.current)
            store.restore(2)
            val done = store.await { it.restored }
            assertEquals(tr("docs_restored_toast", "rev" to 2), done.notice)
            assertNotNull(server.requestsTo("POST", "/api/v1/pages/boiler/revisions/2/restore").singleOrNull())
            store.close()
        }

    @Test
    fun attachmentMarkdownEmbedsImagesAndLinksFiles() {
        assertEquals("![Oven](attachment:a1)", docAttachmentMarkdown("a1", "Oven.jpg", "", true))
        assertEquals("![${tr("editor_alt_default")}](attachment:a2)", docAttachmentMarkdown("a2", "image3.png", "", true))
        assertEquals("![Back](attachment:a3)", docAttachmentMarkdown("a3", "x.jpg", "Back", true))
        assertEquals("[plan.pdf](attachment:a4)", docAttachmentMarkdown("a4", "plan.pdf", "", false))
    }
}
