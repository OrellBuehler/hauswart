package ch.orellbuehler.hauswart.android.ui.search

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import ch.orellbuehler.hauswart.android.ui.nav.Routes

fun NavGraphBuilder.searchGraph(nav: NavController) {
    composable(Routes.SEARCH) { SearchScreen(nav) }
}
