package ch.orellbuehler.hauswart.feature.tasks

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

class TasksListStoreTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private fun setup() {
        server.household()
        server.places()
        server.tasks(
            taskJson(
                "t1",
                "Clean filter",
                status = "overdue",
                dueDate = "2026-11-01",
                roomId = "r1",
                roomName = "Kitchen",
                assignee = "u1",
            ),
            taskJson("t2", "Water plants", status = "ok", dueDate = "2026-12-24", category = "plant", description = "Every Friday"),
            taskJson("t3", "Service car", status = "due", dueDate = "2026-11-20", trigger = ODOMETER, assetId = "a1", assetName = "Car"),
            taskJson("t4", "Paused", status = "snoozed", dueDate = null, snoozedUntil = "2099-01-01"),
        )
    }

    @Test
    fun groupsByStatusInTheWebOrder() =
        runTest {
            setup()
            val store = TasksListStore(app)
            val state = store.await { !it.loading }
            assertNull(state.error)
            assertEquals(listOf("overdue", "due", "ok", "snoozed"), state.groups.map { it.key })
            assertEquals(4, state.total)
            assertEquals(4, state.shown)
            assertEquals(
                "Kitchen",
                state.groups
                    .first()
                    .rows
                    .first()
                    .place,
            )
            assertEquals(
                "Anna",
                state.groups
                    .first()
                    .rows
                    .first()
                    .assigneeName,
            )
            assertTrue(
                state.groups
                    .flatMap { it.rows }
                    .first { it.id == "t3" }
                    .needsReading,
            )
            assertEquals(2, state.rooms.size)
            store.close()
        }

    @Test
    fun filtersNarrowTheRowsOnTheDevice() =
        runTest {
            setup()
            val store = TasksListStore(app)
            store.await { !it.loading }

            store.search("friday")
            assertEquals(
                listOf("t2"),
                store
                    .await { it.query == "friday" }
                    .groups
                    .flatMap { it.rows }
                    .map { it.id },
            )

            store.search("")
            store.setCategory("plant")
            assertEquals(
                listOf("t2"),
                store
                    .await { it.category == "plant" }
                    .groups
                    .flatMap { it.rows }
                    .map { it.id },
            )

            store.setCategory("")
            store.setMine(true)
            val mine = store.await { it.mine }
            assertEquals(listOf("t1"), mine.groups.flatMap { it.rows }.map { it.id })
            assertEquals(1, mine.filterCount)

            store.resetFilters()
            val due = store.setViewAndAwait()
            assertEquals(
                listOf("t1", "t3", "t2", "t4"),
                due.groups
                    .single()
                    .rows
                    .map { it.id },
            )
            store.close()
        }

    @Test
    fun aRowCarriesItsCommentCountAndTheNextAppointment() =
        runTest {
            server.household()
            server.places()
            server.tasks(
                taskJson(
                    "t1",
                    "Clean filter",
                    commentCount = 3,
                    nextAppointment = """{"id":"ap1","allDay":false,"startsAt":"2099-05-04T07:30:00.000Z","startDate":null}""",
                ),
                taskJson("t2", "Water plants"),
            )
            val store = TasksListStore(app)
            val rows = store.await { !it.loading }.groups.flatMap { it.rows }
            val busy = rows.first { it.id == "t1" }
            assertEquals(3, busy.commentCount)
            assertEquals("3 Kommentare", busy.commentsLabel)
            val chip = assertNotNull(busy.appointment)
            assertEquals("ap1", chip.id)
            assertTrue(chip.text.contains("04.05.2099"), chip.text)
            assertTrue(chip.text.endsWith("09:30"), chip.text)
            assertEquals("Termin: " + chip.text, chip.label)
            val quiet = rows.first { it.id == "t2" }
            assertEquals(0, quiet.commentCount)
            assertEquals("", quiet.commentsLabel)
            assertNull(quiet.appointment)
            store.close()
        }

    private suspend fun TasksListStore.setViewAndAwait(): TasksListState {
        setView(VIEW_DUE)
        return await { it.view == VIEW_DUE && !it.mine }
    }

    @Test
    fun archivedTasksAreAskedForOnTheServer() =
        runTest {
            setup()
            val store = TasksListStore(app)
            store.await { !it.loading }
            store.setArchived(true)
            store.await { it.archived }
            assertTrue(server.requests.any { it.path == "/api/v1/tasks" && it.query.contains("includeArchived=true") })
            store.close()
        }

    @Test
    fun aQuickCompletionSendsAKeyAndOffersUndo() =
        runTest {
            setup()
            server.on(
                "POST",
                "/api/v1/tasks/t2/complete",
                """{"completion":${completionJson("c1", "t2")},"task":${taskJson("t2", "Water plants")},"serviceLog":null}""",
                HttpStatusCode.Created,
            )
            server.on("DELETE", "/api/v1/completions/c1", "{}", HttpStatusCode.NoContent)
            val store = TasksListStore(app)
            store.await { !it.loading }
            store.complete("t2")
            val done = store.await { it.notice != null }
            assertEquals("Erledigt: «Water plants»", done.notice?.message)
            val body = server.requestsTo("POST", "/api/v1/tasks/t2/complete").single().json
            assertTrue(body["idempotencyKey"]!!.jsonPrimitive.content.length >= 8)
            val undo = assertNotNull(done.notice?.undo)
            assertEquals("c1", undo.completionId)
            store.undo(undo)
            store.await { it.notice?.undo == null && it.notice != null }
            assertEquals(1, server.requestsTo("DELETE", "/api/v1/completions/c1").size)
            store.close()
        }

    @Test
    fun aFailedQuickCompletionShowsTheError() =
        runTest {
            setup()
            server.onError("POST", "/api/v1/tasks/t2/complete", HttpStatusCode.InternalServerError, "internal_error")
            val store = TasksListStore(app)
            store.await { !it.loading }
            store.complete("t2")
            val state = store.await { it.actionError != null }
            assertNull(state.busyId)
            assertNull(state.notice)
            store.close()
        }

    @Test
    fun unsnoozeSendsANullDateAndRemembersTheOldOne() =
        runTest {
            setup()
            server.on("POST", "/api/v1/tasks/t4/snooze", taskJson("t4", "Paused"))
            val store = TasksListStore(app)
            store.await { !it.loading }
            store.unsnooze("t4")
            val state = store.await { it.notice != null }
            assertEquals("2099-01-01", state.notice?.undo?.previous)
            assertEquals(
                "null",
                server
                    .requestsTo("POST", "/api/v1/tasks/t4/snooze")
                    .single()
                    .json["until"]
                    .toString(),
            )
            store.close()
        }

    @Test
    fun aFailedLoadSetsTheError() =
        runTest {
            server.household()
            server.onError("GET", "/api/v1/tasks", HttpStatusCode.InternalServerError, "internal_error")
            val store = TasksListStore(app)
            val state = store.await { !it.loading }
            assertNotNull(state.error)
            store.close()
        }
}
