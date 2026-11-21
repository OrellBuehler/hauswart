package ch.orellbuehler.hauswart.android.ui.tasks

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AlarmOff
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.SkipNext
import androidx.compose.material.icons.outlined.Snooze
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.components.toneColor
import ch.orellbuehler.hauswart.feature.tasks.PreviewState
import ch.orellbuehler.hauswart.feature.tasks.ProgressInfo
import ch.orellbuehler.hauswart.feature.tasks.TaskNotice
import ch.orellbuehler.hauswart.feature.tasks.TaskRow
import ch.orellbuehler.hauswart.feature.tasks.UndoToken
import ch.orellbuehler.hauswart.i18n.tr

/** Shows what a store reports after a write as a snackbar, with "Undo" when there is a way back. */
@Composable
fun NoticeEffect(
    notice: TaskNotice?,
    snackbar: SnackbarHostState,
    onUndo: (UndoToken) -> Unit,
    onConsumed: () -> Unit,
) {
    val undoLabel = tr("toast_undo")
    LaunchedEffect(notice) {
        if (notice == null) return@LaunchedEffect
        val result =
            snackbar.showSnackbar(
                message = notice.message,
                actionLabel = if (notice.undo != null) undoLabel else null,
                duration = SnackbarDuration.Long,
            )
        onConsumed()
        if (result == SnackbarResult.ActionPerformed) notice.undo?.let(onUndo)
    }
}

@Composable
fun ProgressLine(
    progress: ProgressInfo,
    modifier: Modifier = Modifier,
) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        LinearProgressIndicator(
            progress = { progress.fraction },
            modifier = Modifier.weight(1f),
            color = toneColor(if (progress.reached) "due" else "ok"),
        )
        Text(progress.text, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
    }
}

/**
 * One task of a list: title, place, status and date, assignee, progress. The check completes it (or opens the
 * dialog for a task that asks for a reading), the menu skips, snoozes or ends a snooze.
 */
@Composable
fun TaskListRow(
    row: TaskRow,
    busy: Boolean,
    onOpen: () -> Unit,
    onComplete: () -> Unit,
    onSkip: () -> Unit,
    onSnooze: () -> Unit,
    onUnsnooze: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var menu by remember { mutableStateOf(false) }
    ListItem(
        headlineContent = { Text(row.title, maxLines = 2, overflow = TextOverflow.Ellipsis) },
        modifier = modifier.clickableRow(onOpen),
        supportingContent = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (row.place.isNotBlank()) {
                    Text(row.place, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    StatusChip(row.statusLabel, tone = row.tone)
                    if (row.dueText.isNotBlank()) {
                        Text(
                            row.dueText,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                val extra = listOfNotNull(row.assigneeName, row.archivedLabel).joinToString(" · ")
                if (extra.isNotBlank()) {
                    Text(extra, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                row.progress?.let { ProgressLine(it) }
            }
        },
        trailingContent =
            if (row.archived) {
                null
            } else {
                {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (busy) {
                            CircularProgressIndicator(Modifier.padding(12.dp), strokeWidth = 2.dp)
                        } else {
                            IconButton(onClick = onComplete) {
                                Icon(Icons.Outlined.Check, contentDescription = tr("task_complete_aria", "title" to row.title))
                            }
                        }
                        IconButton(onClick = { menu = true }) {
                            Icon(Icons.Outlined.MoreVert, contentDescription = tr("task_menu_aria", "title" to row.title))
                        }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(
                                text = { Text(tr("task_skip")) },
                                leadingIcon = { Icon(Icons.Outlined.SkipNext, contentDescription = null) },
                                onClick = {
                                    menu = false
                                    onSkip()
                                },
                            )
                            if (row.snoozed) {
                                DropdownMenuItem(
                                    text = { Text(tr("task_unsnooze")) },
                                    leadingIcon = { Icon(Icons.Outlined.AlarmOff, contentDescription = null) },
                                    onClick = {
                                        menu = false
                                        onUnsnooze()
                                    },
                                )
                            } else {
                                DropdownMenuItem(
                                    text = { Text(tr("task_snooze")) },
                                    leadingIcon = { Icon(Icons.Outlined.Snooze, contentDescription = null) },
                                    onClick = {
                                        menu = false
                                        onSnooze()
                                    },
                                )
                            }
                        }
                    }
                }
            },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
    )
}

private fun Modifier.clickableRow(onClick: () -> Unit): Modifier = this.then(Modifier.clickable(onClick = onClick))

/** What the live preview says about the rhythm being edited. */
@Composable
fun PreviewCard(
    preview: PreviewState,
    modifier: Modifier = Modifier,
) {
    SectionCard(modifier = modifier, title = tr("preview_title")) {
        Column(Modifier.padding(horizontal = ScreenPadding, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (preview.incomplete) {
                Text(
                    tr("preview_incomplete"),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                Text(preview.summary, style = MaterialTheme.typography.titleSmall)
                if (preview.loading) {
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                }
                preview.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
                if (preview.statusLabel.isNotEmpty()) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        StatusChip(preview.statusLabel, tone = preview.tone)
                        if (preview.dueText.isNotBlank()) Text(preview.dueText, style = MaterialTheme.typography.bodySmall)
                    }
                    preview.progress?.let { ProgressLine(it) }
                    preview.reasons.forEach {
                        Text("• $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Text(tr("preview_note"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}
