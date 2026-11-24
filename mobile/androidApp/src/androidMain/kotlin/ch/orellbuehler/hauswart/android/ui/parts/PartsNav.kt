package ch.orellbuehler.hauswart.android.ui.parts

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import ch.orellbuehler.hauswart.android.ui.nav.Routes

fun NavGraphBuilder.partsGraph(nav: NavController) {
    composable(Routes.PARTS) { PartsScreen(nav) }
    composable(Routes.PART_ROUTE, arguments = listOf(navArgument("id") { type = NavType.StringType })) { entry ->
        PartDetailScreen(nav, requireNotNull(entry.arguments?.getString("id")))
    }
}
