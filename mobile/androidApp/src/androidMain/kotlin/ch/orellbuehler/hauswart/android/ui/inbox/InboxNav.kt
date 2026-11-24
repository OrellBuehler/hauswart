package ch.orellbuehler.hauswart.android.ui.inbox

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import ch.orellbuehler.hauswart.android.ui.nav.Routes

private const val INBOX_ACCEPT = "costs/inbox/{id}/accept"

fun NavGraphBuilder.inboxGraph(nav: NavController) {
    composable(Routes.COSTS_INBOX) { InboxScreen(nav) }
    composable(INBOX_ACCEPT, arguments = listOf(navArgument("id") { type = NavType.StringType })) { entry ->
        SuggestionAcceptScreen(nav, requireNotNull(entry.arguments?.getString("id")))
    }
}

internal fun NavController.openSuggestionAccept(id: String) = navigate("costs/inbox/${Routes.arg(id)}/accept")
