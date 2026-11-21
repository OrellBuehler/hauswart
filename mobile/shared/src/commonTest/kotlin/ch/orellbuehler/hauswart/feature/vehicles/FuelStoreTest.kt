package ch.orellbuehler.hauswart.feature.vehicles

import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FuelStoreTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private suspend fun store(vehicle: String = vehicleJson(costBookId = "b2")): FuelLogStore {
        server.vehicleBasics(vehicle)
        server.on("GET", "/api/v1/assets/a1/vehicle/stats", statsJson())
        server.on(
            "GET",
            "/api/v1/assets/a1/fuel-logs",
            page(
                fuelLogJson("f2", consumption = 7.5),
                fuelLogJson(
                    "f1",
                    date = "2026-09-01",
                    odometer = 44400.0,
                    fullTank = false,
                    amountMinor = 0,
                    costEntryId = null,
                    bookId = null,
                ),
            ),
        )
        return FuelLogStore(app, "a1").also { it.await { s -> !s.loading } }
    }

    @Test
    fun panelsAndRowsShowConsumptionAndPrice() =
        runTest {
            val store = store()
            val state = store.value
            val panel = state.panels.single()
            assertEquals("7.5 l/100 km", panel.average)
            assertEquals(tr("fuel_stretches", "count" to 3), panel.stretches)
            assertEquals("CHF 1.839/l", panel.price)
            assertEquals(2, panel.priceSpark.size)
            assertEquals("01.08.2026 – 01.09.2026", panel.priceRange)
            val row = state.rows.first()
            assertEquals("40 l · 45'000 km", row.quantityLine)
            assertEquals("7.5 l/100 km · ${tr("fuel_stretch", "distance" to "600 km")} · CHF 0.120/km", row.stretchLine)
            assertEquals("Beispiel-Tankstelle · Auto", row.place)
            assertEquals("CHF 72.00", row.amountText)
            val free = state.rows.last()
            assertEquals(tr("fuel_free"), free.amountText)
            assertTrue(free.partial)
            assertNull(free.costEntryId)
            store.close()
        }

    @Test
    fun aNewFormStartsInTheVehiclesBookAndUnit() =
        runTest {
            val store = store(vehicleJson(costBookId = "b2", fuelType = "electric"))
            val form = store.blankForm()
            assertEquals("kWh", form.unit)
            assertEquals("b2", form.bookId)
            assertEquals("u1", form.paidByUserId)
            assertEquals(store.value.today, form.date)
            assertEquals(listOf("b1", "b2"), store.bookChoices(null).map { it.value }.filter { it != "b3" })
            assertTrue(store.view(form, null).showBook)
            assertTrue(!store.view(store.editForm("f1")!!.copy(amount = "0"), "f1").showBook)
            store.close()
        }

    @Test
    fun theFormIsCheckedBeforeSending() =
        runTest {
            val store = store()
            store.save(null, store.blankForm().copy(odometer = "", quantity = "0", amount = "abc"))
            val errors = store.await { it.fieldErrors.isNotEmpty() }.fieldErrors
            assertEquals(tr("m_field_required"), errors["odometer"])
            assertEquals(tr("fuel_error_quantity", "max" to "10'000"), errors["quantity"])
            assertEquals(tr("cost_amount_invalid", "decimals" to 2), errors["amountMinor"])
            assertTrue(server.requestsTo("POST", "/api/v1/assets/a1/fuel-logs").isEmpty())

            val custom =
                store.withShare(
                    store.withSplitMode(store.blankForm().copy(odometer = "45000", quantity = "40", amount = "72"), "custom"),
                    "u1",
                    "60",
                )
            store.save(null, custom)
            assertEquals(tr("cost_shares_sum", "total" to "60"), store.await { it.fieldErrors["shares"] != null }.fieldErrors["shares"])
            assertEquals(tr("cost_shares_missing", "percent" to "40"), store.view(custom, null).sharesStatus)
            store.close()
        }

    @Test
    fun recordingAFillSendsAmountsInMinorUnits() =
        runTest {
            val store = store()
            server.on("POST", "/api/v1/assets/a1/fuel-logs", fuelLogJson("f3"))
            store.save(
                null,
                store.blankForm().copy(odometer = "45'600", quantity = "38,5", amount = "69.30", station = " Beispiel ", fullTank = false),
            )
            store.await { it.done }
            val body = server.requestsTo("POST", "/api/v1/assets/a1/fuel-logs").single().json
            assertEquals(6930L, body["amountMinor"]?.jsonPrimitive?.longOrNull)
            assertEquals(38.5, body["quantity"]?.jsonPrimitive?.doubleOrNull)
            assertEquals(45600.0, body["odometer"]?.jsonPrimitive?.doubleOrNull)
            assertEquals("Beispiel", body["station"]?.jsonPrimitive?.content)
            assertEquals(false, body["fullTank"]?.jsonPrimitive?.booleanOrNull)
            assertEquals("b2", body["bookId"]?.jsonPrimitive?.content)
            assertEquals("ownership", body["splitMode"]?.jsonPrimitive?.content)
            assertNull(body["shares"])
            store.close()
        }

    @Test
    fun nobodyAsPayerSendsAnExplicitNull() =
        runTest {
            val store = store()
            server.on("POST", "/api/v1/assets/a1/fuel-logs", fuelLogJson("f3"))
            val form = store.blankForm().copy(odometer = "45600", quantity = "38", amount = "69.30")
            assertEquals("u1", form.paidByUserId)
            store.save(null, form.copy(paidByUserId = ""))
            store.await { it.done }
            val body = server.requestsTo("POST", "/api/v1/assets/a1/fuel-logs").single().json
            assertTrue("paidByUserId" in body)
            assertEquals(JsonNull, body["paidByUserId"])
            store.close()
        }

    @Test
    fun aChosenPayerIsSentAsHisId() =
        runTest {
            val store = store()
            server.on("POST", "/api/v1/assets/a1/fuel-logs", fuelLogJson("f3"))
            store.save(null, store.blankForm().copy(odometer = "45600", quantity = "38", amount = "69.30"))
            store.await { it.done }
            val body = server.requestsTo("POST", "/api/v1/assets/a1/fuel-logs").single().json
            assertEquals("u1", body["paidByUserId"]?.jsonPrimitive?.content)
            store.close()
        }

    @Test
    fun aCustomSplitSendsItsShares() =
        runTest {
            val store = store()
            server.on("POST", "/api/v1/assets/a1/fuel-logs", fuelLogJson("f3"))
            val form = store.withSplitMode(store.blankForm().copy(odometer = "45600", quantity = "40", amount = "70"), "custom")
            store.save(null, store.withShare(form, "u1", "100"))
            store.await { it.done }
            val shares =
                server
                    .requestsTo("POST", "/api/v1/assets/a1/fuel-logs")
                    .single()
                    .json["shares"]!!
                    .jsonArray
            assertEquals(
                "u1",
                shares
                    .single()
                    .jsonObject["userId"]
                    ?.jsonPrimitive
                    ?.content,
            )
            assertEquals(
                10000L,
                shares
                    .single()
                    .jsonObject["shareBps"]
                    ?.jsonPrimitive
                    ?.longOrNull,
            )
            store.close()
        }

    @Test
    fun aRefusedOdometerShowsUnderTheField() =
        runTest {
            val store = store()
            server.onError(
                "POST",
                "/api/v1/assets/a1/fuel-logs",
                HttpStatusCode.BadRequest,
                "invalid_request",
                details = """{"code":"higher_than_next","field":"odometer","reading":{"value":46000,"date":"2026-11-01"}}""",
            )
            store.save(null, store.blankForm().copy(odometer = "47000", quantity = "40", amount = "70"))
            val state = store.await { it.fieldErrors["odometer"] != null }
            assertEquals(
                tr("vehicle_odometer_refused_higher", "value" to "46'000 km", "date" to "01.11.2026"),
                state.fieldErrors["odometer"],
            )
            assertTrue(!state.saving)
            store.close()
        }

    @Test
    fun editingSendsOnlyWhatChanged() =
        runTest {
            val store = store()
            val form = store.editForm("f2")!!
            assertEquals("72.00", form.amount)
            store.save("f2", form)
            store.await { it.done }
            assertTrue(server.requestsTo("PATCH", "/api/v1/fuel-logs/f2").isEmpty())

            store.ackDone()
            server.on("PATCH", "/api/v1/fuel-logs/f2", fuelLogJson("f2"))
            store.save("f2", form.copy(amount = "75.50", station = "", paidByUserId = ""))
            store.await { it.done }
            val body = server.requestsTo("PATCH", "/api/v1/fuel-logs/f2").single().json
            assertEquals(7550L, body["amountMinor"]?.jsonPrimitive?.longOrNull)
            assertEquals(JsonNull, body["station"])
            assertEquals(JsonNull, body["paidByUserId"])
            assertNull(body["odometer"])
            assertNull(body["bookId"])
            store.close()
        }

    @Test
    fun deletingReportsAndLoadingMoreAppends() =
        runTest {
            val store = store()
            server.on("DELETE", "/api/v1/fuel-logs/f2", "", HttpStatusCode.NoContent)
            store.delete("f2")
            assertEquals(tr("fuel_deleted_toast"), store.await { it.notice != null }.notice)
            server.on(
                "GET",
                "/api/v1/assets/a1/fuel-logs",
                """{"items":[${fuelLogJson("f2")}],"nextCursor":"n1"}""",
            )
            store.refresh()
            store.await { it.hasMore }
            server.on("GET", "/api/v1/assets/a1/fuel-logs", page(fuelLogJson("f0", date = "2026-05-01")))
            store.loadMore()
            val state = store.await { it.rows.size == 2 }
            assertTrue(!state.hasMore)
            store.close()
        }
}
