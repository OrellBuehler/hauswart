package ch.orellbuehler.hauswart.android.ui.costbooks

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import ch.orellbuehler.hauswart.android.ui.nav.Routes

private const val BOOK_EDIT = "costs/books/edit?id={id}"
private const val TAG_EDIT = "costs/tags/edit?id={id}"

private fun optionalId() =
    listOf(
        navArgument("id") {
            type = NavType.StringType
            nullable = true
            defaultValue = null
        },
    )

fun NavGraphBuilder.costBooksGraph(nav: NavController) {
    composable(Routes.COST_BOOKS) { CostBooksScreen(nav) }
    composable(BOOK_EDIT, arguments = optionalId()) { entry ->
        BookEditScreen(nav, entry.arguments?.getString("id")?.takeIf { it.isNotEmpty() })
    }
    composable(Routes.COST_TAGS) { CostTagsScreen(nav) }
    composable(TAG_EDIT, arguments = optionalId()) { entry ->
        TagEditScreen(nav, entry.arguments?.getString("id")?.takeIf { it.isNotEmpty() })
    }
}

internal fun NavController.openBookEdit(id: String?) = navigate("costs/books/edit" + (id?.let { "?id=${Routes.arg(it)}" } ?: ""))

internal fun NavController.openTagEdit(id: String?) = navigate("costs/tags/edit" + (id?.let { "?id=${Routes.arg(it)}" } ?: ""))
