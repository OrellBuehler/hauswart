package ch.orellbuehler.hauswart.android.ui.notifications

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import ch.orellbuehler.hauswart.android.ui.nav.Routes

fun NavGraphBuilder.notificationsGraph(nav: NavController) {
    composable(Routes.NOTIFICATIONS) { NotificationsScreen(nav) }
}
