package ch.orellbuehler.hauswart.android.ui.tasks

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.NoteAdd
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.material.icons.outlined.AlarmOff
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.SkipNext
import androidx.compose.material.icons.outlined.Snooze
import androidx.compose.material.icons.outlined.Unarchive
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ConfirmDialog
import ch.orellbuehler.hauswart.android.ui.components.EmptyState
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.LabeledValue
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.components.rememberUriOpener
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.tasks.ACTION_COMPLETE
import ch.orellbuehler.hauswart.feature.tasks.ACTION_SKIP
import ch.orellbuehler.hauswart.feature.tasks.ACTION_SNOOZE
import ch.orellbuehler.hauswart.feature.tasks.TaskDetailState
import ch.orellbuehler.hauswart.feature.tasks.TaskDetailStore
import ch.orellbuehler.hauswart.feature.tasks.TaskDetailView
import ch.orellbuehler.hauswart.i18n.tr

private data class PartDialog(
    val partId: String?,
    val name: String,
    val qty: String,
)

@Composable
fun TaskDetailScreen(
    nav: NavController,
    id: String,
) {
    val store = rememberStore(key = id) { TaskDetailStore(it, id) }
    val state = store.collect()
    val view = state.view
    val error = state.error
    val snackbar = remember { SnackbarHostState() }
    var action by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var partDialog by remember { mutableStateOf<PartDialog?>(null) }
    val open = rememberUriOpener()

    LaunchedEffect(state.deleted) { if (state.deleted) nav.popBackStack() }
    NoticeEffect(state.notice, snackbar, onUndo = store::undo, onConsumed = store::consumeNotice)
    LaunchedEffect(state.actionError) {
        state.actionError?.let {
            snackbar.showSnackbar(it.message)
            store.dismissActionError()
        }
    }
    LaunchedEffect(state.partSaved) {
        if (state.partSaved) {
            partDialog = null
            store.partDialogClosed()
        }
    }

    AppScaffold(
        title = view?.title ?: tr("nav_tasks"),
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
        actions = {
            if (view != null) {
                IconButton(onClick = { nav.openTaskEdit(id) }) { Icon(Icons.Outlined.Edit, contentDescription = tr("common_edit")) }
                IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, contentDescription = tr("task_more_actions")) }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    if (!view.archived) {
                        DropdownMenuItem(
                            text = { Text(tr("task_complete_with_note")) },
                            leadingIcon = { Icon(Icons.AutoMirrored.Outlined.NoteAdd, contentDescription = null) },
                            onClick = {
                                menu = false
                                action = ACTION_COMPLETE
                            },
                        )
                        DropdownMenuItem(
                            text = { Text(tr("task_skip")) },
                            leadingIcon = { Icon(Icons.Outlined.SkipNext, contentDescription = null) },
                            onClick = {
                                menu = false
                                action = ACTION_SKIP
                            },
                        )
                        if (view.snoozed) {
                            DropdownMenuItem(
                                text = { Text(tr("task_unsnooze")) },
                                leadingIcon = { Icon(Icons.Outlined.AlarmOff, contentDescription = null) },
                                onClick = {
                                    menu = false
                                    store.unsnooze()
                                },
                            )
                        } else {
                            DropdownMenuItem(
                                text = { Text(tr("task_snooze")) },
                                leadingIcon = { Icon(Icons.Outlined.Snooze, contentDescription = null) },
                                onClick = {
                                    menu = false
                                    action = ACTION_SNOOZE
                                },
                            )
                        }
                    }
                    DropdownMenuItem(
                        text = { Text(tr(if (view.archived) "task_restore" else "task_archive")) },
                        leadingIcon = {
                            Icon(
                                if (view.archived) Icons.Outlined.Unarchive else Icons.Outlined.Archive,
                                contentDescription = null,
                            )
                        },
                        onClick = {
                            menu = false
                            store.toggleArchive()
                        },
                    )
                    DropdownMenuItem(
                        text = { Text(tr("common_delete"), color = MaterialTheme.colorScheme.error) },
                        leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
                        onClick = {
                            menu = false
                            confirmDelete = true
                        },
                    )
                }
            }
        },
    ) { padding ->
        when {
            view != null ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    Column(
                        Modifier.verticalScroll(rememberScrollState()).padding(ScreenPadding),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        DetailBody(
                            view = view,
                            state = state,
                            onComplete = { if (view.needsReading) action = ACTION_COMPLETE else store.complete() },
                            onNote = { action = ACTION_COMPLETE },
                            onPlace = { nav.navigate(Routes.room(it)) },
                            onAsset = { nav.navigate(Routes.asset(it)) },
                            onPrep = store::completePreparation,
                            onUndo = store::undoCompletion,
                            onMore = store::loadMoreHistory,
                            onOpenBill = { url -> open(url) },
                            onAddPart = {
                                store.loadPartChoices()
                                partDialog = PartDialog(null, "", "1")
                            },
                            onEditPart = { partId, name, qty -> partDialog = PartDialog(partId, name, qty.toString()) },
                            onUnlinkPart = store::unlinkPart,
                        )
                    }
                }
            error != null -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            else -> LoadingBox(Modifier.padding(padding))
        }
    }

    action?.let { mode -> TaskActionDialog(id, mode, onDismiss = { action = null }, onDone = store::announce) }

    if (confirmDelete && view != null) {
        ConfirmDialog(
            title = tr("task_delete_title"),
            text = tr("task_delete_description", "title" to view.title) + if (view.isBill) " " + tr("task_bill_delete_note") else "",
            confirmLabel = tr("common_delete"),
            destructive = true,
            onConfirm = {
                confirmDelete = false
                store.delete()
            },
            onDismiss = { confirmDelete = false },
        )
    }

    partDialog?.let { dialog ->
        PartDialogContent(dialog, state, store, onDismiss = {
            partDialog = null
            store.partDialogClosed()
        })
    }
}

@Composable
private fun DetailBody(
    view: TaskDetailView,
    state: TaskDetailState,
    onComplete: () -> Unit,
    onNote: () -> Unit,
    onPlace: (String) -> Unit,
    onAsset: (String) -> Unit,
    onPrep: (String) -> Unit,
    onUndo: (String) -> Unit,
    onMore: () -> Unit,
    onOpenBill: (String) -> Unit,
    onAddPart: () -> Unit,
    onEditPart: (String, String, Long) -> Unit,
    onUnlinkPart: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(view.title, style = MaterialTheme.typography.headlineSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            StatusChip(view.statusLabel, tone = view.tone)
            if (view.dueText.isNotBlank()) Text(view.dueText, style = MaterialTheme.typography.bodyMedium)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            view.chips.forEach { StatusChip(it.label, tone = it.tone) }
        }
        view.progress?.let { ProgressLine(it) }
    }
    if (!view.archived) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = onComplete, enabled = !state.busy, modifier = Modifier.weight(1f)) {
                Icon(Icons.Outlined.Check, contentDescription = null)
                Text(tr("task_complete"), Modifier.padding(start = 8.dp), maxLines = 1)
            }
            FilledTonalButton(onClick = onNote, enabled = !state.busy, modifier = Modifier.weight(1f)) {
                Text(tr("task_complete_with_note"), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
    SectionCard(title = tr("task_schedule")) {
        Text(view.triggerSummary, Modifier.padding(horizontal = 16.dp, vertical = 4.dp), style = MaterialTheme.typography.titleSmall)
        if (view.dueValue.isNotEmpty()) LabeledValue(tr("task_due"), view.dueValue + (view.dueLimit?.let { "\n$it" } ?: ""))
        LabeledValue(tr("task_grace_days"), view.graceText)
        view.dueSoonText?.let { LabeledValue(tr("task_due_soon_days"), it) }
        view.reasons.forEach {
            Text(
                "• $it",
                Modifier.padding(horizontal = 16.dp),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
    SectionCard(title = tr("task_description")) {
        Text(
            view.description.ifBlank { tr("task_description_empty") },
            Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            style = MaterialTheme.typography.bodyMedium,
            color = if (view.description.isBlank()) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
        )
    }
    SectionCard(title = tr("task_preparations")) {
        if (view.preparations.isEmpty()) {
            Text(
                tr("task_preparations_empty"),
                Modifier.padding(horizontal = 16.dp),
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        view.preparations.forEach { prep ->
            ListRow(
                title = prep.title,
                subtitle = listOfNotNull(prep.kindLabel, prep.leadText, prep.stateLabel).joinToString(" · "),
                trailing =
                    if (prep.open) {
                        {
                            IconButton(onClick = { onPrep(prep.id) }, enabled = !state.busy) {
                                Icon(Icons.Outlined.Check, contentDescription = tr("dashboard_prep_done_aria", "title" to prep.title))
                            }
                        }
                    } else {
                        null
                    },
            )
        }
    }
    SectionCard(title = tr("task_parts_title")) {
        Text(
            tr("task_parts_description"),
            Modifier.padding(horizontal = 16.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (view.parts.isEmpty()) EmptyState(tr("task_parts_empty_title"), tr("task_parts_empty_body"))
        view.parts.forEach { part ->
            ListRow(
                title = part.name,
                subtitle = part.stockLabel,
                trailing = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        TextButton(onClick = { onEditPart(part.partId, part.name, part.qty) }) { Text(part.qtyLabel, maxLines = 1) }
                        IconButton(onClick = { onUnlinkPart(part.partId) }, enabled = !state.busy) {
                            Icon(Icons.Outlined.LinkOff, contentDescription = tr("part_unlink_aria", "name" to part.name))
                        }
                    }
                },
            )
        }
        TextButton(onClick = onAddPart, Modifier.padding(horizontal = 8.dp)) { Text(tr("part_link_add"), maxLines = 1) }
    }
    SectionCard(title = tr("task_history")) {
        Text(
            tr("task_history_description"),
            Modifier.padding(horizontal = 16.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (view.history.isEmpty()) {
            Text(
                tr("task_history_empty"),
                Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        view.history.forEach { c ->
            ListRow(
                title = c.who + if (c.skipped) " · " + c.skippedLabel else "",
                subtitle = listOfNotNull(c.whenText + " · " + c.sourceLabel, c.note).joinToString("\n"),
                subtitleLines = 3,
                trailing =
                    if (c.canUndo) {
                        {
                            IconButton(onClick = { onUndo(c.id) }, enabled = !state.busy) {
                                Icon(Icons.AutoMirrored.Outlined.Undo, contentDescription = tr("completion_undo_aria", "who" to c.who))
                            }
                        }
                    } else {
                        null
                    },
            )
        }
        if (state.moreHistory) {
            TextButton(onClick = onMore, enabled = !state.loadingMore, modifier = Modifier.padding(horizontal = 8.dp)) {
                Text(tr("common_load_more"), maxLines = 1)
            }
        }
    }
    SectionCard(title = tr("task_assignment")) {
        view.assignmentLines.forEach {
            Text(it, Modifier.padding(horizontal = 16.dp, vertical = 2.dp), style = MaterialTheme.typography.bodyMedium)
        }
        Text(
            view.notifyLine,
            Modifier.padding(horizontal = 16.dp, vertical = 2.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    SectionCard(title = tr("task_details")) {
        if (view.place.isNotEmpty()) {
            LabeledValue(
                tr("task_location"),
                view.place,
                onClick = { view.assetId?.let(onAsset) ?: view.roomId?.let(onPlace) },
            )
        }
        view.billUrl?.let { url -> LabeledValue(tr("task_bill_label"), tr("finance_open_in_app"), onClick = { onOpenBill(url) }) }
        view.effort?.let { LabeledValue(tr("task_effort"), it) }
        LabeledValue(tr("task_created"), view.created)
    }
}

@Composable
private fun PartDialogContent(
    dialog: PartDialog,
    state: TaskDetailState,
    store: TaskDetailStore,
    onDismiss: () -> Unit,
) {
    var chosen by remember { mutableStateOf("") }
    var qty by remember(dialog) { mutableStateOf(dialog.qty) }
    val editing = dialog.partId != null
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(tr(if (editing) "task_part_edit_title" else "task_part_link_title")) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    if (editing) tr("task_part_edit_description", "name" to dialog.name) else tr("task_part_link_description"),
                    style = MaterialTheme.typography.bodyMedium,
                )
                if (!editing) {
                    state.partChoicesError?.let { InlineError(it.message) }
                    if (state.partChoices.isEmpty() &&
                        !state.partChoicesLoading &&
                        state.partChoicesError == null
                    ) {
                        Text(tr("part_link_empty"))
                    }
                    state.partChoices.forEach { choice ->
                        Row(
                            Modifier.fillMaxWidth().selectable(chosen == choice.value, role = Role.RadioButton, onClick = {
                                chosen =
                                    choice.value
                            }),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(selected = chosen == choice.value, onClick = null)
                            Text(choice.label, Modifier.padding(start = 8.dp), maxLines = 2, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
                TextField(
                    label = tr("task_part_qty"),
                    value = qty,
                    onChange = { qty = it },
                    keyboardType = KeyboardType.Number,
                    hint = tr("task_part_qty_hint"),
                    error = state.partError,
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { if (dialog.partId != null) store.setPartQty(dialog.partId, qty) else store.linkPart(chosen, qty) },
                enabled = !state.partSaving,
            ) { Text(tr(if (editing) "common_save" else "part_link_submit"), maxLines = 1) }
        },
        dismissButton = { OutlinedButton(onClick = onDismiss) { Text(tr("common_cancel"), maxLines = 1) } },
    )
}
