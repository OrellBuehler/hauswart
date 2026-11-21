package ch.orellbuehler.hauswart.android.ui.defects

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import ch.orellbuehler.hauswart.android.ui.nav.Routes

private const val DEFECT_EDIT = "defects/{id}/edit"

private val idArgument = listOf(navArgument("id") { type = NavType.StringType })
private val newArguments =
    listOf("assetId", "roomId").map { name ->
        navArgument(name) {
            type = NavType.StringType
            nullable = true
            defaultValue = null
        }
    }

fun NavGraphBuilder.defectsGraph(nav: NavController) {
    composable(Routes.DEFECTS) { DefectsScreen(nav) }
    composable(Routes.DEFECT_NEW_ROUTE, arguments = newArguments) { entry ->
        DefectEditScreen(nav, null, entry.arguments?.getString("assetId"), entry.arguments?.getString("roomId"))
    }
    composable(Routes.DEFECT_ROUTE, arguments = idArgument) { entry ->
        DefectDetailScreen(nav, requireNotNull(entry.arguments?.getString("id")))
    }
    composable(DEFECT_EDIT, arguments = idArgument) { entry ->
        DefectEditScreen(nav, requireNotNull(entry.arguments?.getString("id")), null, null)
    }
}

internal fun NavController.openDefectEdit(id: String) = navigate("defects/${Routes.arg(id)}/edit")
