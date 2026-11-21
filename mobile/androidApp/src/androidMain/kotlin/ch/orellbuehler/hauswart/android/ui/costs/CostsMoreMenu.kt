package ch.orellbuehler.hauswart.android.ui.costs

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.inbox.CostsMenuStore
import ch.orellbuehler.hauswart.feature.inbox.MENU_BOOKS
import ch.orellbuehler.hauswart.feature.inbox.MENU_BUDGETS
import ch.orellbuehler.hauswart.feature.inbox.MENU_INBOX
import ch.orellbuehler.hauswart.feature.inbox.MENU_RECEIPTS
import ch.orellbuehler.hauswart.feature.inbox.MENU_RECURRING
import ch.orellbuehler.hauswart.feature.inbox.MENU_TAGS
import ch.orellbuehler.hauswart.i18n.tr

private fun routeOf(key: String): String? =
    when (key) {
        MENU_BUDGETS -> Routes.COSTS_BUDGETS
        MENU_RECURRING -> Routes.COSTS_RECURRING
        MENU_INBOX -> Routes.COSTS_INBOX
        MENU_RECEIPTS -> Routes.costsReceipts()
        MENU_BOOKS -> Routes.COST_BOOKS
        MENU_TAGS -> Routes.COST_TAGS
        else -> null
    }

/**
 * The menu in the toolbar of the costs tab: budgets, recurring costs, the finance inbox (only while a finance app is
 * connected), the receipts, the cost books and the tags.
 */
@Composable
fun CostsMoreMenu(nav: NavController) {
    val store = rememberStore { CostsMenuStore(it) }
    val entries = store.collect().entries
    var open by remember { mutableStateOf(false) }
    IconButton(onClick = { open = true }) {
        Icon(Icons.Outlined.MoreVert, contentDescription = tr("m_costs_more_menu"))
    }
    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
        entries.forEach { entry ->
            DropdownMenuItem(
                text = { Text(entry.label + (entry.badge?.let { " ($it)" } ?: ""), maxLines = 1) },
                onClick = {
                    open = false
                    routeOf(entry.key)?.let { nav.navigate(it) }
                },
            )
        }
    }
}
