package ch.orellbuehler.hauswart.android.ui.inventory

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import ch.orellbuehler.hauswart.android.ui.nav.Routes

private const val ASSET_EDIT = "assets/{id}/edit"

private val idArgument = listOf(navArgument("id") { type = NavType.StringType })
private val newAssetArguments =
    listOf(
        navArgument("kind") {
            type = NavType.StringType
            nullable = true
            defaultValue = null
        },
        navArgument("roomId") {
            type = NavType.StringType
            nullable = true
            defaultValue = null
        },
    )

/** Inventory, plants, rooms, warranties and the asset screens. */
fun NavGraphBuilder.inventoryGraph(nav: NavController) {
    composable(Routes.INVENTORY) { InventoryScreen(nav) }
    composable(Routes.PLANTS) { PlantsScreen(nav) }
    composable(Routes.ROOMS) { RoomsScreen(nav) }
    composable(Routes.WARRANTIES) { WarrantiesScreen(nav) }
    composable(Routes.ASSET_NEW_ROUTE, arguments = newAssetArguments) { entry ->
        AssetEditScreen(nav, null, entry.arguments?.getString("kind"), entry.arguments?.getString("roomId"))
    }
    composable(Routes.ASSET_ROUTE, arguments = idArgument) { entry ->
        AssetDetailScreen(nav, requireNotNull(entry.arguments?.getString("id")))
    }
    composable(ASSET_EDIT, arguments = idArgument) { entry ->
        AssetEditScreen(nav, requireNotNull(entry.arguments?.getString("id")), null, null)
    }
    composable(Routes.ROOM_ROUTE, arguments = idArgument) { entry ->
        RoomDetailScreen(nav, requireNotNull(entry.arguments?.getString("id")))
    }
}

internal fun NavController.openAssetEdit(id: String) = navigate("assets/${Routes.arg(id)}/edit")
