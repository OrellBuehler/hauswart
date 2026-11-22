package ch.orellbuehler.hauswart.android.ui.defects

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Check
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
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.components.toneColor
import ch.orellbuehler.hauswart.feature.comments.TextSegment
import ch.orellbuehler.hauswart.feature.defects.DefectChoice
import ch.orellbuehler.hauswart.feature.defects.DefectRow
import ch.orellbuehler.hauswart.feature.defects.DefectStep

internal fun List<DefectChoice>.pairs(): List<Pair<String, String>> = map { it.value to it.label }

/** Text with the web addresses in it as links. */
@Composable
internal fun LinkedText(
    segments: List<TextSegment>,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodyMedium,
) {
    val link = MaterialTheme.colorScheme.primary
    val text =
        buildAnnotatedString {
            segments.forEach { segment ->
                val href = segment.href
                if (href == null) {
                    append(segment.text)
                } else {
                    withLink(LinkAnnotation.Url(href, TextLinkStyles(SpanStyle(color = link, textDecoration = TextDecoration.Underline)))) {
                        append(segment.text)
                    }
                }
            }
        }
    Text(text, modifier, style = style)
}

/** One defect of the list: number and title, place, status, severity, deadline and the comment count. */
@Composable
internal fun DefectListRow(
    row: DefectRow,
    onClick: () -> Unit,
) {
    ListItem(
        headlineContent = { Text("#${row.number} ${row.title}", maxLines = 2, overflow = TextOverflow.Ellipsis) },
        modifier = Modifier.clickable(onClick = onClick),
        supportingContent = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (row.place.isNotBlank()) Text(row.place, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    StatusChip(row.statusLabel, tone = row.statusTone)
                    StatusChip(row.severityLabel, tone = row.severityTone)
                }
                Text(row.deadlineText, style = MaterialTheme.typography.bodySmall, color = toneColor(row.deadlineTone), maxLines = 2)
            }
        },
        trailingContent =
            if (row.commentCount > 0) {
                {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        Icon(Icons.Outlined.ChatBubbleOutline, contentDescription = null, modifier = Modifier.size(16.dp))
                        Text(row.commentCount.toString(), style = MaterialTheme.typography.labelMedium)
                    }
                }
            } else {
                null
            },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
    )
}

/** The progress of a defect: open, reported, in progress, fixed (or rejected), with the dates that are known. */
@Composable
internal fun DefectStepper(
    steps: List<DefectStep>,
    modifier: Modifier = Modifier,
) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        steps.forEachIndexed { index, step ->
            val current = step.state == "current"
            val done = step.state == "done"
            Column(
                Modifier.weight(1f),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Surface(
                    shape = CircleShape,
                    color = if (current) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainerHighest,
                    contentColor = if (current) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(32.dp),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        if (done) {
                            Icon(Icons.Outlined.Check, contentDescription = null, modifier = Modifier.size(16.dp))
                        } else {
                            Text((index + 1).toString(), style = MaterialTheme.typography.labelMedium)
                        }
                    }
                }
                Text(
                    step.label,
                    style = MaterialTheme.typography.labelSmall,
                    textAlign = TextAlign.Center,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    color = if (step.state == "todo") MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                )
                step.dateText?.let {
                    Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                }
            }
        }
    }
}
