package ch.orellbuehler.hauswart.feature.vehicles

import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class OdometerStoresTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private val refusal = """{"code":"lower_than_previous","field":"value","reading":{"value":45000,"date":"2026-09-01"}}"""

    @Test
    fun theRecordDialogLoadsTheUnitAndTheLatestReading() =
        runTest {
            server.vehicleBasics()
            val store = OdometerRecordStore(app, "a1")
            store.reset()
            val state = store.await { it.initial != null }
            assertEquals("km", state.unit)
            assertEquals(app.household.today(), state.initial?.date)
            assertEquals(tr("vehicle_odometer_latest", "value" to "45'200 km", "date" to "01.10.2026"), state.hint)
            store.close()
        }

    @Test
    fun recordingChecksTheFieldsBeforeItAsksTheServer() =
        runTest {
            server.vehicleBasics()
            val store = OdometerRecordStore(app, "a1")
            store.reset()
            val today = store.await { it.initial != null }.today
            store.save(OdometerForm(value = "", date = today))
            assertEquals(tr("m_field_required"), store.await { it.fieldErrors.isNotEmpty() }.fieldErrors["value"])
            store.save(OdometerForm(value = "12x", date = "2999-01-01"))
            val state = store.await { it.fieldErrors["date"] != null }
            assertEquals(tr("vehicle_odometer_date_future"), state.fieldErrors["date"])
            assertTrue(state.fieldErrors["value"]!!.isNotEmpty())
            assertTrue(server.requestsTo("POST", "/api/v1/assets/a1/odometer").isEmpty())
            store.close()
        }

    @Test
    fun aRefusedReadingExplainsItselfAndIsForcedOnTheSecondTry() =
        runTest {
            server.vehicleBasics()
            server.onError("POST", "/api/v1/assets/a1/odometer", HttpStatusCode.BadRequest, "invalid_request", details = refusal)
            val store = OdometerRecordStore(app, "a1")
            store.reset()
            val today = store.await { it.initial != null }.today
            val form = OdometerForm(value = "44'000", date = today, note = " nach dem Tanken ")
            store.save(form)
            val refused = store.await { it.refusedFor != null }
            assertEquals(tr("vehicle_odometer_lower_short"), refused.fieldErrors["value"])
            assertEquals(tr("vehicle_odometer_lower", "value" to "45'000 km", "date" to "01.09.2026"), refused.refusalText)
            assertTrue(store.isForced(form))
            assertTrue(!store.isForced(form.copy(value = "44'100")))
            val first = server.requestsTo("POST", "/api/v1/assets/a1/odometer").single().json
            assertNull(first["force"])
            assertEquals(44000.0, first["value"]?.jsonPrimitive?.doubleOrNull)
            assertEquals("nach dem Tanken", first["note"]?.jsonPrimitive?.content)

            server.on("POST", "/api/v1/assets/a1/odometer", readingJson("r9", 44000.0, today))
            store.save(form)
            val saved = store.await { it.savedText != null }
            assertEquals(tr("vehicle_odometer_saved_toast", "value" to "44'000 km"), saved.savedText)
            assertEquals(
                true,
                server
                    .requestsTo("POST", "/api/v1/assets/a1/odometer")
                    .last()
                    .json["force"]
                    ?.jsonPrimitive
                    ?.booleanOrNull,
            )
            store.close()
        }

    @Test
    fun theHistoryListsReadingsWithTheirSourceAndLoadsMore() =
        runTest {
            server.vehicleBasics()
            server.on(
                "GET",
                "/api/v1/assets/a1/odometer",
                """{"items":[${readingJson(
                    "r2",
                    45200.0,
                    "2026-10-01",
                    "fuel_log",
                )},${readingJson("r1", 45000.0, "2026-09-01", note = "Service")}],"nextCursor":"n1"}""",
            )
            val store = OdometerStore(app, "a1")
            val state = store.await { !it.loading }
            assertEquals(listOf("45'200 km", "45'000 km"), state.lines.map { it.valueText })
            assertEquals(tr("vehicle_source_fuel_log"), state.lines[0].sourceLabel)
            assertNull(state.lines[1].sourceLabel)
            assertEquals("Service", state.lines[1].note)
            assertTrue(state.hasMore)
            assertEquals("limit=20", server.requestsTo("GET", "/api/v1/assets/a1/odometer").single().query)

            server.on("GET", "/api/v1/assets/a1/odometer", page(readingJson("r0", 44000.0, "2026-08-01")))
            store.loadMore()
            val more = store.await { it.lines.size == 3 }
            assertTrue(!more.hasMore)
            assertTrue(
                server
                    .requestsTo("GET", "/api/v1/assets/a1/odometer")
                    .last()
                    .query
                    .contains("cursor=n1"),
            )
            store.close()
        }

    @Test
    fun deletingAReadingOfAnotherRecordNamesTheOwner() =
        runTest {
            server.vehicleBasics()
            server.on("GET", "/api/v1/assets/a1/odometer", page(readingJson("r2", 45200.0, "2026-10-01", "fuel_log")))
            server.onError(
                "DELETE",
                "/api/v1/odometer-readings/r2",
                HttpStatusCode.Conflict,
                "conflict",
                details = """{"source":"fuel_log","sourceId":"f1"}""",
            )
            val store = OdometerStore(app, "a1")
            store.await { !it.loading }
            store.delete("r2")
            val state = store.await { it.actionError != null }
            assertEquals(odometerOwnerMessage("fuel_log"), state.actionError?.message)
            assertEquals(1, state.lines.size)

            server.on("DELETE", "/api/v1/odometer-readings/r2", "", HttpStatusCode.NoContent)
            store.dismissActionError()
            store.delete("r2")
            assertEquals(tr("vehicle_history_deleted_toast"), store.await { it.notice != null }.notice)
            store.close()
        }
}
