package ch.orellbuehler.hauswart.android.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.orellbuehler.hauswart.android.ui.theme.StatusColors
import ch.orellbuehler.hauswart.feature.dashboard.TONE_DUE
import ch.orellbuehler.hauswart.feature.dashboard.TONE_MUTED
import ch.orellbuehler.hauswart.feature.dashboard.TONE_OK
import ch.orellbuehler.hauswart.feature.dashboard.TONE_OVERDUE

val ScreenPadding = 16.dp

@Composable
fun SectionTitle(
    text: String,
    modifier: Modifier = Modifier,
    trailing: String? = null,
) {
    Row(modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(
            text,
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (trailing != null) {
            Text(trailing, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** A card with an optional [title] on top; rows and text go inside. */
@Composable
fun SectionCard(
    modifier: Modifier = Modifier,
    title: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(Modifier.padding(vertical = 8.dp)) {
            if (title != null) {
                Text(
                    title,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            content()
        }
    }
}

/**
 * One row of a list: a single-line [title] with ellipsis, an optional [subtitle] (up to
 * [subtitleLines] lines), slots for a [leading] and a [trailing] element, and a tap target.
 */
@Composable
fun ListRow(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    subtitleLines: Int = 1,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    onClick: (() -> Unit)? = null,
) {
    ListItem(
        headlineContent = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        modifier = if (onClick != null) modifier.clickable(onClick = onClick) else modifier,
        supportingContent =
            subtitle?.takeIf { it.isNotBlank() }?.let { text ->
                { Text(text, maxLines = subtitleLines, overflow = TextOverflow.Ellipsis) }
            },
        leadingContent = leading,
        trailingContent = trailing,
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
    )
}

@Composable
fun RowIcon(
    icon: ImageVector,
    modifier: Modifier = Modifier,
) {
    Icon(icon, contentDescription = null, modifier = modifier.size(24.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
}

/** A label and its value on one row of a detail screen; a missing value shows a dash. Tappable with [onClick]. */
@Composable
fun LabeledValue(
    label: String,
    value: String?,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
) {
    val shown = value?.takeIf { it.isNotBlank() }
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .let { if (onClick != null && shown != null) it.clickable(onClick = onClick) else it }
                .heightIn(min = 40.dp)
                .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            label,
            modifier = Modifier.width(112.dp),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            shown ?: "–",
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.bodyMedium,
            color = if (onClick != null && shown != null) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
            textDecoration = if (onClick != null && shown != null) TextDecoration.Underline else null,
        )
    }
}

/** The colour of a tone the stores report (`overdue`, `due`, `ok`, `muted`; anything else is the text colour). */
@Composable
fun toneColor(tone: String): Color =
    when (tone) {
        TONE_OVERDUE -> StatusColors.overdue
        TONE_DUE -> StatusColors.due
        TONE_OK -> StatusColors.ok
        TONE_MUTED -> StatusColors.muted
        else -> MaterialTheme.colorScheme.onSurface
    }

/** A small pill with a short [text], tinted by [tone]. */
@Composable
fun StatusChip(
    text: String,
    modifier: Modifier = Modifier,
    tone: String = TONE_MUTED,
    icon: ImageVector? = null,
) {
    val color = toneColor(tone)
    Surface(modifier = modifier, shape = RoundedCornerShape(50), color = color.copy(alpha = 0.14f), contentColor = color) {
        Row(
            Modifier.padding(horizontal = 10.dp, vertical = 3.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            if (icon != null) Icon(icon, contentDescription = null, modifier = Modifier.size(14.dp))
            Text(text, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}
