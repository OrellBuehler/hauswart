package ch.orellbuehler.hauswart.android.ui.costs

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.FilterChip
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.components.toneColor
import ch.orellbuehler.hauswart.feature.costs.BookOption
import ch.orellbuehler.hauswart.feature.costs.CostBadge
import ch.orellbuehler.hauswart.feature.costs.CostOption
import ch.orellbuehler.hauswart.feature.costs.CostRowView
import ch.orellbuehler.hauswart.feature.costs.TagView
import ch.orellbuehler.hauswart.feature.dashboard.TONE_OK
import ch.orellbuehler.hauswart.i18n.tr

/** An amount as text: refunds in the colour of good news. */
@Composable
fun AmountText(
    text: String,
    refund: Boolean,
    modifier: Modifier = Modifier,
    style: androidx.compose.ui.text.TextStyle = MaterialTheme.typography.bodyLarge,
) {
    Text(
        text,
        modifier = modifier,
        style = style,
        color = if (refund) toneColor(TONE_OK) else MaterialTheme.colorScheme.onSurface,
        maxLines = 1,
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BadgeRow(
    badges: List<CostBadge>,
    tags: List<TagView>,
    modifier: Modifier = Modifier,
) {
    if (badges.isEmpty() && tags.isEmpty()) return
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        badges.forEach { StatusChip(it.text, tone = it.tone) }
        tags.forEach { StatusChip(it.name) }
    }
}

/** The book switcher at the top of the costs screens: "all books" first, then each book. */
@Composable
fun BookSwitcher(
    books: List<BookOption>,
    selected: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val options = listOf(BookOption("", tr("costbook_all"), null, false, false, "ownership")) + books
    LazyRow(
        modifier,
        contentPadding = PaddingValues(horizontal = ScreenPadding),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(options, key = { it.id }) { book ->
            FilterChip(
                selected = book.id == selected,
                onClick = { onSelect(book.id) },
                label = { Text(book.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            )
        }
    }
}

/** Chips that wrap onto several lines; one of them is chosen. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SingleChips(
    options: List<CostOption>,
    selected: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { option ->
            FilterChip(
                selected = option.value == selected,
                onClick = { onSelect(option.value) },
                label = { Text(option.label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            )
        }
    }
}

/** Chips that wrap onto several lines; any number of them are ticked. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MultiChips(
    options: List<CostOption>,
    selected: List<String>,
    onToggle: (String) -> Unit,
    modifier: Modifier = Modifier,
    extra: (@Composable () -> Unit)? = null,
) {
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { option ->
            FilterChip(
                selected = option.value in selected,
                onClick = { onToggle(option.value) },
                label = { Text(option.label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            )
        }
        extra?.invoke()
    }
}

/** One entry of the list. */
@Composable
fun CostRowItem(
    row: CostRowView,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ListItem(
        headlineContent = { Text(row.title, maxLines = 2, overflow = TextOverflow.Ellipsis) },
        modifier = modifier.clickable(onClick = onClick),
        supportingContent = {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(row.meta, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (row.place.isNotEmpty()) Text(row.place, maxLines = 1, overflow = TextOverflow.Ellipsis)
                BadgeRow(row.badges, row.tags, Modifier.padding(top = 4.dp))
            }
        },
        trailingContent = {
            Column(horizontalAlignment = Alignment.End) {
                AmountText(row.amount, row.refund)
                Text(
                    row.payer,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
        },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
    )
}

/** A label above a group of fields of a form. */
@Composable
fun FormSection(
    title: String,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row { Text(title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary) }
        content()
    }
}
