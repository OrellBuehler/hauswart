package ch.orellbuehler.hauswart.feature.vehicles

import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TireStoresTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private fun sets() =
        server.on(
            "GET",
            "/api/v1/assets/a1/tire-sets",
            page(
                tireSetJson("t1", season = "summer", retired = true, tread = null),
                tireSetJson("t2", season = "summer", tread = 2.5, treadWarning = true, age = 7.0),
                tireSetJson("t3", season = "winter", mounted = true, mountedOn = "2026-11-01"),
            ),
        )

    private suspend fun store(): TireSetsStore {
        server.vehicleBasics()
        sets()
        return TireSetsStore(app, "a1").also { it.await { s -> !s.loading } }
    }

    @Test
    fun theMountedSetComesFirstAndWarningsAreCollected() =
        runTest {
            val store = store()
            val state = store.value
            assertEquals(listOf("t3", "t2"), state.visible.map { it.id })
            assertEquals(1, state.retiredCount)
            assertEquals(tr("tire_card_mounted", "name" to "Winterreifen 195/65 R15", "date" to "01.11.2026"), state.summary)
            assertEquals("2026-11-01", state.mountedSince)
            assertEquals(
                listOf(
                    "Sommerreifen 195/65 R15: " + tr("tire_warning_tread", "depth" to "2.5", "limit" to "3"),
                    "Sommerreifen 195/65 R15: " + tr("tire_warning_age", "years" to "7", "limit" to 6),
                ),
                state.warnings,
            )
            assertTrue(state.rows.first { it.id == "t3" }.mounted)
            assertTrue(state.rows.first { it.id == "t2" }.canMount)
            assertTrue(!state.rows.first { it.id == "t1" }.canMeasure)
            store.toggleRetired()
            assertEquals(3, store.value.visible.size)
            store.close()
        }

    @Test
    fun anAddedSetStartsWithTheSizeOfItsSeason() =
        runTest {
            val store = store()
            val form = store.newForm("winter")
            assertEquals("195/65 R15", form.size)
            val summer = store.withSeason(form, "summer")
            assertEquals("205/55 R16", summer.size)
            assertEquals("Mein Mass", store.withSeason(form.copy(size = "Mein Mass"), "summer").size)

            store.save(null, form.copy(dot = "9923"))
            assertEquals(tr("tire_error_dot"), store.await { it.fieldErrors.isNotEmpty() }.fieldErrors["dot"])
            server.on("POST", "/api/v1/assets/a1/tire-sets", tireSetJson("t9").dropLast(1) + ""","events":[]}""")
            store.save(null, form.copy(brand = " Beispiel ", treadDepth = "7,5"))
            store.await { it.done }
            val body = server.requestsTo("POST", "/api/v1/assets/a1/tire-sets").single().json
            assertEquals("Beispiel", body["brand"]?.jsonPrimitive?.content)
            assertEquals(7.5, body["treadDepthMm"]?.jsonPrimitive?.doubleOrNull)
            assertEquals(form.treadMeasuredOn, body["treadMeasuredOn"]?.jsonPrimitive?.content)
            assertNull(body["model"])
            store.close()
        }

    @Test
    fun editingClearsWhatWasEmptied() =
        runTest {
            val store = store()
            val form = store.editForm("t2")!!.copy(brand = "")
            server.on("PATCH", "/api/v1/tire-sets/t2", tireSetJson("t2").dropLast(1) + ""","events":[]}""")
            store.save("t2", form)
            store.await { it.done }
            val body = server.requestsTo("PATCH", "/api/v1/tire-sets/t2").single().json
            assertEquals(JsonNull, body["brand"])
            assertEquals("summer", body["season"]?.jsonPrimitive?.content)
            store.close()
        }

    @Test
    fun mountingChecksTheDayAndWordsTheServersRefusals() =
        runTest {
            val store = store()
            val today = store.value.today
            store.mount("t2", TireMountForm(date = "2026-10-15", odometer = ""))
            assertEquals(
                tr("tire_mount_date_before", "date" to "01.11.2026"),
                store.await { it.fieldErrors.isNotEmpty() }.fieldErrors["date"],
            )
            assertTrue(server.requestsTo("POST", "/api/v1/assets/a1/tire-sets/t2/mount").isEmpty())

            server.onError(
                "POST",
                "/api/v1/assets/a1/tire-sets/t2/mount",
                HttpStatusCode.BadRequest,
                "invalid_request",
                details = """{"code":"lower_than_previous","field":"odometer","reading":{"value":45200,"date":"2026-10-01"}}""",
            )
            store.clearForm()
            store.mount("t2", TireMountForm(date = today, odometer = "40000"))
            val refused = store.await { it.fieldErrors["odometer"] != null }
            assertEquals(
                tr("vehicle_odometer_refused_lower", "value" to "45'200 km", "date" to "01.10.2026"),
                refused.fieldErrors["odometer"],
            )
            assertEquals(
                40000.0,
                server
                    .requestsTo("POST", "/api/v1/assets/a1/tire-sets/t2/mount")
                    .single()
                    .json["odometer"]
                    ?.jsonPrimitive
                    ?.doubleOrNull,
            )

            server.onError("POST", "/api/v1/assets/a1/tire-sets/t2/mount", HttpStatusCode.Conflict, "conflict")
            store.clearForm()
            store.mount("t2", TireMountForm(date = today, odometer = ""))
            assertEquals(tr("tire_error_not_mountable"), store.await { it.formError?.code == "conflict" }.formError?.message)
            store.close()
        }

    @Test
    fun theReadingThatIsAlreadyKnownIsNotSentAgain() =
        runTest {
            val store = store()
            val form = store.newMountForm()
            assertEquals("45200", form.odometer)
            server.on("POST", "/api/v1/assets/a1/tire-sets/t2/mount", tireSetJson("t2").dropLast(1) + ""","events":[]}""")
            store.mount("t2", form)
            val state = store.await { it.done }
            assertNull(server.requestsTo("POST", "/api/v1/assets/a1/tire-sets/t2/mount").single().json["odometer"])
            assertEquals(tr("tire_mounted_toast", "name" to "Sommerreifen 195/65 R15"), state.notice)
            store.close()
        }

    @Test
    fun measuringNeedsADepthWithinTheLimit() =
        runTest {
            val store = store()
            val today = store.value.today
            store.measure("t3", TireTreadForm(date = today, depth = "", odometer = ""))
            assertEquals(tr("m_field_required"), store.await { it.fieldErrors.isNotEmpty() }.fieldErrors["treadDepthMm"])
            store.measure("t3", TireTreadForm(date = today, depth = "25", odometer = ""))
            assertEquals(
                tr("tire_error_tread", "max" to "20"),
                store
                    .await {
                        it.fieldErrors["treadDepthMm"] != tr("m_field_required")
                    }.fieldErrors["treadDepthMm"],
            )
            server.on("POST", "/api/v1/tire-sets/t3/tread", tireSetJson("t3").dropLast(1) + ""","events":[]}""")
            store.measure("t3", TireTreadForm(date = today, depth = "6.5", odometer = ""))
            assertEquals(tr("tire_tread_saved_toast", "depth" to "6.5"), store.await { it.done }.notice)
            store.close()
        }

    @Test
    fun retiringAndDeletingReportTheChange() =
        runTest {
            val store = store()
            server.on("PATCH", "/api/v1/tire-sets/t3", tireSetJson("t3").dropLast(1) + ""","events":[]}""")
            server.on("DELETE", "/api/v1/tire-sets/t2", "", HttpStatusCode.NoContent)
            store.setRetired("t3", true)
            store.await { it.notice == tr("tire_retired_toast") }
            assertEquals(
                true,
                server
                    .requestsTo("PATCH", "/api/v1/tire-sets/t3")
                    .single()
                    .json["retired"]
                    ?.jsonPrimitive
                    ?.content
                    ?.toBoolean(),
            )
            store.delete("t2")
            store.await { it.notice == tr("tire_deleted_toast") }
            store.close()
        }

    @Test
    fun theDetailShowsTheHistoryNewestFirst() =
        runTest {
            server.on(
                "GET",
                "/api/v1/tire-sets/t3",
                tireSetJson("t3", mounted = true, mountedOn = "2026-11-01").dropLast(1) +
                    ""","events":[
                    {"id":"e1","kind":"mounted","date":"2026-11-01","odometer":45200,"treadDepthMm":null,"createdAt":"2026-11-01T00:00:00.000Z"},
                    {"id":"e2","kind":"tread_measured","date":"2026-11-05","odometer":null,"treadDepthMm":6.5,"createdAt":"2026-11-05T00:00:00.000Z"}]}""",
            )
            val store = TireSetDetailStore(app, "t3")
            val state = store.await { !it.loading }
            assertEquals(listOf("e2", "e1"), state.events.map { it.id })
            assertEquals(tr("m_tire_event_mounted"), state.events[1].title)
            assertEquals("01.11.2026 · 45'200 km", state.events[1].detail)
            assertEquals("t3", state.row?.id)
            store.close()
        }
}
