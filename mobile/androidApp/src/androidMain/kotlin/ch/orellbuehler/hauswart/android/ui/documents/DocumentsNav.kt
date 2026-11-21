package ch.orellbuehler.hauswart.android.ui.documents

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import ch.orellbuehler.hauswart.android.ui.nav.Routes

private const val DOCUMENT_ROUTE = "documents/{id}"
private const val SUGGESTIONS_ROUTE = "documents/suggestions/{kind}"

fun NavGraphBuilder.documentsGraph(nav: NavController) {
    composable(Routes.DOCUMENTS) { DocumentsScreen(nav) }
    composable(SUGGESTIONS_ROUTE, arguments = listOf(navArgument("kind") { type = NavType.StringType })) { entry ->
        DocumentSuggestionsScreen(nav, requireNotNull(entry.arguments?.getString("kind")))
    }
    composable(DOCUMENT_ROUTE, arguments = listOf(navArgument("id") { type = NavType.StringType })) { entry ->
        DocumentDetailScreen(nav, requireNotNull(entry.arguments?.getString("id")))
    }
}

internal fun NavController.openDocument(id: String) = navigate("documents/${Routes.arg(id)}")

internal fun NavController.openSuggestions(kind: String) = navigate("documents/suggestions/${Routes.arg(kind)}")
