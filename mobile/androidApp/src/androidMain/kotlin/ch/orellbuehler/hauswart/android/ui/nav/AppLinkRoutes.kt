package ch.orellbuehler.hauswart.android.ui.nav

import androidx.navigation.NavController
import androidx.navigation.NavGraph.Companion.findStartDestination
import ch.orellbuehler.hauswart.feature.applink.AppLink
import ch.orellbuehler.hauswart.feature.applink.LINK_APPOINTMENT
import ch.orellbuehler.hauswart.feature.applink.LINK_APPOINTMENTS
import ch.orellbuehler.hauswart.feature.applink.LINK_ASSET
import ch.orellbuehler.hauswart.feature.applink.LINK_CONTACT
import ch.orellbuehler.hauswart.feature.applink.LINK_CONTACTS
import ch.orellbuehler.hauswart.feature.applink.LINK_COST
import ch.orellbuehler.hauswart.feature.applink.LINK_COSTS
import ch.orellbuehler.hauswart.feature.applink.LINK_DEFECT
import ch.orellbuehler.hauswart.feature.applink.LINK_DEFECTS
import ch.orellbuehler.hauswart.feature.applink.LINK_DOC
import ch.orellbuehler.hauswart.feature.applink.LINK_DOCS
import ch.orellbuehler.hauswart.feature.applink.LINK_DOCUMENTS
import ch.orellbuehler.hauswart.feature.applink.LINK_EMERGENCY
import ch.orellbuehler.hauswart.feature.applink.LINK_HOME
import ch.orellbuehler.hauswart.feature.applink.LINK_INSURANCE
import ch.orellbuehler.hauswart.feature.applink.LINK_INVENTORY
import ch.orellbuehler.hauswart.feature.applink.LINK_NOTIFICATIONS
import ch.orellbuehler.hauswart.feature.applink.LINK_PART
import ch.orellbuehler.hauswart.feature.applink.LINK_PARTS
import ch.orellbuehler.hauswart.feature.applink.LINK_PLANTS
import ch.orellbuehler.hauswart.feature.applink.LINK_POLICY
import ch.orellbuehler.hauswart.feature.applink.LINK_ROOM
import ch.orellbuehler.hauswart.feature.applink.LINK_ROOMS
import ch.orellbuehler.hauswart.feature.applink.LINK_SEARCH
import ch.orellbuehler.hauswart.feature.applink.LINK_SETTINGS
import ch.orellbuehler.hauswart.feature.applink.LINK_TASK
import ch.orellbuehler.hauswart.feature.applink.LINK_TASKS
import ch.orellbuehler.hauswart.feature.applink.LINK_WARRANTIES

/** The route an [AppLink] (from a notification or a search hit) opens; null for a kind that has no screen here. */
fun routeOf(link: AppLink): String? {
    val id = link.id.orEmpty()
    return when (link.kind) {
        LINK_HOME -> Routes.HOME
        LINK_TASKS -> Routes.TASKS
        LINK_TASK -> Routes.task(id)
        LINK_APPOINTMENTS -> Routes.APPOINTMENTS
        LINK_APPOINTMENT -> Routes.appointment(id)
        LINK_INVENTORY -> Routes.INVENTORY
        LINK_ASSET -> Routes.asset(id)
        LINK_ROOMS -> Routes.ROOMS
        LINK_ROOM -> Routes.room(id)
        LINK_PLANTS -> Routes.PLANTS
        LINK_DOCS -> Routes.DOCS
        LINK_DOC -> Routes.doc(id)
        LINK_DOCUMENTS -> Routes.DOCUMENTS
        LINK_DEFECTS -> Routes.DEFECTS
        LINK_DEFECT -> Routes.defect(id)
        LINK_PARTS -> Routes.PARTS
        LINK_PART -> Routes.part(id)
        LINK_CONTACTS -> Routes.CONTACTS
        LINK_CONTACT -> Routes.contact(id)
        LINK_EMERGENCY -> Routes.EMERGENCY
        LINK_WARRANTIES -> Routes.WARRANTIES
        LINK_INSURANCE -> Routes.INSURANCE
        LINK_POLICY -> Routes.insurance(id)
        LINK_COSTS -> Routes.COSTS
        LINK_COST -> Routes.cost(id)
        LINK_NOTIFICATIONS -> Routes.NOTIFICATIONS
        LINK_SEARCH -> Routes.SEARCH
        LINK_SETTINGS -> Routes.SETTINGS
        else -> null
    }
}

private val tabRoutes = setOf(Routes.HOME, Routes.TASKS, Routes.COSTS)

/** Opens what [link] points at; a tab is switched to, anything else is pushed. Returns false when the app has no screen for it. */
fun NavController.open(link: AppLink): Boolean {
    val route = routeOf(link) ?: return false
    if (route in tabRoutes) {
        navigate(route) {
            popUpTo(graph.findStartDestination().id) { saveState = true }
            launchSingleTop = true
            restoreState = true
        }
    } else {
        navigate(route)
    }
    return true
}
