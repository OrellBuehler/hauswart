package ch.orellbuehler.hauswart.android.ui.docs

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.FormatListBulleted
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.feature.docs.TocItem
import ch.orellbuehler.hauswart.i18n.tr

/** The table of contents of a page above its web view: folded to one line, opened to the list of headings. */
@Composable
fun DocToc(
    toc: List<TocItem>,
    open: Boolean,
    onToggle: () -> Unit,
    onPick: (String) -> Unit,
) {
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().clickable(onClick = onToggle).padding(horizontal = ScreenPadding, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(Icons.Outlined.FormatListBulleted, contentDescription = null)
            Text(tr("docs_toc"), Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, maxLines = 1)
            Icon(if (open) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, contentDescription = null)
        }
        if (open) {
            LazyColumn(Modifier.heightIn(max = 240.dp)) {
                items(toc, key = { it.id }) { item ->
                    Text(
                        item.text,
                        Modifier
                            .fillMaxWidth()
                            .clickable { onPick(item.id) }
                            .padding(start = ScreenPadding + 16.dp * item.indent, end = ScreenPadding, top = 10.dp, bottom = 10.dp),
                        style = MaterialTheme.typography.bodyMedium,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
        HorizontalDivider()
    }
}
