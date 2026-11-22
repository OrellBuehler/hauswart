package ch.orellbuehler.hauswart.android.ui.insurance

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import ch.orellbuehler.hauswart.android.ui.nav.Routes

private const val INSURANCE_NEW = "insurance-new?assetId={assetId}&type={type}"
private const val INSURANCE_EDIT = "insurance/{id}/edit"

private val idArgument = listOf(navArgument("id") { type = NavType.StringType })
private val newArguments =
    listOf("assetId", "type").map { name ->
        navArgument(name) {
            type = NavType.StringType
            nullable = true
            defaultValue = null
        }
    }

fun NavGraphBuilder.insuranceGraph(nav: NavController) {
    composable(Routes.INSURANCE) { InsuranceScreen(nav) }
    composable(INSURANCE_NEW, arguments = newArguments) { entry ->
        InsuranceEditScreen(nav, null, entry.arguments?.getString("assetId").orEmpty(), entry.arguments?.getString("type").orEmpty())
    }
    composable(Routes.INSURANCE_ROUTE, arguments = idArgument) { entry ->
        InsuranceDetailScreen(nav, requireNotNull(entry.arguments?.getString("id")))
    }
    composable(INSURANCE_EDIT, arguments = idArgument) { entry ->
        InsuranceEditScreen(nav, requireNotNull(entry.arguments?.getString("id")), "", "")
    }
}

internal fun NavController.openInsuranceNew() = navigate("insurance-new")

internal fun NavController.openInsuranceEdit(id: String) = navigate("insurance/${Routes.arg(id)}/edit")
