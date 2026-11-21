package ch.orellbuehler.hauswart.android.ui.dashboard

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import ch.orellbuehler.hauswart.android.ui.nav.Routes

fun NavGraphBuilder.dashboardGraph(nav: NavController) {
    composable(Routes.HOME) { HomeScreen(nav) }
}
