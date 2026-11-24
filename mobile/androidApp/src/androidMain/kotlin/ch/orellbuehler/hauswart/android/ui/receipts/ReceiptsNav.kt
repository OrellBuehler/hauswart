package ch.orellbuehler.hauswart.android.ui.receipts

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import ch.orellbuehler.hauswart.android.ui.nav.Routes

private const val RECEIPT_SUBMIT = "costs/receipts-submit"

fun NavGraphBuilder.receiptsGraph(nav: NavController) {
    composable(
        Routes.COSTS_RECEIPTS_ROUTE,
        arguments =
            listOf(
                navArgument("status") {
                    type = NavType.StringType
                    nullable = true
                    defaultValue = null
                },
            ),
    ) { entry ->
        ReceiptsScreen(nav, entry.arguments?.getString("status")?.takeIf { it.isNotEmpty() })
    }
    composable(RECEIPT_SUBMIT) { ReceiptSubmitScreen(nav) }
}

internal fun NavController.openReceiptSubmit() = navigate(RECEIPT_SUBMIT)
