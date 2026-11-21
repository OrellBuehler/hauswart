package ch.orellbuehler.hauswart.feature.vehicles

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
import kotlin.test.assertNull
import kotlin.test.assertTrue

class VehicleStoresTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    @Test
    fun theSectionSummarisesTheVehicle() =
        runTest {
            server.vehicleBasics(vehicleJson(costBookId = "b1", vin = "WVWZZZ"))
            val store = VehicleSectionStore(app, "a1")
            val state = store.await { !it.loading }
            assertEquals("ZH 123456", state.plate)
            assertEquals("45'200 km", state.odometer)
            assertEquals(tr("vehicle_odometer_as_of", "date" to "01.10.2026"), state.odometerDate)
            assertEquals(
                listOf(
                    tr("vehicle_vin"),
                    tr("vehicle_first_registration"),
                    tr("vehicle_fuel"),
                    tr("vehicle_tire_summer"),
                    tr("vehicle_tire_winter"),
                    tr("vehicle_cost_book"),
                ),
                state.facts.map { it.label },
            )
            assertEquals("Auto", state.facts.last().value)
            store.close()
        }

    @Test
    fun anAssetOfAnotherKindShowsNothing() =
        runTest {
            val store = VehicleSectionStore(app, "a2")
            val state = store.await { !it.loading }
            assertTrue(state.notVehicle)
            assertNull(state.error)
            store.close()
        }

    @Test
    fun aFailureOfTheSectionIsReported() =
        runTest {
            server.onError("GET", "/api/v1/assets/a1/vehicle", HttpStatusCode.InternalServerError, "internal_error")
            val store = VehicleSectionStore(app, "a1")
            val state = store.await { !it.loading }
            assertEquals(tr("m_error_server"), state.error?.message)
            assertTrue(!state.notVehicle)
            store.close()
        }

    @Test
    fun theDetailsFormOffersTheOpenBooksAndTheCurrentOne() =
        runTest {
            server.vehicleBasics(vehicleJson(costBookId = "b3"))
            val store = VehicleEditStore(app, "a1")
            val state = store.await { !it.loading }
            assertEquals("ZH 123456", state.initial?.plate)
            assertEquals("b3", state.initial?.costBookId)
            assertEquals(
                listOf("", "b1", "b2", "b3"),
                state.books.map { it.value },
            )
            assertEquals(tr("vehicle_cost_book_default", "name" to "Auto"), state.books.first().label)
            assertEquals(tr("cost_book_archived_option", "name" to "Alt"), state.books.last().label)
            assertEquals("", state.fuelTypes.first().value)
            store.close()
        }

    @Test
    fun savingReplacesTheDetailsAndClearsWhatIsEmpty() =
        runTest {
            server.vehicleBasics()
            val store = VehicleEditStore(app, "a1")
            val form = store.await { !it.loading }.initial!!
            server.on("PUT", "/api/v1/assets/a1/vehicle", vehicleJson())
            store.save(form.copy(plate = " ZH 999999 ", vin = "", fuelType = "", odometerUnit = "mi"))
            store.await { it.saved }
            val body = server.requestsTo("PUT", "/api/v1/assets/a1/vehicle").single().json
            assertEquals("ZH 999999", body["plate"]?.jsonPrimitive?.content)
            assertEquals(JsonNull, body["vin"])
            assertEquals(JsonNull, body["fuelType"])
            assertEquals(JsonNull, body["costBookId"])
            assertEquals("mi", body["odometerUnit"]?.jsonPrimitive?.content)
            assertEquals("2019-05-03", body["firstRegistration"]?.jsonPrimitive?.content)
            store.close()
        }

    @Test
    fun badInputAndAClosedBookAreReportedOnTheirFields() =
        runTest {
            server.vehicleBasics()
            val store = VehicleEditStore(app, "a1")
            val form = store.await { !it.loading }.initial!!
            store.save(form.copy(firstRegistration = "03.05.2019", plate = "x".repeat(40)))
            val state = store.await { it.fieldErrors.isNotEmpty() }
            assertEquals(setOf("firstRegistration", "plate"), state.fieldErrors.keys)
            assertTrue(server.requestsTo("PUT", "/api/v1/assets/a1/vehicle").isEmpty())

            server.onError(
                "PUT",
                "/api/v1/assets/a1/vehicle",
                HttpStatusCode.BadRequest,
                "invalid_request",
                details = """{"body":{"formErrors":[],"fieldErrors":{"costBookId":["Book is archived"]}}}""",
            )
            store.save(form.copy(costBookId = "b3"))
            assertEquals(tr("vehicle_cost_book_closed"), store.await { it.fieldErrors["costBookId"] != null }.fieldErrors["costBookId"])
            store.close()
        }
}
