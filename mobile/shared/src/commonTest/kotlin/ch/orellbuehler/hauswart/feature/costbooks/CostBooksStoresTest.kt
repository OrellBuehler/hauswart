package ch.orellbuehler.hauswart.feature.costbooks

import ch.orellbuehler.hauswart.feature.costs.page
import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CostBooksStoresTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private fun book(
        id: String,
        name: String,
        sort: Int,
        isDefault: Boolean = false,
        archived: Boolean = false,
        icon: String? = null,
    ) =
        """{"id":"$id","name":"$name","slug":"$id","icon":${if (icon == null) "null" else "\"$icon\""},"defaultSplitMode":"equal","taxRelevant":false,
        "archivedAt":${if (archived) "\"2026-01-01T00:00:00.000Z\"" else "null"},"sortOrder":$sort,"isDefault":$isDefault,"entryCount":4,"settlementCount":1,
        "createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}"""

    private fun listBooks() =
        server.on(
            "GET",
            "/api/v1/cost-books",
            page(book("b1", "Wohnung", 0, isDefault = true), book("b2", "Auto", 1), book("b3", "Alt", 2, archived = true)),
        )

    @Test
    fun openAndArchivedBooksAreApart() =
        runTest {
            listBooks()
            val store = CostBooksStore(app)
            val state = store.await { !it.loading }
            assertEquals(listOf("b1", "b2"), state.open.map { it.id })
            assertEquals(listOf("b3"), state.archived.map { it.id })
            assertTrue(state.open.first().isDefault)
            assertEquals(false, state.open.first().canMoveUp)
            assertEquals(true, state.open.first().canMoveDown)
            assertEquals(true, state.open.last().canMakeDefault)
            store.close()
        }

    @Test
    fun movingRenumbersTheOpenBooks() =
        runTest {
            listBooks()
            server.on("PATCH", "/api/v1/cost-books/b1", book("b1", "Wohnung", 1))
            server.on("PATCH", "/api/v1/cost-books/b2", book("b2", "Auto", 0))
            val store = CostBooksStore(app)
            store.await { !it.loading }
            store.move("b2", -1)
            store.await { server.requestsTo("PATCH", "/api/v1/cost-books/b1").isNotEmpty() && it.busyId == null }
            assertEquals(
                "0",
                server
                    .requestsTo("PATCH", "/api/v1/cost-books/b2")
                    .single()
                    .json
                    .getValue("sortOrder")
                    .jsonPrimitive.content,
            )
            assertEquals(
                "1",
                server
                    .requestsTo("PATCH", "/api/v1/cost-books/b1")
                    .single()
                    .json
                    .getValue("sortOrder")
                    .jsonPrimitive.content,
            )
            store.close()
        }

    @Test
    fun deletingABookInUseExplainsWhatItHolds() =
        runTest {
            listBooks()
            server.onError(
                "DELETE",
                "/api/v1/cost-books/b1",
                HttpStatusCode.Conflict,
                "conflict",
                details = """{"entryCount":4,"settlementCount":1}""",
            )
            val store = CostBooksStore(app)
            store.await { !it.loading }
            store.delete("b1")
            val state = store.await { it.actionError != null }
            assertTrue(
                state.actionError
                    ?.message
                    .orEmpty()
                    .contains("Wohnung"),
            )
            assertTrue(
                state.actionError
                    ?.message
                    .orEmpty()
                    .contains(tr("costbook_entry_count", "count" to 4)),
            )
            store.close()
        }

    @Test
    fun theLastBookCannotBeArchived() =
        runTest {
            listBooks()
            server.onError("PATCH", "/api/v1/cost-books/b2", HttpStatusCode.Conflict, "conflict")
            val store = CostBooksStore(app)
            store.await { !it.loading }
            store.archive("b2")
            assertEquals(tr("costbook_error_last"), store.await { it.actionError != null }.actionError?.message)
            store.close()
        }

    @Test
    fun makingADefaultSendsIsDefault() =
        runTest {
            listBooks()
            server.on("PATCH", "/api/v1/cost-books/b2", book("b2", "Auto", 1, isDefault = true))
            val store = CostBooksStore(app)
            store.await { !it.loading }
            store.makeDefault("b2")
            store.await { it.notice != null }
            assertEquals(
                "true",
                server
                    .requestsTo("PATCH", "/api/v1/cost-books/b2")
                    .single()
                    .json
                    .getValue("isDefault")
                    .jsonPrimitive.content,
            )
            store.close()
        }

    @Test
    fun creatingABookTrimsTheNameAndMapsADuplicate() =
        runTest {
            server.on("POST", "/api/v1/cost-books", book("n1", "Ferien", 3), HttpStatusCode.Created)
            val store = BookEditStore(app, null)
            store.save(BookForm(name = "  ", defaultSplitMode = "equal"))
            assertEquals(tr("m_field_required"), store.await { it.fieldErrors.isNotEmpty() }.fieldErrors["name"])
            store.save(BookForm(name = " Ferien ", icon = "plane", defaultSplitMode = "equal", taxRelevant = true))
            assertEquals("n1", store.await { it.savedId != null }.savedId)
            val body = server.requestsTo("POST", "/api/v1/cost-books").single().json
            assertEquals("Ferien", body.getValue("name").jsonPrimitive.content)
            assertEquals("plane", body.getValue("icon").jsonPrimitive.content)
            store.close()

            server.onError("POST", "/api/v1/cost-books", HttpStatusCode.Conflict, "conflict")
            val again = BookEditStore(app, null)
            again.save(BookForm(name = "Ferien"))
            assertEquals(tr("costbook_error_name_taken"), again.await { !it.saving && it.fieldErrors.isNotEmpty() }.fieldErrors["name"])
            again.close()
        }

    @Test
    fun editingClearsTheIconWithNull() =
        runTest {
            server.on("GET", "/api/v1/cost-books/b1", book("b1", "Wohnung", 0, icon = "house"))
            server.on("PATCH", "/api/v1/cost-books/b1", book("b1", "Wohnung", 0))
            val store = BookEditStore(app, "b1")
            val form = assertNotNull(store.await { it.initial != null && !it.loading }.initial)
            assertEquals("house", form.icon)
            store.save(form.copy(icon = ""))
            store.await { it.savedId != null }
            val body = server.requestsTo("PATCH", "/api/v1/cost-books/b1").single().json
            assertEquals(JsonNull, body["icon"])
            assertNull(body["name"])
            store.close()
        }

    private fun tag(
        id: String,
        name: String,
        color: String = "blue",
        count: Int = 2,
    ) =
        """{"id":"$id","name":"$name","color":"$color","entryCount":$count,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}"""

    @Test
    fun tagsListWithCountsAndDeleteSaysWhatStays() =
        runTest {
            server.on("GET", "/api/v1/cost-tags", """{"items":[${tag("t1", "Ferien")},${tag("t2", "Leer", count = 0)}]}""")
            server.on("DELETE", "/api/v1/cost-tags/t1", "", HttpStatusCode.NoContent)
            val store = CostTagsStore(app)
            val state = store.await { !it.loading }
            assertEquals(2, state.rows.size)
            assertEquals(tr("costtag_delete_description", "name" to "Ferien", "count" to 2), store.deleteText("t1"))
            assertEquals(tr("costtag_delete_description_unused", "name" to "Leer"), store.deleteText("t2"))
            store.delete("t1")
            assertNotNull(store.await { it.notice != null }.notice)
            store.close()
        }

    @Test
    fun aTagNameThatExistsIsRefusedLocallyEvenInAnotherCase() =
        runTest {
            server.on("GET", "/api/v1/cost-tags", """{"items":[${tag("t1", "Ferien")}]}""")
            val store = TagEditStore(app, null)
            val form = assertNotNull(store.await { it.initial != null }.initial)
            assertNotEquals("gray", form.color)
            store.save(form.copy(name = "ferien"))
            assertEquals(tr("costtag_error_name_taken"), store.await { it.fieldErrors.isNotEmpty() }.fieldErrors["name"])
            assertTrue(server.requestsTo("POST", "/api/v1/cost-tags").isEmpty())
            store.close()
        }

    @Test
    fun renamingSendsOnlyTheName() =
        runTest {
            server.on("GET", "/api/v1/cost-tags", """{"items":[${tag("t1", "Ferien")}]}""")
            server.on("PATCH", "/api/v1/cost-tags/t1", tag("t1", "Urlaub"))
            val store = TagEditStore(app, "t1")
            val form = assertNotNull(store.await { it.initial != null }.initial)
            store.save(form.copy(name = "Urlaub"))
            store.await { it.savedId != null }
            val body = server.requestsTo("PATCH", "/api/v1/cost-tags/t1").single().json
            assertEquals("Urlaub", body.getValue("name").jsonPrimitive.content)
            assertNull(body["color"])
            store.close()
        }
}
