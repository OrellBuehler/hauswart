package ch.orellbuehler.hauswart.android.ui.settings

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import ch.orellbuehler.hauswart.android.ui.nav.Routes

/** The sub-screens of the settings: the list itself is `SettingsScreen` in the "more" graph. */
fun NavGraphBuilder.settingsGraph(nav: NavController) {
    composable(Routes.SETTINGS_NOTIFICATIONS) { NotificationSettingsScreen(nav) }
    composable(Routes.SETTINGS_REMINDERS) { ReminderSettingsScreen(nav) }
    composable(Routes.SETTINGS_HOUSEHOLD) { HouseholdSettingsScreen(nav) }
    composable(Routes.SETTINGS_INTEGRATIONS) { IntegrationsScreen(nav) }
    composable(Routes.SETTINGS_INTEGRATION_ROUTE, arguments = listOf(navArgument("kind") { type = NavType.StringType })) { entry ->
        IntegrationScreen(nav, requireNotNull(entry.arguments?.getString("kind")))
    }
    composable(Routes.SETTINGS_CALENDAR) { CalendarTargetsScreen(nav) }
}

/** The route of the settings sub-screen a `SettingsEntry.id` names. */
fun settingsRoute(id: String): String? =
    when (id) {
        "notifications" -> Routes.SETTINGS_NOTIFICATIONS
        "reminders" -> Routes.SETTINGS_REMINDERS
        "household" -> Routes.SETTINGS_HOUSEHOLD
        "integrations" -> Routes.SETTINGS_INTEGRATIONS
        "calendar" -> Routes.SETTINGS_CALENDAR
        else -> null
    }
