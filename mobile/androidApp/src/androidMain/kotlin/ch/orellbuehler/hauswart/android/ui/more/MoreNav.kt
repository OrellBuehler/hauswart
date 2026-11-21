package ch.orellbuehler.hauswart.android.ui.more

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import ch.orellbuehler.hauswart.android.ui.nav.Routes

fun NavGraphBuilder.moreGraph(nav: NavController) {
    composable(Routes.MORE) { MoreScreen(nav) }
    composable(Routes.SETTINGS) { SettingsScreen(nav) }
}
