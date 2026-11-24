package ch.orellbuehler.hauswart.feature.vehicles

import ch.orellbuehler.hauswart.feature.inventory.assetJson
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

class VehicleSetupStoreTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private fun taskJson(
        id: String,
        title: String,
        ref: String? = null,
        trigger: String = """{"v":1,"type":"one_off","date":"2027-01-01"}""",
        archived: Boolean = false,
        category: String = "maintenance",
    ) =
        """{"id":"$id","title":"$title","descriptionMd":"","category":"$category","priority":"normal","effortMinutes":null,"assetId":"a1","assetName":"Beispielauto",
        "roomId":null,"roomName":null,"trigger":$trigger,"assignMode":"none","assigneeUserId":null,"rotationOrder":[],"rotationStrategy":"alternate",
        "notifyMode":"assignee","graceDays":0,"dueSoonDays":null,"snoozedUntil":null,"archivedAt":${if (archived) "\"2026-01-01T00:00:00.000Z\"" else "null"},
        "source":"manual","externalSource":${if (ref != null) "\"vehicle_template\"" else "null"},"externalRef":${if (ref != null) "\"$ref\"" else "null"},
        "externalUrl":null,"createdBy":null,"commentCount":0,"stepCount":0,"openNoteCount":0,"nextAppointment":null,
        "createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z","state":null}"""

    private suspend fun store(tasks: List<String> = emptyList()): VehicleSetupStore {
        server.vehicleBasics()
        server.on("GET", "/api/v1/assets/a1", assetJson("a1", "Beispielauto", kind = "vehicle"))
        server.on("GET", "/api/v1/tasks", page(*tasks.toTypedArray()))
        return VehicleSetupStore(app, "a1").also { it.await { s -> !s.loading } }
    }

    @Test
    fun whatTheVehicleHasAlreadyIsLockedAndNotPreselected() =
        runTest {
            val store =
                store(
                    listOf(
                        taskJson("k1", "Umbenannt", ref = "a1:tires_winter"),
                        taskJson("k2", "Service"),
                        taskJson("k3", "Reifen", ref = "a1:tires_summer", archived = true),
                    ),
                )
            val state = store.value
            assertEquals("Beispielauto", state.assetName)
            assertEquals("Umbenannt", state.rows.first { it.id == "tires_winter" }.existingTitle)
            assertEquals("Service", state.rows.first { it.id == "service" }.existingTitle)
            assertNull(state.rows.first { it.id == "tires_summer" }.existingTitle)
            assertEquals(listOf("tires_summer", "mfk"), state.initial?.selected)
            assertTrue(state.rows.first { it.id == "tires_winter" }.locked)
            assertEquals(
                1,
                state.rows
                    .first { it.id == "tires_summer" }
                    .preparations.size,
            )
            store.close()
        }

    @Test
    fun submittingNeedsASelectionAndValidParameters() =
        runTest {
            val store = store()
            store.submit(VehicleSetupForm(selected = emptyList(), params = store.value.initial!!.params))
            assertEquals(tr("vehicle_setup_none_selected"), store.await { it.message != null }.message)
            store.submit(
                VehicleSetupForm(
                    selected = listOf("service"),
                    params =
                        store.value.initial!!
                            .params
                            .copy(serviceDistance = "x"),
                ),
            )
            val state = store.await { it.fieldErrors.isNotEmpty() }
            assertEquals(tr("form_check_fields"), state.message)
            assertEquals(setOf("serviceDistance"), state.fieldErrors.keys)
            assertTrue(server.requestsTo("POST", "/api/v1/tasks").isEmpty())
            store.close()
        }

    @Test
    fun theChosenTasksAreCreatedWithTheirPreparations() =
        runTest {
            val store = store()
            server.on("POST", "/api/v1/tasks", taskJson("n1", "Winterreifen aufziehen", ref = "a1:tires_winter"))
            server.on(
                "POST",
                "/api/v1/tasks/n1/preparations",
                """{"id":"p1","taskId":"n1","title":"x","kind":"generic","leadDays":28,"sortOrder":0}""",
            )
            val form = store.value.initial!!
            store.submit(form.copy(selected = listOf("tires_winter")))
            val state = store.await { !it.running && it.notice != null }
            assertEquals(tr("vehicle_setup_done_toast", "count" to 1), state.notice)
            assertEquals("created", state.rows.first { it.id == "tires_winter" }.state)
            val task = server.requestsTo("POST", "/api/v1/tasks").single().json
            assertEquals("a1:tires_winter", task["externalRef"]?.jsonPrimitive?.content)
            assertEquals("a1", task["assetId"]?.jsonPrimitive?.content)
            val prep = server.requestsTo("POST", "/api/v1/tasks/n1/preparations").single().json
            assertEquals(28L, prep["leadDays"]?.jsonPrimitive?.content?.toLong())
            assertEquals(0L, prep["sortOrder"]?.jsonPrimitive?.content?.toLong())
            store.close()
        }

    @Test
    fun aMarkThatAnArchivedTaskHoldsGetsTheNextNumber() =
        runTest {
            val store = store()
            server.on(
                "POST",
                "/api/v1/tasks",
                """{"error":{"code":"conflict","message":"Conflict","details":null}}""",
                HttpStatusCode.Conflict,
            )
            server.on("GET", "/api/v1/tasks", page(taskJson("old", "MFK", ref = "a1:mfk", archived = true)))
            store.submit(store.value.initial!!.copy(selected = listOf("mfk")))
            store.await { !it.running && it.rows.first { r -> r.id == "mfk" }.state == "failed" }
            val refs = server.requestsTo("POST", "/api/v1/tasks").map { it.json["externalRef"]?.jsonPrimitive?.content }
            assertEquals(listOf("a1:mfk", "a1:mfk:2", "a1:mfk:3"), refs.take(3))
            store.close()
        }

    @Test
    fun aMarkThatALiveTaskHoldsReportsThatTask() =
        runTest {
            val store = store()
            server.on(
                "POST",
                "/api/v1/tasks",
                """{"error":{"code":"conflict","message":"Conflict","details":null}}""",
                HttpStatusCode.Conflict,
            )
            server.on("GET", "/api/v1/tasks", page(taskJson("live", "Mein MFK", ref = "a1:mfk")))
            store.submit(store.value.initial!!.copy(selected = listOf("mfk")))
            val state = store.await { !it.running && it.rows.first { r -> r.id == "mfk" }.state == "exists" }
            assertEquals("Mein MFK", state.rows.first { it.id == "mfk" }.existingTitle)
            assertNull(state.notice)
            store.close()
        }

    @Test
    fun aFailingTaskDoesNotStopTheOthers() =
        runTest {
            val store = store()
            server.onError("POST", "/api/v1/tasks", HttpStatusCode.InternalServerError, "internal_error")
            store.submit(store.value.initial!!.copy(selected = listOf("tires_winter", "tires_summer")))
            val state = store.await { !it.running && it.message != null }
            assertEquals(tr("vehicle_setup_partial_error"), state.message)
            assertEquals(listOf("failed", "failed"), state.rows.filter { it.id.startsWith("tires") }.map { it.state })
            assertEquals(2, server.requestsTo("POST", "/api/v1/tasks").size)
            store.close()
        }
}
