package ch.orellbuehler.hauswart.feature.vehicles

import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class VehicleStatsStoreTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    @Test
    fun theCurrentYearIsShownWithCategoriesAndMonths() =
        runTest {
            server.vehicleBasics()
            server.on("GET", "/api/v1/assets/a1/vehicle/stats", statsJson(otherCurrency = 2))
            val store = VehicleStatsStore(app, "a1")
            val state = store.await { !it.loading && it.year != 0 }
            assertEquals(
                app.household
                    .today()
                    .take(4)
                    .toInt(),
                state.year,
            )
            assertEquals("CHF 2'500.00", state.totalText)
            assertEquals("12'000 km", state.distanceText)
            assertEquals("CHF 0.208/km", state.perDistanceText)
            assertEquals(listOf("50 %", "25 %"), state.categories.map { it.percentText })
            assertEquals(0.5, state.categories.first().share)
            assertEquals(tr("vehicle_costs_other_currency", "count" to 2, "currency" to "CHF"), state.otherCurrencyText)
            assertEquals(listOf("01.26", "02.26"), state.months.map { it.label })
            assertEquals(0.5, state.months.first().fraction)
            assertEquals("Service", state.tasks.single().title)
            assertEquals("01.12.2026", state.tasks.single().dateText)
            assertTrue(state.years.size >= 4)
            store.close()
        }

    @Test
    fun anotherYearIsLoadedOnDemand() =
        runTest {
            server.vehicleBasics()
            server.on("GET", "/api/v1/assets/a1/vehicle/stats", statsJson())
            val store = VehicleStatsStore(app, "a1")
            store.await { !it.loading && it.year != 0 }
            server.on("GET", "/api/v1/assets/a1/vehicle/stats", statsJson(year = 2024, distance = 0.0, totalMinor = 0, count = 0))
            store.selectYear(2024)
            val state = store.await { it.year == 2024 && !it.yearLoading }
            assertTrue(state.empty)
            assertTrue(
                server
                    .requestsTo("GET", "/api/v1/assets/a1/vehicle/stats")
                    .last()
                    .query
                    .contains("year=2024"),
            )
            store.close()
        }
}
