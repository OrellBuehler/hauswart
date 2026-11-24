package ch.orellbuehler.hauswart.android.ui.contacts

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import ch.orellbuehler.hauswart.android.ui.nav.Routes

private const val CONTACT_NEW = "contacts/new"
private const val CONTACT_EDIT = "contacts/{id}/edit"

private val idArgument = listOf(navArgument("id") { type = NavType.StringType })

fun NavGraphBuilder.contactsGraph(nav: NavController) {
    composable(Routes.CONTACTS) { ContactsScreen(nav) }
    composable(CONTACT_NEW) { ContactEditScreen(nav, null) }
    composable(Routes.CONTACT_ROUTE, arguments = idArgument) { entry ->
        ContactDetailScreen(nav, requireNotNull(entry.arguments?.getString("id")))
    }
    composable(CONTACT_EDIT, arguments = idArgument) { entry ->
        ContactEditScreen(nav, requireNotNull(entry.arguments?.getString("id")))
    }
}

internal fun NavController.openContactEdit(id: String) = navigate("contacts/${Routes.arg(id)}/edit")

internal fun NavController.openContactNew() = navigate(CONTACT_NEW)
