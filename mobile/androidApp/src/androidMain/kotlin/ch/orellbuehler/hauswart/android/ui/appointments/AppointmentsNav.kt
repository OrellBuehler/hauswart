package ch.orellbuehler.hauswart.android.ui.appointments

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import ch.orellbuehler.hauswart.android.ui.nav.Routes

private val idArgument = listOf(navArgument("id") { type = NavType.StringType })

private val newArguments =
    listOf("taskId", "assetId", "contactId", "occurrenceKey").map { name ->
        navArgument(name) {
            type = NavType.StringType
            defaultValue = ""
        }
    }

fun NavGraphBuilder.appointmentsGraph(nav: NavController) {
    composable(Routes.APPOINTMENTS) { AppointmentsScreen(nav) }
    composable(Routes.APPOINTMENT_NEW_ROUTE, arguments = newArguments) { entry ->
        val args = entry.arguments
        AppointmentEditScreen(
            nav = nav,
            id = "",
            taskId = args?.getString("taskId").orEmpty(),
            assetId = args?.getString("assetId").orEmpty(),
            contactId = args?.getString("contactId").orEmpty(),
            occurrenceKey = args?.getString("occurrenceKey").orEmpty(),
        )
    }
    composable(Routes.APPOINTMENT_ROUTE, arguments = idArgument) { entry ->
        AppointmentDetailScreen(nav, requireNotNull(entry.arguments?.getString("id")))
    }
    composable(Routes.APPOINTMENT_EDIT_ROUTE, arguments = idArgument) { entry ->
        AppointmentEditScreen(nav, requireNotNull(entry.arguments?.getString("id")), "", "", "", "")
    }
}
