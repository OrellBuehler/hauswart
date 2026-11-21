@file:OptIn(ExperimentalMaterial3Api::class)

package ch.orellbuehler.hauswart.android.ui.appointments

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Clear
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.feature.appointments.ApptChoice
import ch.orellbuehler.hauswart.i18n.tr

/**
 * A field that shows the chosen task, device or contact and opens a searchable list. [value] is the
 * chosen id (empty for none); [noneLabel] is what the field says for none and the entry that clears it.
 */
@Composable
internal fun PickerField(
    label: String,
    value: String,
    options: List<ApptChoice>,
    noneLabel: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    loading: Boolean = false,
    error: String? = null,
) {
    var open by remember { mutableStateOf(false) }
    val chosen = options.firstOrNull { it.id == value }
    val shown =
        when {
            value.isEmpty() -> noneLabel
            chosen != null -> chosen.label
            else -> tr("common_loading")
        }
    Box(modifier.fillMaxWidth()) {
        OutlinedTextField(
            value = shown,
            onValueChange = {},
            modifier = Modifier.fillMaxWidth(),
            readOnly = true,
            singleLine = true,
            label = { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            isError = error != null,
            supportingText = error?.let { { Text(it) } },
            trailingIcon = {
                if (value.isNotEmpty()) {
                    IconButton(onClick = { onChange("") }) { Icon(Icons.Outlined.Clear, contentDescription = noneLabel) }
                } else {
                    Icon(Icons.Outlined.ExpandMore, contentDescription = null)
                }
            },
        )
        Box(
            Modifier
                .matchParentSize()
                .padding(top = 8.dp, end = if (value.isNotEmpty()) 56.dp else 0.dp)
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    enabled = !loading || options.isNotEmpty(),
                    onClickLabel = label,
                ) { open = true },
        )
    }
    if (open) {
        PickerDialog(
            title = label,
            options = options,
            noneLabel = noneLabel,
            selected = value,
            onPick = {
                open = false
                onChange(it)
            },
            onDismiss = { open = false },
        )
    }
}

@Composable
private fun PickerDialog(
    title: String,
    options: List<ApptChoice>,
    noneLabel: String,
    selected: String,
    onPick: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var query by remember { mutableStateOf("") }
    val needle = query.trim().lowercase()
    val shown = if (needle.isEmpty()) options else options.filter { "${it.label} ${it.detail}".lowercase().contains(needle) }
    AlertDialog(
        onDismissRequest = onDismiss,
        modifier = Modifier.imePadding(),
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                TextField(
                    label = tr("m_appt_pick_search"),
                    value = query,
                    onChange = { query = it },
                    leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                )
                LazyColumn(Modifier.fillMaxWidth().heightIn(max = 320.dp)) {
                    item(key = "none") {
                        ListRow(title = noneLabel, onClick = { onPick("") })
                        HorizontalDivider()
                    }
                    items(shown, key = { it.id }) { option ->
                        ListRow(
                            title = option.label,
                            subtitle = option.detail,
                            onClick = { onPick(option.id) },
                            trailing =
                                if (option.id ==
                                    selected
                                ) {
                                    ({ Icon(Icons.Outlined.Check, contentDescription = null, tint = MaterialTheme.colorScheme.primary) })
                                } else {
                                    null
                                },
                        )
                    }
                    if (shown.isEmpty()) {
                        item(key = "empty") {
                            Text(
                                tr("m_appt_pick_empty"),
                                Modifier.padding(16.dp),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text(tr("common_cancel")) } },
    )
}

/** A time of day as `HH:MM` (empty for none) chosen with the Material time picker. */
@Composable
internal fun TimeField(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    error: String? = null,
    clearable: Boolean = false,
) {
    var open by remember { mutableStateOf(false) }
    Box(modifier.fillMaxWidth()) {
        OutlinedTextField(
            value = value,
            onValueChange = {},
            modifier = Modifier.fillMaxWidth(),
            readOnly = true,
            singleLine = true,
            label = { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            isError = error != null,
            supportingText = error?.let { { Text(it) } },
            trailingIcon = {
                if (clearable && value.isNotEmpty()) {
                    IconButton(onClick = { onChange("") }) { Icon(Icons.Outlined.Clear, contentDescription = tr("m_appt_time_clear")) }
                } else {
                    Icon(Icons.Outlined.Schedule, contentDescription = null)
                }
            },
        )
        Box(
            Modifier
                .matchParentSize()
                .padding(top = 8.dp, end = if (clearable && value.isNotEmpty()) 56.dp else 0.dp)
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClickLabel = tr("m_appt_time_pick"),
                ) { open = true },
        )
    }
    if (open) {
        val state =
            rememberTimePickerState(
                initialHour = value.substringBefore(':', "").toIntOrNull() ?: 9,
                initialMinute = value.substringAfter(':', "").toIntOrNull() ?: 0,
                is24Hour = true,
            )
        AlertDialog(
            onDismissRequest = { open = false },
            confirmButton = {
                TextButton(
                    onClick = {
                        onChange("%02d:%02d".format(state.hour, state.minute))
                        open = false
                    },
                ) { Text(tr("m_common_ok")) }
            },
            dismissButton = { TextButton(onClick = { open = false }) { Text(tr("common_cancel")) } },
            text = { Box(Modifier.fillMaxWidth(), contentAlignment = androidx.compose.ui.Alignment.Center) { TimePicker(state = state) } },
        )
    }
}
