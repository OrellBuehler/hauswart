package ch.orellbuehler.hauswart.android.ui.tasks

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import ch.orellbuehler.hauswart.android.ui.nav.Routes

private const val TASK_EDIT = "tasks/{id}/edit"

private val idArgument = listOf(navArgument("id") { type = NavType.StringType })
private val assetArgument =
    listOf(
        navArgument("assetId") {
            type = NavType.StringType
            nullable = true
            defaultValue = null
        },
    )

fun NavGraphBuilder.tasksGraph(nav: NavController) {
    composable(Routes.TASKS) { TasksScreen(nav) }
    composable(
        Routes.TASK_NEW_ROUTE,
        arguments = assetArgument,
    ) { entry -> TaskEditScreen(nav, null, entry.arguments?.getString("assetId")) }
    composable(
        Routes.TASK_ROUTE,
        arguments = idArgument,
    ) { entry -> TaskDetailScreen(nav, requireNotNull(entry.arguments?.getString("id"))) }
    composable(TASK_EDIT, arguments = idArgument) { entry -> TaskEditScreen(nav, requireNotNull(entry.arguments?.getString("id")), null) }
}

internal fun NavController.openTaskEdit(id: String) = navigate("tasks/${Routes.arg(id)}/edit")
