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
import ch.orellbuehler.hauswart.i18n.tr

/** One entry of the menu of the costs tab: its text and where it leads. */
class CostsMoreEntry(
    val label: String,
    val onClick: (NavController) -> Unit,
)

/**
 * The slot in the toolbar of the costs tab where budgets, recurring costs, the inbox and the receipts are added: a feature
 * that provides one adds its [CostsMoreEntry] to the list below. With no entries the menu is not shown.
 */
@Composable
fun CostsMoreMenu(nav: NavController) {
    val entries = costsMoreEntries()
    if (entries.isEmpty()) return
    var open by remember { mutableStateOf(false) }
    IconButton(onClick = { open = true }) {
        Icon(Icons.Outlined.MoreVert, contentDescription = tr("m_costs_more_menu"))
    }
    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
        entries.forEach { entry ->
            DropdownMenuItem(
                text = { Text(entry.label, maxLines = 1) },
                onClick = {
                    open = false
                    entry.onClick(nav)
                },
            )
        }
    }
}

@Composable
private fun costsMoreEntries(): List<CostsMoreEntry> = emptyList()
