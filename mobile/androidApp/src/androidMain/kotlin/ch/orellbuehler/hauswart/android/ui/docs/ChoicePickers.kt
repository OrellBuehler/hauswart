package ch.orellbuehler.hauswart.android.ui.docs

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
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import ch.orellbuehler.hauswart.i18n.tr

/** One entry of a picker: [detail] is searched too and shown below the label. */
internal data class PickOption(
    val id: String,
    val label: String,
    val detail: String,
)

private fun List<PickOption>.matching(query: String): List<PickOption> {
    val needle = query.trim().lowercase()
    return if (needle.isEmpty()) this else filter { "${it.label} ${it.detail}".lowercase().contains(needle) }
}

/** A field that shows the chosen entry and opens a searchable list; [value] is its id (empty for none). */
@Composable
internal fun ChoicePicker(
    label: String,
    value: String,
    options: List<PickOption>,
    noneLabel: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    error: String? = null,
) {
    var open by remember { mutableStateOf(false) }
    val shown = if (value.isEmpty()) noneLabel else options.firstOrNull { it.id == value }?.label ?: tr("common_loading")
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
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClickLabel = label) {
                    open =
                        true
                },
        )
    }
    if (open) {
        PickerDialog(
            title = label,
            options = options,
            selected = setOf(value),
            noneLabel = noneLabel,
            onPick = {
                open = false
                onChange(it)
            },
            onDismiss = { open = false },
        )
    }
}

/** A field that shows how many entries are chosen and opens a searchable list with check marks. */
@Composable
internal fun MultiChoicePicker(
    label: String,
    values: List<String>,
    options: List<PickOption>,
    emptyText: String,
    onChange: (List<String>) -> Unit,
    modifier: Modifier = Modifier,
    error: String? = null,
) {
    var open by remember { mutableStateOf(false) }
    val names = values.mapNotNull { id -> options.firstOrNull { it.id == id }?.label }
    val shown = if (values.isEmpty()) emptyText else names.joinToString(", ")
    Box(modifier.fillMaxWidth()) {
        OutlinedTextField(
            value = shown,
            onValueChange = {},
            modifier = Modifier.fillMaxWidth(),
            readOnly = true,
            maxLines = 3,
            label = { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            isError = error != null,
            supportingText = error?.let { { Text(it) } } ?: { Text(tr("insurance_assets_selected", "count" to values.size)) },
            trailingIcon = { Icon(Icons.Outlined.ExpandMore, contentDescription = null) },
        )
        Box(
            Modifier
                .matchParentSize()
                .padding(top = 8.dp)
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClickLabel = label) {
                    open =
                        true
                },
        )
    }
    if (open) {
        var chosen by remember { mutableStateOf(values) }
        PickerDialog(
            title = label,
            options = options,
            selected = chosen.toSet(),
            noneLabel = null,
            onPick = { id -> chosen = if (id in chosen) chosen - id else chosen + id },
            onDismiss = {
                open = false
                onChange(chosen)
            },
            doneLabel = tr("m_common_ok"),
        )
    }
}

@Composable
private fun PickerDialog(
    title: String,
    options: List<PickOption>,
    selected: Set<String>,
    noneLabel: String?,
    onPick: (String) -> Unit,
    onDismiss: () -> Unit,
    doneLabel: String? = null,
) {
    var query by remember { mutableStateOf("") }
    val shown = options.matching(query)
    AlertDialog(
        onDismissRequest = onDismiss,
        modifier = Modifier.imePadding(),
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                TextField(
                    label = tr("m_pick_search"),
                    value = query,
                    onChange = { query = it },
                    leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                )
                LazyColumn(Modifier.fillMaxWidth().heightIn(max = 320.dp)) {
                    if (noneLabel != null) {
                        item(key = "none") {
                            ListRow(title = noneLabel, onClick = { onPick("") })
                            HorizontalDivider()
                        }
                    }
                    items(shown, key = { it.id }) { option ->
                        ListRow(
                            title = option.label,
                            subtitle = option.detail,
                            onClick = { onPick(option.id) },
                            trailing =
                                if (option.id in selected) {
                                    { Icon(Icons.Outlined.Check, contentDescription = null, tint = MaterialTheme.colorScheme.primary) }
                                } else {
                                    null
                                },
                        )
                    }
                    if (shown.isEmpty()) {
                        item(key = "empty") {
                            Text(
                                tr("m_pick_empty"),
                                Modifier.padding(16.dp),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        },
        confirmButton = { if (doneLabel != null) TextButton(onClick = onDismiss) { Text(doneLabel) } },
        dismissButton = { if (doneLabel == null) TextButton(onClick = onDismiss) { Text(tr("common_cancel")) } },
    )
}
