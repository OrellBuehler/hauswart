package ch.orellbuehler.hauswart.feature.comments

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

class CommentsStoreTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private fun comment(
        id: String,
        body: String,
        author: String? = "Anna",
        mine: Boolean = true,
        deleted: Boolean = false,
        edited: Boolean = false,
    ): String =
        """{"id":"$id","entityType":"task","entityId":"t1",
            "author":${if (author == null) "null" else """{"id":"u1","displayName":"$author"}"""},
            "bodyMd":"$body","createdAt":"2026-01-01T10:00:00.000Z","editedAt":${if (edited) "\"2026-01-01T11:00:00.000Z\"" else "null"},
            "deleted":$deleted,"canEdit":$mine,"canDelete":$mine}"""

    private fun page(vararg items: String) = """{"items":[${items.joinToString(",")}],"nextCursor":null}"""

    private fun store(): CommentsStore {
        server.household()
        return CommentsStore(app, "task", "t1")
    }

    @Test
    fun loadsTheThreadOldestFirstWithItsLabels() =
        runTest {
            server.on(
                "GET",
                "/api/v1/comments",
                page(comment("c1", "Filter is changed", edited = true), comment("c2", "gone", author = null, mine = false, deleted = true)),
            )
            val store = store()
            val state = store.await { !it.loading }
            assertNull(state.error)
            assertEquals(listOf("c1", "c2"), state.rows.map { it.id })
            assertEquals(1, state.count)
            assertEquals("Anna", state.rows[0].author)
            assertTrue(state.rows[0].edited)
            assertTrue(state.rows[0].canEdit)
            assertEquals(tr("comments_unknown_author"), state.rows[1].author)
            assertTrue(state.rows[1].deleted)
            assertTrue(state.rows[1].segments.isEmpty())
            val query = server.requests.first { it.path == "/api/v1/comments" }.query
            assertTrue("entityType=task" in query && "entityId=t1" in query)
            store.close()
        }

    @Test
    fun aFailedLoadSetsTheError() =
        runTest {
            server.onError("GET", "/api/v1/comments", HttpStatusCode.InternalServerError, "internal_error")
            val store = store()
            val state = store.await { !it.loading }
            assertEquals(tr("m_error_server"), state.error?.message)
            assertTrue(state.rows.isEmpty())
            store.close()
        }

    @Test
    fun addingSendsTheTrimmedTextAndAppendsTheComment() =
        runTest {
            server.on("GET", "/api/v1/comments", page(comment("c1", "First")))
            val store = store()
            store.await { !it.loading }
            server.on("GET", "/api/v1/comments", page(comment("c1", "First"), comment("c2", "Second")))
            server.on("POST", "/api/v1/comments", comment("c2", "Second"), HttpStatusCode.Created)

            store.add("  Second \n")
            val state = store.await { it.added == 1 && it.rows.size == 2 }
            assertEquals(listOf("c1", "c2"), state.rows.map { it.id })
            val body = server.requestsTo("POST", "/api/v1/comments").single().json
            assertEquals("task", body.getValue("entityType").jsonPrimitive.content)
            assertEquals("t1", body.getValue("entityId").jsonPrimitive.content)
            assertEquals("Second", body.getValue("bodyMd").jsonPrimitive.content)
            store.close()
        }

    @Test
    fun blankTextAsksNoServer() =
        runTest {
            server.on("GET", "/api/v1/comments", page())
            val store = store()
            store.await { !it.loading }
            store.add("   ")
            assertTrue(server.requestsTo("POST", "/api/v1/comments").isEmpty())
            assertEquals(0, store.value.added)
            store.close()
        }

    @Test
    fun aTooLongTextIsRefusedBeforeSending() =
        runTest {
            server.on("GET", "/api/v1/comments", page())
            val store = store()
            store.await { !it.loading }
            store.add("x".repeat(COMMENT_MAX_LENGTH + 1))
            val state = store.await { it.addError != null }
            assertTrue(server.requestsTo("POST", "/api/v1/comments").isEmpty())
            assertEquals(tr("field_too_long", "max" to COMMENT_MAX_LENGTH), state.addError?.message)
            store.close()
        }

    @Test
    fun aFailedAddKeepsTheErrorAndTheThread() =
        runTest {
            server.on("GET", "/api/v1/comments", page(comment("c1", "First")))
            server.onError("POST", "/api/v1/comments", HttpStatusCode.Forbidden, "forbidden")
            val store = store()
            store.await { !it.loading }
            store.add("Second")
            val state = store.await { it.addError != null }
            assertEquals(tr("m_error_forbidden"), state.addError?.message)
            assertEquals(false, state.adding)
            assertEquals(0, state.added)
            assertEquals(1, state.rows.size)
            store.close()
        }

    @Test
    fun editingSavesTheNewTextAndReplacesTheRow() =
        runTest {
            server.on("GET", "/api/v1/comments", page(comment("c1", "First")))
            val store = store()
            store.await { !it.loading }
            server.on("GET", "/api/v1/comments", page(comment("c1", "Better", edited = true)))
            server.on("PATCH", "/api/v1/comments/c1", comment("c1", "Better", edited = true))

            store.edit("c1", " Better ")
            val state = store.await { it.edited == 1 && it.rows.first().body == "Better" }
            assertTrue(state.rows.first().edited)
            assertEquals(
                "Better",
                server
                    .requestsTo("PATCH", "/api/v1/comments/c1")
                    .single()
                    .json
                    .getValue("bodyMd")
                    .jsonPrimitive.content,
            )
            store.close()
        }

    @Test
    fun editingToTheSameTextJustFinishes() =
        runTest {
            server.on("GET", "/api/v1/comments", page(comment("c1", "First")))
            val store = store()
            store.await { !it.loading }
            store.edit("c1", "First ")
            assertEquals(1, store.value.edited)
            assertTrue(server.requestsTo("PATCH", "/api/v1/comments/c1").isEmpty())
            store.close()
        }

    @Test
    fun aRefusedEditKeepsTheEditorOpen() =
        runTest {
            server.on("GET", "/api/v1/comments", page(comment("c1", "First", mine = false)))
            server.onError("PATCH", "/api/v1/comments/c1", HttpStatusCode.Forbidden, "forbidden")
            val store = store()
            store.await { !it.loading }
            store.edit("c1", "Other")
            val state = store.await { it.editError != null }
            assertEquals(tr("m_error_forbidden"), state.editError?.message)
            assertEquals(0, state.edited)
            assertNull(state.savingId)
            store.close()
        }

    @Test
    fun deletingLeavesAPlaceholderInTheThread() =
        runTest {
            server.on("GET", "/api/v1/comments", page(comment("c1", "First")))
            val store = store()
            store.await { !it.loading }
            server.on("GET", "/api/v1/comments", page(comment("c1", "", deleted = true)))
            server.on("DELETE", "/api/v1/comments/c1", "", HttpStatusCode.NoContent)

            store.delete("c1")
            val state = store.await { it.rows.firstOrNull()?.deleted == true && it.deletingId == null }
            assertEquals(0, state.count)
            assertEquals("", state.rows.first().body)
            store.close()
        }

    @Test
    fun aFailedDeleteReportsAndKeepsTheComment() =
        runTest {
            server.on("GET", "/api/v1/comments", page(comment("c1", "First")))
            server.onError("DELETE", "/api/v1/comments/c1", HttpStatusCode.Forbidden, "forbidden")
            val store = store()
            store.await { !it.loading }
            store.delete("c1")
            val state = store.await { it.actionError != null }
            assertNotNull(state.actionError)
            assertEquals(false, state.rows.first().deleted)
            store.dismissActionError()
            assertNull(store.value.actionError)
            store.close()
        }
}
