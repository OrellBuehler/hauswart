package ch.orellbuehler.hauswart.android.ui.vehicles

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import ch.orellbuehler.hauswart.android.ui.nav.Routes

private const val ODOMETER = "vehicles/{id}/odometer"
private const val TIRES = "vehicles/{id}/tires"
private const val TIRE_SET = "vehicles/{id}/tires/{setId}"
private const val FUEL = "vehicles/{id}/fuel"
private const val STATS = "vehicles/{id}/stats"
private const val EDIT = "vehicles/{id}/edit"
private const val SETUP = "vehicles/{id}/setup"

private val idArgument = listOf(navArgument("id") { type = NavType.StringType })
private val setArguments = listOf(navArgument("id") { type = NavType.StringType }, navArgument("setId") { type = NavType.StringType })

/** The vehicle screens: odometer, tire sets, fuel log, statistics, details and the task setup. */
fun NavGraphBuilder.vehiclesGraph(nav: NavController) {
    composable(ODOMETER, arguments = idArgument) { OdometerScreen(nav, requireNotNull(it.arguments?.getString("id"))) }
    composable(TIRES, arguments = idArgument) { TireSetsScreen(nav, requireNotNull(it.arguments?.getString("id"))) }
    composable(TIRE_SET, arguments = setArguments) { TireSetDetailScreen(nav, requireNotNull(it.arguments?.getString("setId"))) }
    composable(FUEL, arguments = idArgument) { FuelLogScreen(nav, requireNotNull(it.arguments?.getString("id"))) }
    composable(STATS, arguments = idArgument) { VehicleStatsScreen(nav, requireNotNull(it.arguments?.getString("id"))) }
    composable(EDIT, arguments = idArgument) { VehicleEditScreen(nav, requireNotNull(it.arguments?.getString("id"))) }
    composable(SETUP, arguments = idArgument) { VehicleSetupScreen(nav, requireNotNull(it.arguments?.getString("id"))) }
}

internal fun NavController.openOdometer(assetId: String) = navigate("vehicles/${Routes.arg(assetId)}/odometer")

internal fun NavController.openTireSets(assetId: String) = navigate("vehicles/${Routes.arg(assetId)}/tires")

internal fun NavController.openTireSet(
    assetId: String,
    setId: String,
) = navigate("vehicles/${Routes.arg(assetId)}/tires/${Routes.arg(setId)}")

internal fun NavController.openFuelLog(assetId: String) = navigate("vehicles/${Routes.arg(assetId)}/fuel")

internal fun NavController.openVehicleStats(assetId: String) = navigate("vehicles/${Routes.arg(assetId)}/stats")

internal fun NavController.openVehicleEdit(assetId: String) = navigate("vehicles/${Routes.arg(assetId)}/edit")

internal fun NavController.openVehicleSetup(assetId: String) = navigate("vehicles/${Routes.arg(assetId)}/setup")
