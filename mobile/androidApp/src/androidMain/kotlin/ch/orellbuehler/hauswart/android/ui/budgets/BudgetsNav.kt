package ch.orellbuehler.hauswart.android.ui.budgets

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import ch.orellbuehler.hauswart.android.ui.nav.Routes

private const val BUDGET_EDIT = "costs/budgets/edit?id={id}&period={period}"

private fun optional(name: String) =
    navArgument(name) {
        type = NavType.StringType
        nullable = true
        defaultValue = null
    }

fun NavGraphBuilder.budgetsGraph(nav: NavController) {
    composable(Routes.COSTS_BUDGETS) { BudgetsScreen(nav) }
    composable(BUDGET_EDIT, arguments = listOf(optional("id"), optional("period"))) { entry ->
        BudgetEditScreen(
            nav,
            entry.arguments?.getString("id")?.takeIf { it.isNotEmpty() },
            entry.arguments?.getString("period")?.takeIf { it.isNotEmpty() },
        )
    }
}

internal fun NavController.openBudgetEdit(
    id: String?,
    period: String? = null,
) = navigate(
    "costs/budgets/edit?" +
        listOfNotNull(id?.let { "id=${Routes.arg(it)}" }, period?.let { "period=${Routes.arg(it)}" }).joinToString("&"),
)
