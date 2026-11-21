package ch.orellbuehler.hauswart.feature.tasks

import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TaskActionStoreTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app
    private val today = Dates.today("Europe/Zurich")

    @AfterTest
    fun tearDown() = server.close()

    private val completed = { id: String ->
        """{"completion":${completionJson(
            id,
        )},"task":${taskJson("t1", "Clean filter")},"serviceLog":null}"""
    }

    private fun setup(task: String = taskJson("t1", "Clean filter")) {
        server.household()
        server.on("GET", "/api/v1/tasks/t1", detailJson(task))
    }

    private fun vehicle(odometer: String) =
        """{"assetId":"a1","plate":null,"vin":null,"registrationNumber":null,"firstRegistration":null,"fuelType":null,"tireSizeSummer":null,
            "tireSizeWinter":null,"location":null,"odometerUnit":"km","notes":null,"odometer":$odometer,"costBookId":null,
            "createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}"""

    @Test
    fun aPlainCompletionSendsOneKeyEvenWhenItIsRetried() =
        runTest {
            setup()
            server.onError("POST", "/api/v1/tasks/t1/complete", HttpStatusCode.ServiceUnavailable, "upstream_error")
            val store = TaskActionStore(app, "t1", ACTION_COMPLETE)
            val form = assertNotNull(store.await { !it.loading }.initial)
            assertEquals(today, form.date)
            store.save(form.withField("note", " done "))
            store.await { it.error != null }
            server.on("POST", "/api/v1/tasks/t1/complete", completed("c1"), HttpStatusCode.Created)
            store.save(form.withField("note", " done "))
            val state = store.await { it.notice != null }
            assertEquals("Erledigt: «Clean filter»", state.notice?.message)
            assertEquals("c1", state.notice?.undo?.completionId)
            val bodies = server.requestsTo("POST", "/api/v1/tasks/t1/complete").map { it.json }
            assertEquals(2, bodies.size)
            assertEquals(bodies[0]["idempotencyKey"], bodies[1]["idempotencyKey"])
            assertEquals("done", bodies[1]["note"]!!.jsonPrimitive.content)
            assertNull(bodies[1]["completedAt"])
            store.close()
        }

    @Test
    fun aBackdatedCompletionSendsNoonOfThatDayAndFutureDatesAreRefused() =
        runTest {
            setup()
            server.on("POST", "/api/v1/tasks/t1/complete", completed("c1"), HttpStatusCode.Created)
            val store = TaskActionStore(app, "t1", ACTION_COMPLETE)
            val form = assertNotNull(store.await { !it.loading }.initial)
            store.save(form.withField("date", Dates.addDays(today, 2)))
            val refused = store.await { it.fieldErrors.isNotEmpty() }
            assertEquals("Das Datum darf nicht in der Zukunft liegen.", refused.fieldErrors["date"])
            assertTrue(server.requestsTo("POST", "/api/v1/tasks/t1/complete").isEmpty())
            store.save(form.withField("date", "2020-01-10"))
            store.await { it.notice != null }
            val sent =
                server
                    .requestsTo("POST", "/api/v1/tasks/t1/complete")
                    .single()
                    .json["completedAt"]!!
                    .jsonPrimitive.content
            assertEquals("2020-01-10T11:00:00Z", sent)
            store.close()
        }

    @Test
    fun anOdometerTaskAsksForTheReadingAndSendsItAsCounterValue() =
        runTest {
            setup(taskJson("t1", "Service car", trigger = ODOMETER, assetId = "a1", assetName = "Car"))
            server.on("GET", "/api/v1/assets/a1/vehicle", vehicle("""{"value":45200,"date":"2026-10-01","unit":"km"}"""))
            server.on("POST", "/api/v1/tasks/t1/complete", completed("c1"), HttpStatusCode.Created)
            val store = TaskActionStore(app, "t1", ACTION_COMPLETE)
            val ready = store.await { !it.loading }
            assertEquals("Stand (km)", ready.odometerLabel)
            val form = assertNotNull(ready.initial)
            assertEquals("45200", form.odometer)

            store.save(form.withField("odometer", "oops"))
            assertTrue(store.await { it.fieldErrors.containsKey("odometer") }.fieldErrors["odometer"]!!.startsWith("Bitte einen Stand"))

            store.save(form)
            store.await { it.notice != null }
            assertNull(server.requestsTo("POST", "/api/v1/tasks/t1/complete").single().json["counterValue"])
            store.close()
        }

    @Test
    fun aChangedReadingIsSentAndARefusedOneNamesTheNeighbour() =
        runTest {
            setup(taskJson("t1", "Service car", trigger = ODOMETER, assetId = "a1", assetName = "Car"))
            server.on("GET", "/api/v1/assets/a1/vehicle", vehicle("null"))
            server.onError(
                "POST",
                "/api/v1/tasks/t1/complete",
                HttpStatusCode.BadRequest,
                "invalid_request",
                details =
                    """{"code":"lower_than_previous","field":"counterValue","reading":{"value":50000,"date":"2026-10-01"},
                        "body":{"fieldErrors":{"counterValue":["too low"]}}}""",
            )
            val store = TaskActionStore(app, "t1", ACTION_COMPLETE)
            val form = assertNotNull(store.await { !it.loading }.initial)
            store.save(form.withField("odometer", "40.000"))
            val state = store.await { it.error != null }
            assertEquals(
                "40000",
                server
                    .requestsTo(
                        "POST",
                        "/api/v1/tasks/t1/complete",
                    ).single()
                    .json["counterValue"]!!
                    .jsonPrimitive.content
                    .removeSuffix(".0"),
            )
            assertEquals(
                "Der Stand ist tiefer als der Stand davor (50'000 km am 01.10.2026). Prüfe die Zahl und das Datum.",
                state.fieldErrors["odometer"],
            )
            store.close()
        }

    @Test
    fun theServiceLogGoesWithTheCompletionAndResolvesNotes() =
        runTest {
            setup(taskJson("t1", "Clean filter", assetId = "a1", assetName = "Vent", openNotes = 1))
            server.on("GET", "/api/v1/contacts", page())
            server.on(
                "GET",
                "/api/v1/assets/a1/notes",
                page(
                    """{"id":"n1","assetId":"a1","assetName":"Vent","body":"Rattles","status":"open","resolvedAt":null,"resolvedBy":null,"resolvedByName":null,"serviceLogId":null,"defectId":null,"createdBy":null,"createdByName":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}""",
                ),
            )
            server.on(
                "POST",
                "/api/v1/tasks/t1/complete",
                """{"completion":${completionJson("c1")},"task":${taskJson("t1", "Clean filter")},"serviceLog":null}""",
                HttpStatusCode.Created,
            )
            val store = TaskActionStore(app, "t1", ACTION_COMPLETE)
            val ready = store.await { !it.loading }
            assertTrue(ready.canLogWork)
            val form = assertNotNull(ready.initial).withField("logWork", "true")
            store.prepareServiceLog()
            assertEquals(listOf("n1"), store.await { it.notes.isNotEmpty() }.notes.map { it.value })

            store.save(form.withField("logTitle", " "))
            assertEquals("Pflichtfeld.", store.await { it.fieldErrors.isNotEmpty() }.fieldErrors["logTitle"])
            store.save(form.withField("logCost", "abc"))
            store.await { it.fieldErrors.containsKey("logCost") }

            store.save(form.withField("logCost", "12.50").toggleNote("n1"))
            val done = store.await { it.notice != null }
            assertEquals("«Clean filter» erledigt und im Service-Log festgehalten.", done.notice?.message)
            val log: JsonObject =
                server
                    .requestsTo("POST", "/api/v1/tasks/t1/complete")
                    .single()
                    .json["serviceLog"]!!
                    .jsonObject
            assertEquals("Clean filter", log["title"]!!.jsonPrimitive.content)
            assertEquals("1250", log["costMinor"]!!.jsonPrimitive.content)
            assertEquals(
                "n1",
                log["resolvedNoteIds"]!!
                    .jsonArray
                    .single()
                    .jsonPrimitive.content,
            )
            store.close()
        }

    @Test
    fun skippingSendsAKeyAndTheNote() =
        runTest {
            setup()
            server.on("POST", "/api/v1/tasks/t1/skip", completed("c9"), HttpStatusCode.Created)
            val store = TaskActionStore(app, "t1", ACTION_SKIP)
            val form = assertNotNull(store.await { !it.loading }.initial)
            store.save(form.withField("note", "away"))
            assertEquals("Übersprungen: «Clean filter»", store.await { it.notice != null }.notice?.message)
            val body = server.requestsTo("POST", "/api/v1/tasks/t1/skip").single().json
            assertEquals("away", body["note"]!!.jsonPrimitive.content)
            assertTrue(body["idempotencyKey"]!!.jsonPrimitive.content.length >= 8)
            store.close()
        }

    @Test
    fun snoozingNeedsADayAfterToday() =
        runTest {
            setup()
            server.on("POST", "/api/v1/tasks/t1/snooze", taskJson("t1", "Clean filter"))
            val store = TaskActionStore(app, "t1", ACTION_SNOOZE)
            val ready = store.await { !it.loading }
            assertEquals(4, ready.presets.size)
            assertEquals(Dates.addDays(today, 1), ready.presets[0].date)
            val nextWeek = Dates.parse(ready.presets[2].date)!!
            assertEquals(1, isoWeekdayOf(nextWeek.toString()))
            val form = assertNotNull(ready.initial)
            assertEquals(Dates.addDays(today, 3), form.date)
            store.save(form.withField("date", today))
            assertEquals("Wähle ein Datum nach heute.", store.await { it.fieldErrors.isNotEmpty() }.fieldErrors["date"])
            store.save(form)
            val done = store.await { it.notice != null }
            assertEquals("snooze", done.notice?.undo?.kind)
            assertEquals(
                form.date,
                server
                    .requestsTo("POST", "/api/v1/tasks/t1/snooze")
                    .single()
                    .json["until"]!!
                    .jsonPrimitive.content,
            )
            store.close()
        }

    @Test
    fun aMissingTaskCannotBeActedOn() =
        runTest {
            server.household()
            server.onError("GET", "/api/v1/tasks/t1", HttpStatusCode.NotFound, "not_found")
            val store = TaskActionStore(app, "t1", ACTION_COMPLETE)
            assertTrue(store.await { !it.loading }.loadError!!.isNotFound)
            store.close()
        }
}
