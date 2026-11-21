package ch.orellbuehler.hauswart.feature.tasks

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

class TaskDetailStoreTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private val prep1 =
        """{"id":"p1","taskId":"t1","title":"Order filter","kind":"order_part","leadDays":14,"leadValue":null,"partId":null,"qty":1,"sortOrder":0,"state":"now"}"""
    private val prep =
        """[$prep1,
            {"id":"p2","taskId":"t1","title":"Clear shelf","kind":"generic","leadDays":null,"leadValue":null,"partId":null,"qty":1,"sortOrder":1,"state":"done"}]"""

    private val partLink =
        """{"taskId":"t1","partId":"pt1","qty":2,"part":{"id":"pt1","name":"Filter G4","partNumber":null,"supplier":null,"shopUrl":null,"unitPriceMinor":null,
            "currency":"CHF","stockCount":1,"minStock":2,"reorderQty":1,"leadTimeDays":3,"orderedAt":null,"orderedQty":0,"lowStock":true,"notes":null,
            "archivedAt":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}}"""

    private fun setup(task: String = taskJson("t1", "Clean filter", roomName = "Kitchen", assetName = "Vent")) {
        server.household()
        server.on("GET", "/api/v1/tasks/t1", detailJson(task, prep))
        server.on("GET", "/api/v1/completions", page(completionJson("c1"), completionJson("c2", kind = "skipped")))
        server.on("GET", "/api/v1/tasks/t1/parts", page(partLink))
    }

    @Test
    fun loadsTheTaskWithItsScheduleHistoryAndParts() =
        runTest {
            setup()
            val store = TaskDetailStore(app, "t1")
            val view = assertNotNull(store.await { !it.loading }.view)
            assertEquals("Fällig", view.statusLabel)
            assertEquals("Alle 3 Monate ab letzter Erledigung", view.triggerSummary)
            assertEquals("Kitchen · Vent", view.place)
            assertEquals(listOf("p1", "p2"), view.preparations.map { it.id })
            assertTrue(view.preparations[0].open)
            assertFalse(view.preparations[1].open)
            assertEquals(2, view.history.size)
            assertTrue(view.history[1].skipped)
            assertFalse(view.history[0].canUndo)
            assertEquals("Knapp: 1", view.parts.single().stockLabel)
            assertEquals("Noch nie erledigt.".takeIf { view.history.isEmpty() }, view.reasons.firstOrNull())
            store.close()
        }

    @Test
    fun archivingSendsTheFlagAndSaysSo() =
        runTest {
            setup()
            server.on("PATCH", "/api/v1/tasks/t1", taskJson("t1", "Clean filter", archived = true))
            val store = TaskDetailStore(app, "t1")
            store.await { !it.loading }
            store.toggleArchive()
            val state = store.await { it.notice != null }
            assertEquals("«Clean filter» archiviert.", state.notice?.message)
            assertEquals(
                "true",
                server
                    .requestsTo("PATCH", "/api/v1/tasks/t1")
                    .single()
                    .json["archived"]!!
                    .jsonPrimitive.content,
            )
            store.close()
        }

    @Test
    fun deletingClosesTheScreen() =
        runTest {
            setup()
            server.on("DELETE", "/api/v1/tasks/t1", "", HttpStatusCode.NoContent)
            val store = TaskDetailStore(app, "t1")
            store.await { !it.loading }
            store.delete()
            assertTrue(store.await { it.deleted }.deleted)
            store.close()
        }

    @Test
    fun aPreparationIsTickedOff() =
        runTest {
            setup()
            server.on("POST", "/api/v1/tasks/t1/preparations/p1/complete", prep1)
            val store = TaskDetailStore(app, "t1")
            store.await { !it.loading }
            store.completePreparation("p1")
            assertEquals("Vorbereitung «Order filter» erledigt.", store.await { it.notice != null }.notice?.message)
            store.close()
        }

    @Test
    fun partsAreLinkedChangedAndUnlinked() =
        runTest {
            setup()
            server.on(
                "GET",
                "/api/v1/parts",
                page(
                    partLink
                        .substringAfter("\"part\":")
                        .dropLast(1)
                        .replace("pt1", "pt2")
                        .replace("Filter G4", "Seal"),
                ),
            )
            server.on("POST", "/api/v1/tasks/t1/parts", partLink, HttpStatusCode.Created)
            server.on("PATCH", "/api/v1/tasks/t1/parts/pt1", partLink)
            server.on("DELETE", "/api/v1/tasks/t1/parts/pt1", "", HttpStatusCode.NoContent)
            val store = TaskDetailStore(app, "t1")
            store.await { !it.loading }

            store.loadPartChoices()
            assertEquals(listOf("pt2"), store.await { !it.partChoicesLoading && it.partChoices.isNotEmpty() }.partChoices.map { it.value })

            store.linkPart("", "1")
            assertEquals("Wähle ein Ersatzteil.", store.await { it.partError != null }.partError)
            store.linkPart("pt2", "0")
            store.await { it.partError == "Mindestens 1." }
            store.linkPart("pt2", "3")
            store.await { it.partSaved }
            assertEquals(
                "3",
                server
                    .requestsTo("POST", "/api/v1/tasks/t1/parts")
                    .single()
                    .json["qty"]!!
                    .jsonPrimitive.content,
            )
            store.partDialogClosed()

            store.setPartQty("pt1", "4")
            store.await { it.partSaved }
            assertEquals(
                "4",
                server
                    .requestsTo("PATCH", "/api/v1/tasks/t1/parts/pt1")
                    .single()
                    .json["qty"]!!
                    .jsonPrimitive.content,
            )

            store.unlinkPart("pt1")
            store.await { it.notice?.message == "Verknüpfung mit «Filter G4» gelöst." }
            store.close()
        }

    @Test
    fun aMissingTaskIsReported() =
        runTest {
            server.household()
            server.onError("GET", "/api/v1/tasks/t1", HttpStatusCode.NotFound, "not_found")
            val store = TaskDetailStore(app, "t1")
            val state = store.await { !it.loading }
            assertTrue(state.error!!.isNotFound)
            assertNull(state.view)
            store.close()
        }
}
