package ch.orellbuehler.hauswart.android.ui.nav

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Construction
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import ch.orellbuehler.hauswart.android.ui.appointments.appointmentsGraph
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.EmptyState
import ch.orellbuehler.hauswart.android.ui.costs.costsGraph
import ch.orellbuehler.hauswart.android.ui.defects.defectsGraph
import ch.orellbuehler.hauswart.android.ui.docs.docsGraph
import ch.orellbuehler.hauswart.android.ui.documents.documentsGraph
import ch.orellbuehler.hauswart.android.ui.emergency.EmergencyScreen
import ch.orellbuehler.hauswart.android.ui.insurance.insuranceGraph
import ch.orellbuehler.hauswart.android.ui.inventory.inventoryGraph
import ch.orellbuehler.hauswart.android.ui.notifications.notificationsGraph
import ch.orellbuehler.hauswart.android.ui.parts.partsGraph
import ch.orellbuehler.hauswart.android.ui.search.searchGraph
import ch.orellbuehler.hauswart.android.ui.settings.settingsGraph
import ch.orellbuehler.hauswart.android.ui.tasks.tasksGraph
import ch.orellbuehler.hauswart.android.ui.vehicles.vehiclesGraph
import ch.orellbuehler.hauswart.i18n.tr

private val idArg = listOf(navArgument("id") { type = NavType.StringType })

/**
 * The destinations whose feature has no screen yet, so that every link resolves. A feature replaces
 * its own lines with its `<feature>Graph(nav)` call in `HauswartRoot`.
 */
fun NavGraphBuilder.featureGraphs(nav: NavController) {
    // Tasks
    tasksGraph(nav)

    // Appointments
    appointmentsGraph(nav)

    // Inventory, rooms, plants, warranties
    inventoryGraph(nav)

    // Documentation
    docsGraph(nav)

    // Documents (Paperless)
    documentsGraph(nav)

    // Defects
    defectsGraph(nav)

    // Parts
    partsGraph(nav)

    // Emergency
    composable(Routes.EMERGENCY) { EmergencyScreen(nav) }

    // Insurance
    insuranceGraph(nav)

    // Costs
    costsGraph(nav)

    // Notifications
    notificationsGraph(nav)

    // Search
    searchGraph(nav)

    // Vehicles: odometer, tire sets, fuel log, statistics, details, task setup
    vehiclesGraph(nav)
    // Settings sub-screens
    settingsGraph(nav)
}

/** [titleKey] is the message key of the section's name; a [root] screen is a tab and has no back arrow. */
@Composable
private fun ComingSoon(
    nav: NavController,
    titleKey: String,
    root: Boolean = false,
) {
    AppScaffold(title = tr(titleKey), onBack = if (root) null else ({ nav.popBackStack() })) { padding ->
        EmptyState(
            title = tr("m_coming_soon"),
            body = tr("m_coming_soon_body"),
            icon = Icons.Outlined.Construction,
            modifier = Modifier.padding(padding).padding(top = 48.dp),
        )
    }
}
