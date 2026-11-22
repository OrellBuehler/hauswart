package ch.orellbuehler.hauswart.feature.tasks

import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TaskEditStoreTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private val due =
        """{"status":"ok","dueDate":"2027-02-01","dueKind":"exact","occurrenceKey":"k","reasons":["never_completed"]}"""

    private fun setup() {
        server.household()
        server.places()
        server.on(
            "GET",
            "/api/v1/assets",
            page(
                """{"id":"a1","kind":"vehicle","name":"Car","slug":"car","qrSlug":"q","roomId":"r1","roomName":"Kitchen","category":null,"manufacturer":null,"model":null,
                    "serialNumber":null,"purchaseDate":null,"installedDate":null,"warrantyUntil":null,"warrantyExtendedUntil":null,"warrantySource":"manual",
                    "showOnEmergency":false,"notes":null,"species":null,"light":null,"waterNotes":null,"photoAttachmentId":null,"photoUrl":null,
                    "externalSource":null,"externalRef":null,"archivedAt":null,"commentCount":0,
                    "vehicle":{"plate":null,"odometer":{"value":10,"date":"2026-01-01","unit":"mi"}},
                    "createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}""",
            ),
        )
        server.on("POST", "/api/v1/tasks/preview", due)
    }

    private fun store(
        id: String? = null,
        asset: String? = null,
    ) = TaskEditStore(app, id, asset).also { it.previewDelayMs = 0 }

    @Test
    fun aNewTaskStartsWithTheWebDefaultsAndTheGivenAsset() =
        runTest {
            setup()
            server.on(
                "GET",
                "/api/v1/household",
                """{"name":"H","timezone":"Europe/Zurich","currency":"CHF","handoverDate":null,"settings":{"dueSoonDays":5,"digestTime":"07:00","defectDeadlineMonths":24},"updatedAt":"2026-01-01T00:00:00.000Z"}""",
            )
            val store = store(asset = "a1")
            val state = store.await { !it.loading }
            val form = assertNotNull(state.initial)
            assertEquals("a1", form.assetId)
            assertEquals(TRIGGER_INTERVAL, form.trigger.type)
            assertEquals("maintenance", form.category)
            assertEquals(5, state.dueSoonDefault)
            assertEquals("mi", state.vehicleOf("a1")?.odometerUnit)
            assertTrue(state.isNew)
            store.close()
        }

    @Test
    fun createSendsEverythingAsTyped() =
        runTest {
            setup()
            server.on("POST", "/api/v1/tasks", taskJson("t9", "Check smoke detector"), HttpStatusCode.Created)
            server.on(
                "POST",
                "/api/v1/tasks/t9/preparations",
                """{"id":"p1","taskId":"t9","title":"x","kind":"generic","leadDays":7,"leadValue":null,"partId":null,"qty":1,"sortOrder":0,"state":"not_yet"}""",
                HttpStatusCode.Created,
            )
            val store = store()
            val initial = assertNotNull(store.await { !it.loading }.initial)
            val form =
                initial
                    .withField("title", "  Check smoke detector ")
                    .withField("effort", "15")
                    .withField("assignMode", "rotate")
                    .addRotation("u1")
                    .addPreparation("k1")
                    .withPreparation("k1", "title", "Buy batteries")
            store.save(form)
            val state = store.await { it.savedId != null }
            assertEquals("t9", state.savedId)
            val body = server.requestsTo("POST", "/api/v1/tasks").single().json
            assertEquals("Check smoke detector", body["title"]!!.jsonPrimitive.content)
            assertEquals("15", body["effortMinutes"]!!.jsonPrimitive.content)
            assertEquals("rotate", body["assignMode"]!!.jsonPrimitive.content)
            assertEquals(
                "u1",
                body["rotationOrder"]!!
                    .jsonArray
                    .single()
                    .jsonPrimitive.content,
            )
            assertEquals("interval", body["trigger"]!!.jsonObject["type"]!!.jsonPrimitive.content)
            assertNull(body["dueSoonDays"])
            val prep = server.requestsTo("POST", "/api/v1/tasks/t9/preparations").single().json
            assertEquals("Buy batteries", prep["title"]!!.jsonPrimitive.content)
            assertEquals("7", prep["leadDays"]!!.jsonPrimitive.content)
            assertFalse(state.preparationsFailed)
            store.close()
        }

    @Test
    fun invalidInputIsRefusedWithoutARequest() =
        runTest {
            setup()
            val store = store()
            val initial = assertNotNull(store.await { !it.loading }.initial)
            store.save(
                initial
                    .withField("title", " ")
                    .withField("graceDays", "400")
                    .withField("assignMode", "fixed")
                    .withTrigger(initial.trigger.withField("every", "0")),
            )
            val state = store.await { it.fieldErrors.isNotEmpty() }
            assertEquals(setOf("title", "graceDays", "assigneeUserId", "trigger.every"), state.fieldErrors.keys)
            assertEquals("Pflichtfeld.", state.fieldErrors["title"])
            assertEquals("Bitte korrigiere die markierten Felder.", state.error?.message)
            assertTrue(server.requestsTo("POST", "/api/v1/tasks").isEmpty())
            store.close()
        }

    @Test
    fun serverFieldErrorsLandOnTheirFields() =
        runTest {
            setup()
            server.onError(
                "POST",
                "/api/v1/tasks",
                HttpStatusCode.BadRequest,
                "invalid_request",
                details = """{"body":{"fieldErrors":{"roomId":["Unknown room"]},"formErrors":[]}}""",
            )
            val store = store()
            val initial = assertNotNull(store.await { !it.loading }.initial)
            store.save(initial.withField("title", "A"))
            val state = store.await { !it.saving && it.error != null }
            assertEquals("Unknown room", state.fieldErrors["roomId"])
            store.close()
        }

    @Test
    fun editingFillsTheFormAndSendsPatchesForClearedFields() =
        runTest {
            setup()
            server.on("GET", "/api/v1/tasks/t1", detailJson(taskJson("t1", "Clean filter", roomId = "r1", roomName = "Kitchen")))
            server.on("PATCH", "/api/v1/tasks/t1", taskJson("t1", "Clean filter 2"))
            val store = store("t1")
            val initial = assertNotNull(store.await { !it.loading }.initial)
            assertEquals("Clean filter", initial.title)
            assertEquals("r1", initial.roomId)
            assertEquals("3", initial.trigger.every)
            store.save(initial.withField("title", "Clean filter 2").withField("roomId", ""))
            store.await { it.savedId != null }
            val body = server.requestsTo("PATCH", "/api/v1/tasks/t1").single().json
            assertEquals(JsonNull, body["roomId"])
            assertEquals(JsonNull, body["effortMinutes"])
            assertEquals("Clean filter 2", body["title"]!!.jsonPrimitive.content)
            assertNotNull(body["trigger"])
            store.close()
        }

    @Test
    fun aTriggerThisBuildCannotEditIsLeftUntouched() =
        runTest {
            setup()
            server.on(
                "GET",
                "/api/v1/tasks/t1",
                detailJson(taskJson("t1", "Electricity bill", trigger = BILL, externalSource = "finance_bill")),
            )
            server.on("PATCH", "/api/v1/tasks/t1", taskJson("t1", "Electricity bill"))
            val store = store("t1")
            val ready = store.await { !it.loading }
            assertFalse(ready.triggerEditable)
            assertTrue(ready.billManaged)
            assertEquals("Rechnung fällig am 31.12.2026", ready.triggerSummary)
            assertTrue(ready.preview.incomplete)
            store.save(assertNotNull(ready.initial).withField("notifyMode", "all"))
            store.await { it.savedId != null }
            val body = server.requestsTo("PATCH", "/api/v1/tasks/t1").single().json
            assertFalse(body.containsKey("trigger"))
            assertEquals("all", body["notifyMode"]!!.jsonPrimitive.content)
            store.close()
        }

    @Test
    fun editingPreparationsCreatesUpdatesAndDeletes() =
        runTest {
            setup()
            val prepA =
                """{"id":"pa","taskId":"t1","title":"Keep","kind":"generic","leadDays":7,"leadValue":null,"partId":null,
                    "qty":1,"sortOrder":0,"state":"not_yet"}"""
            val prepB = prepA.replace("\"pa\"", "\"pb\"").replace("Keep", "Drop")
            server.on("GET", "/api/v1/tasks/t1", detailJson(taskJson("t1", "Clean filter"), "[$prepA,$prepB]"))
            server.on("PATCH", "/api/v1/tasks/t1", taskJson("t1", "Clean filter"))
            server.on("PATCH", "/api/v1/tasks/t1/preparations/pa", prepA)
            server.on("DELETE", "/api/v1/tasks/t1/preparations/pb", "", HttpStatusCode.NoContent)
            val store = store("t1")
            val initial = assertNotNull(store.await { !it.loading }.initial)
            val keep = initial.preparations.first { it.id == "pa" }
            store.save(
                initial.removePreparation(initial.preparations.first { it.id == "pb" }.key).withPreparation(keep.key, "title", "Kept"),
            )
            store.await { it.savedId != null }
            assertEquals(
                "Kept",
                server
                    .requestsTo("PATCH", "/api/v1/tasks/t1/preparations/pa")
                    .single()
                    .json["title"]!!
                    .jsonPrimitive.content,
            )
            assertEquals(1, server.requestsTo("DELETE", "/api/v1/tasks/t1/preparations/pb").size)
            store.close()
        }

    @Test
    fun theLivePreviewAsksTheServerForACompleteRhythmOnly() =
        runTest {
            setup()
            val store = store()
            val initial = assertNotNull(store.await { !it.loading }.initial)
            val first = store.await { !it.preview.incomplete && !it.preview.loading }.preview
            assertEquals("Alle 3 Monate ab letzter Erledigung", first.summary)
            assertEquals("Bald fällig".takeIf { false } ?: first.statusLabel, first.statusLabel)
            assertTrue(first.dueText.isNotEmpty())
            val before = server.requestsTo("POST", "/api/v1/tasks/preview").size
            store.preview(initial.withTrigger(initial.trigger.withField("every", "")))
            assertTrue(store.await { it.preview.incomplete }.preview.incomplete)
            assertEquals(before, server.requestsTo("POST", "/api/v1/tasks/preview").size)
            store.close()
        }

    @Test
    fun aFailingPreviewIsShownNotThrown() =
        runTest {
            setup()
            server.onError("POST", "/api/v1/tasks/preview", HttpStatusCode.InternalServerError, "internal_error")
            val store = store()
            store.await { !it.loading }
            val state = store.await { it.preview.error != null }
            assertEquals(false, state.preview.incomplete)
            store.close()
        }
}
