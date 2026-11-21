package ch.orellbuehler.hauswart.android.ui.costs

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import ch.orellbuehler.hauswart.android.ui.nav.Routes

private const val COST_EDIT = "costs/entry/{id}/edit"
private const val SETTLEMENT = "costs/settlement?id={id}&from={from}&to={to}&amount={amount}&book={book}"

private val idArgument = listOf(navArgument("id") { type = NavType.StringType })

private fun optional(name: String) =
    navArgument(name) {
        type = NavType.StringType
        nullable = true
        defaultValue = null
    }

private fun androidx.navigation.NavBackStackEntry.text(name: String): String? = arguments?.getString(name)?.takeIf { it.isNotEmpty() }

fun NavGraphBuilder.costsGraph(nav: NavController) {
    composable(Routes.COSTS) { CostsScreen(nav) }
    composable(Routes.COST_ROUTE, arguments = idArgument) { entry ->
        CostDetailScreen(nav, requireNotNull(entry.text("id")))
    }
    composable(COST_EDIT, arguments = idArgument) { entry ->
        CostEditScreen(nav, requireNotNull(entry.text("id")), null, null)
    }
    composable(Routes.COST_NEW_ROUTE, arguments = listOf(optional("book"), optional("asset"))) { entry ->
        CostEditScreen(nav, null, entry.text("book"), entry.text("asset"))
    }
    composable(Routes.COSTS_QUICK_ROUTE, arguments = listOf(optional("book"))) { entry ->
        QuickEntryScreen(nav, entry.text("book"))
    }
    composable(Routes.COSTS_BALANCES_ROUTE, arguments = listOf(optional("book"))) { entry ->
        BalancesScreen(nav, entry.text("book"))
    }
    composable(
        SETTLEMENT,
        arguments = listOf(optional("id"), optional("from"), optional("to"), optional("amount"), optional("book")),
    ) { entry ->
        SettlementEditScreen(nav, entry.text("id"), entry.text("from"), entry.text("to"), entry.text("amount"), entry.text("book"))
    }
}

internal fun NavController.openCostEdit(id: String) = navigate("costs/entry/${Routes.arg(id)}/edit")

/** The form of a payment: [id] edits one, otherwise [from], [to] and [amount] start a new one. */
internal fun NavController.openSettlement(
    id: String? = null,
    from: String? = null,
    to: String? = null,
    amount: String? = null,
    bookArg: String? = null,
) = navigate(
    "costs/settlement?" +
        listOfNotNull(
            id?.let { "id=${Routes.arg(it)}" },
            from?.let { "from=${Routes.arg(it)}" },
            to?.let { "to=${Routes.arg(it)}" },
            amount?.let { "amount=${Routes.arg(it)}" },
            bookArg?.let { "book=${Routes.arg(it)}" },
        ).joinToString("&"),
)
