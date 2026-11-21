package ch.orellbuehler.hauswart.android.ui.costbooks

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.style.TextOverflow

/** One entry of an [ActionMenu]. */
class MenuAction(
    val label: String,
    val onClick: () -> Unit,
    val destructive: Boolean = false,
    val enabled: Boolean = true,
)

/** A three-dots button that opens a menu of [actions]; [description] names it for a screen reader. */
@Composable
fun ActionMenu(
    description: String,
    actions: List<MenuAction>,
    enabled: Boolean = true,
) {
    var open by remember { mutableStateOf(false) }
    IconButton(onClick = { open = true }, enabled = enabled) {
        Icon(Icons.Outlined.MoreVert, contentDescription = description)
    }
    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
        actions.forEach { action ->
            DropdownMenuItem(
                text = {
                    Text(
                        action.label,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        color = if (action.destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
                    )
                },
                enabled = action.enabled,
                onClick = {
                    open = false
                    action.onClick()
                },
            )
        }
    }
}
