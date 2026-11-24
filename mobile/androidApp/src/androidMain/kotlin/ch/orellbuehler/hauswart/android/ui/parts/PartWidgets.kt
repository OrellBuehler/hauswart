package ch.orellbuehler.hauswart.android.ui.parts

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.feature.parts.PartChoice
import ch.orellbuehler.hauswart.feature.parts.PartRow
import ch.orellbuehler.hauswart.i18n.tr

/** One part of the list: name, number and supplier, stock, order, archive mark and price. */
@Composable
internal fun PartListRow(
    row: PartRow,
    onClick: () -> Unit,
) {
    ListItem(
        headlineContent = { Text(row.name, maxLines = 2, overflow = TextOverflow.Ellipsis) },
        modifier = Modifier.clickable(onClick = onClick),
        supportingContent = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (row.subtitle.isNotBlank()) Text(row.subtitle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    StatusChip(row.stockLabel, tone = row.stockTone)
                    row.orderedLabel?.let { StatusChip(it) }
                    if (row.archived) StatusChip(tr("part_archived"))
                }
            }
        },
        trailingContent = row.priceText?.let { price -> { Text(price, style = MaterialTheme.typography.labelMedium, maxLines = 1) } },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
    )
}

/** A list of choices of which one is picked. */
@Composable
internal fun ChoiceList(
    options: List<PartChoice>,
    selected: String,
    onSelect: (String) -> Unit,
) {
    Column {
        options.forEach { option ->
            Row(
                Modifier.selectable(selected = option.value == selected, role = Role.RadioButton, onClick = { onSelect(option.value) }),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RadioButton(selected = option.value == selected, onClick = null, modifier = Modifier.padding4())
                Column {
                    Text(option.label, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (option.detail.isNotBlank()) {
                        Text(
                            option.detail,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                        )
                    }
                }
            }
        }
    }
}

private fun Modifier.padding4(): Modifier = this.then(Modifier.padding(12.dp))
