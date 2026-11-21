package ch.orellbuehler.hauswart.android.ui.recurring

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import ch.orellbuehler.hauswart.android.ui.nav.Routes

private const val RECURRING_EDIT = "costs/recurring-edit?id={id}&book={book}"

private fun optional(name: String) =
    navArgument(name) {
        type = NavType.StringType
        nullable = true
        defaultValue = null
    }

fun NavGraphBuilder.recurringGraph(nav: NavController) {
    composable(Routes.COSTS_RECURRING) { RecurringScreen(nav) }
    composable(Routes.RECURRING_ROUTE, arguments = listOf(navArgument("id") { type = NavType.StringType })) { entry ->
        RecurringDetailScreen(nav, requireNotNull(entry.arguments?.getString("id")))
    }
    composable(RECURRING_EDIT, arguments = listOf(optional("id"), optional("book"))) { entry ->
        RecurringEditScreen(
            nav,
            entry.arguments?.getString("id")?.takeIf { it.isNotEmpty() },
            entry.arguments?.getString("book")?.takeIf { it.isNotEmpty() },
        )
    }
}

internal fun NavController.openRecurringEdit(
    id: String?,
    book: String? = null,
) = navigate(
    "costs/recurring-edit?" +
        listOfNotNull(id?.let { "id=${Routes.arg(it)}" }, book?.let { "book=${Routes.arg(it)}" }).joinToString("&"),
)
