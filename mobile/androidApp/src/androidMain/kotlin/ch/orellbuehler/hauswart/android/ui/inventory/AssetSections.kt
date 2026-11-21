package ch.orellbuehler.hauswart.android.ui.inventory

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowDownward
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Extension
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.ChoiceField
import ch.orellbuehler.hauswart.android.ui.components.ConfirmDialog
import ch.orellbuehler.hauswart.android.ui.components.DateField
import ch.orellbuehler.hauswart.android.ui.components.EmptyState
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.MoneyField
import ch.orellbuehler.hauswart.android.ui.components.RowIcon
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.components.SwitchField
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.inventory.AssetContactsStore
import ch.orellbuehler.hauswart.feature.inventory.AssetHintsStore
import ch.orellbuehler.hauswart.feature.inventory.AssetNotesStore
import ch.orellbuehler.hauswart.feature.inventory.AssetPartsStore
import ch.orellbuehler.hauswart.feature.inventory.AssetServiceLogStore
import ch.orellbuehler.hauswart.feature.inventory.HINT_KINDS
import ch.orellbuehler.hauswart.feature.inventory.HintForm
import ch.orellbuehler.hauswart.feature.inventory.HintItem
import ch.orellbuehler.hauswart.feature.inventory.NoteItem
import ch.orellbuehler.hauswart.feature.inventory.ServiceItem
import ch.orellbuehler.hauswart.feature.inventory.hintKindLabel
import ch.orellbuehler.hauswart.i18n.tr

// ---------------------------------------------------------------- hints

private class HintDialog(
    val item: HintItem?,
)

@Composable
internal fun AssetHintsSection(
    nav: NavController,
    assetId: String,
    snackbar: SnackbarHostState,
) {
    val store = rememberStore(key = assetId) { AssetHintsStore(it, assetId) }
    val state = store.collect()
    var dialog by remember { mutableStateOf<HintDialog?>(null) }
    var deleting by remember { mutableStateOf<HintItem?>(null) }
    NoticeEffect(state.notice, snackbar, store::dismissNotice)
    ErrorEffect(state.actionError, snackbar, store::dismissActionError)
    val openForm = {
        store.clearForm()
        dialog = HintDialog(null)
    }
    AddSection(tr("asset_hints_title"), tr("hint_add"), onAdd = openForm) {
        state.error?.let { InlineError(it.message, Modifier.padding(horizontal = ScreenPadding)) }
        if (!state.loading && state.items.isEmpty() && state.error == null) {
            EmptyState(tr("hints_empty_title"), tr("hints_empty_body"))
        }
        state.items.forEach { hint ->
            HintRow(
                hint = hint,
                busy = state.busy,
                onTogglePin = { store.togglePin(hint.id) },
                onEdit = {
                    store.clearForm()
                    dialog = HintDialog(hint)
                },
                onToggleGuest = { store.toggleGuest(hint.id) },
                onMove = { store.move(hint.id, it) },
                onDelete = { deleting = hint },
                onOpenTask = { hint.taskId?.let { nav.navigate(Routes.task(it)) } ?: nav.navigate(Routes.taskNew(assetId)) },
            )
        }
    }
    dialog?.let { open ->
        LaunchedEffect(state.saved) {
            if (state.saved) {
                dialog = null
                store.ackSaved()
            }
        }
        var form by remember { mutableStateOf(open.item?.form ?: HintForm()) }
        FormDialog(
            title = tr(if (open.item == null) "hint_create_title" else "hint_edit_title"),
            onDismiss = { dialog = null },
            onSave = { store.save(open.item?.id, form) },
            pending = state.saving,
        ) {
            ChoiceField(
                label = tr("hint_kind"),
                value = form.kind,
                options = HINT_KINDS.map { it to hintKindLabel(it) },
                onChange = { form = form.copy(kind = it) },
            )
            TextField(
                label = tr("hint_title"),
                value = form.title,
                onChange = { form = form.copy(title = it) },
                error = state.fieldErrors["title"],
                hint = tr("hint_title_placeholder"),
                capitalization = KeyboardCapitalization.Sentences,
            )
            TextField(
                label = tr("hint_body"),
                value = form.body,
                onChange = { form = form.copy(body = it) },
                error = state.fieldErrors["bodyMd"],
                singleLine = false,
                minLines = 3,
                capitalization = KeyboardCapitalization.Sentences,
            )
            SwitchField(tr("hint_pinned"), form.pinned, { form = form.copy(pinned = it) }, hint = tr("hint_pinned_hint"))
            SwitchField(
                tr("hint_guest_visible"),
                form.guestVisible,
                { form = form.copy(guestVisible = it) },
                hint = tr("hint_guest_visible_hint"),
            )
            if (open.item?.reactionNote != null) {
                Text(
                    tr("m_hint_reaction_edit_web"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            state.formError?.let { InlineError(it.message) }
        }
    }
    deleting?.let { hint ->
        ConfirmDialog(
            title = tr("hint_delete_title"),
            text = tr("hint_delete_description", "title" to hint.title),
            confirmLabel = tr("common_delete"),
            destructive = true,
            onConfirm = {
                deleting = null
                store.delete(hint.id)
            },
            onDismiss = { deleting = null },
        )
    }
}

@Composable
private fun HintRow(
    hint: HintItem,
    busy: Boolean,
    onTogglePin: () -> Unit,
    onEdit: () -> Unit,
    onToggleGuest: () -> Unit,
    onMove: (Int) -> Unit,
    onDelete: () -> Unit,
    onOpenTask: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(horizontal = ScreenPadding, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(hintKindIcon(hint.kind), contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Text(
                hint.kindLabel,
                Modifier.weight(1f),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            IconButton(onClick = onTogglePin, enabled = !busy) {
                Icon(
                    Icons.Outlined.PushPin,
                    contentDescription = tr(if (hint.pinned) "hint_unpin_aria" else "hint_pin_aria", "title" to hint.title),
                    tint = if (hint.pinned) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            IconButton(onClick = { menu = true }, enabled = !busy) {
                Icon(Icons.Outlined.MoreVert, contentDescription = tr("hint_actions_aria", "title" to hint.title))
            }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(
                    text = { Text(tr("common_edit")) },
                    leadingIcon = { Icon(Icons.Outlined.Edit, contentDescription = null) },
                    onClick = {
                        menu = false
                        onEdit()
                    },
                )
                DropdownMenuItem(
                    text = { Text(tr("hint_guest_visible")) },
                    leadingIcon = { Icon(Icons.Outlined.Visibility, contentDescription = null) },
                    trailingIcon = { Checkbox(checked = hint.guestVisible, onCheckedChange = null) },
                    onClick = {
                        menu = false
                        onToggleGuest()
                    },
                )
                DropdownMenuItem(
                    text = { Text(tr("hint_move_up")) },
                    leadingIcon = { Icon(Icons.Outlined.ArrowUpward, contentDescription = null) },
                    enabled = hint.canMoveUp,
                    onClick = {
                        menu = false
                        onMove(-1)
                    },
                )
                DropdownMenuItem(
                    text = { Text(tr("hint_move_down")) },
                    leadingIcon = { Icon(Icons.Outlined.ArrowDownward, contentDescription = null) },
                    enabled = hint.canMoveDown,
                    onClick = {
                        menu = false
                        onMove(1)
                    },
                )
                DropdownMenuItem(
                    text = { Text(tr("common_delete")) },
                    leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null) },
                    onClick = {
                        menu = false
                        onDelete()
                    },
                )
            }
        }
        Text(hint.title, style = MaterialTheme.typography.titleSmall)
        if (hint.body.isNotEmpty()) Text(hint.body, style = MaterialTheme.typography.bodyMedium)
        if (hint.guestVisible) StatusChip(tr("hint_guest_badge"), icon = Icons.Outlined.Visibility)
        hint.reactionNote?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        OutlinedButton(onClick = onOpenTask) {
            Text(
                if (hint.taskTitle != null) tr("hint_task_linked", "title" to hint.taskTitle!!) else tr("hint_plan_task"),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        HorizontalDivider()
    }
}

// ---------------------------------------------------------------- notes

private class NoteDialog(
    val item: NoteItem?,
)

@Composable
internal fun AssetNotesSection(
    nav: NavController,
    assetId: String,
    snackbar: SnackbarHostState,
) {
    val store = rememberStore(key = assetId) { AssetNotesStore(it, assetId) }
    val state = store.collect()
    val context = LocalContext.current
    var draft by remember { mutableStateOf("") }
    var editing by remember { mutableStateOf<NoteDialog?>(null) }
    var deleting by remember { mutableStateOf<NoteItem?>(null) }
    var converting by remember { mutableStateOf<NoteItem?>(null) }
    NoticeEffect(
        state.notice,
        snackbar,
        store::dismissNotice,
        onUndo = store::undo,
        onOpenDefect = { nav.navigate(Routes.defect(it)) },
    )
    ErrorEffect(state.actionError, snackbar, store::dismissActionError)
    LaunchedEffect(state.saved) {
        if (state.saved) {
            if (editing == null) draft = ""
            editing = null
            store.ackSaved()
        }
    }
    AddSection(
        title = tr("asset_notes_title"),
        addLabel = tr("common_add"),
        onAdd = {
            store.clearForm()
            store.save(null, draft)
        },
    ) {
        Column(Modifier.padding(horizontal = ScreenPadding), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                tr("asset_notes_description"),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            TextField(
                label = tr("asset_notes_add_label"),
                value = draft,
                onChange = { draft = it },
                hint = tr("asset_notes_add_placeholder"),
                singleLine = false,
                minLines = 2,
                capitalization = KeyboardCapitalization.Sentences,
                enabled = !state.saving,
            )
            if (editing == null) state.formError?.let { InlineError(it.message) }
            if (state.open.isEmpty() && !state.loading) EmptyState(tr("asset_notes_empty_title"), tr("asset_notes_empty_body"))
        }
        state.open.forEach { note ->
            NoteRow(
                note = note,
                busy = state.busyId == note.id,
                onResolve = { store.resolve(note.id) },
                onReopen = { store.reopen(note.id) },
                onEdit = {
                    store.clearForm()
                    editing = NoteDialog(note)
                },
                onToDefect = { converting = note },
                onDelete = { deleting = note },
                onOpenDefect = { id -> nav.navigate(Routes.defect(id)) },
            )
        }
        if (state.shareText.isNotEmpty()) {
            TextButton(
                onClick = {
                    val send =
                        Intent(Intent.ACTION_SEND)
                            .setType("text/plain")
                            .putExtra(Intent.EXTRA_SUBJECT, state.shareTitle)
                            .putExtra(Intent.EXTRA_TEXT, state.shareText)
                    context.startActivity(Intent.createChooser(send, null))
                },
                Modifier.padding(horizontal = 8.dp),
            ) {
                Icon(Icons.Outlined.Share, contentDescription = null)
                Text(tr("m_asset_share_notes"), maxLines = 1)
            }
        }
        TextButton(onClick = store::toggleResolved, Modifier.padding(horizontal = 8.dp)) {
            Icon(if (state.resolvedShown) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, contentDescription = null)
            Text(tr(if (state.resolvedShown) "asset_notes_hide_resolved" else "asset_notes_show_resolved"), maxLines = 1)
        }
        if (state.resolvedShown) {
            state.resolvedError?.let { InlineError(it.message, Modifier.padding(horizontal = ScreenPadding)) }
            if (state.resolved.isEmpty() && !state.resolvedLoading && state.resolvedError == null) {
                Text(
                    tr("asset_notes_resolved_empty"),
                    Modifier.padding(horizontal = ScreenPadding),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            state.resolved.forEach { note ->
                NoteRow(
                    note = note,
                    busy = state.busyId == note.id,
                    onResolve = {},
                    onReopen = { store.reopen(note.id) },
                    onEdit = {
                        store.clearForm()
                        editing = NoteDialog(note)
                    },
                    onToDefect = {},
                    onDelete = { deleting = note },
                    onOpenDefect = { id -> nav.navigate(Routes.defect(id)) },
                )
            }
            if (state.resolvedHasMore) {
                TextButton(
                    onClick = store::loadMoreResolved,
                    enabled = !state.resolvedLoading,
                    modifier = Modifier.padding(horizontal = 8.dp),
                ) {
                    Text(tr("common_load_more"), maxLines = 1)
                }
            }
        }
    }
    editing?.let { open ->
        var text by remember { mutableStateOf(open.item?.body ?: "") }
        FormDialog(
            title = tr("asset_notes_edit_title"),
            onDismiss = { editing = null },
            onSave = { store.save(open.item?.id, text) },
            pending = state.saving,
        ) {
            TextField(
                label = tr("asset_notes_add_label"),
                value = text,
                onChange = { text = it },
                singleLine = false,
                minLines = 3,
                capitalization = KeyboardCapitalization.Sentences,
            )
            state.formError?.let { InlineError(it.message) }
        }
    }
    deleting?.let { note ->
        ConfirmDialog(
            title = tr("asset_notes_delete_title"),
            text = tr("asset_notes_delete_description", "text" to note.excerpt),
            confirmLabel = tr("common_delete"),
            destructive = true,
            onConfirm = {
                deleting = null
                store.delete(note.id)
            },
            onDismiss = { deleting = null },
        )
    }
    converting?.let { note ->
        ConfirmDialog(
            title = tr("asset_notes_to_defect_title"),
            text = tr("asset_notes_to_defect_description", "text" to note.excerpt),
            confirmLabel = tr("asset_notes_to_defect_confirm"),
            onConfirm = {
                converting = null
                store.toDefect(note.id)
            },
            onDismiss = { converting = null },
        )
    }
}

@Composable
private fun NoteRow(
    note: NoteItem,
    busy: Boolean,
    onResolve: () -> Unit,
    onReopen: () -> Unit,
    onEdit: () -> Unit,
    onToDefect: () -> Unit,
    onDelete: () -> Unit,
    onOpenDefect: (String) -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(horizontal = ScreenPadding, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.Top) {
            Text(
                note.body,
                Modifier.weight(1f),
                style = MaterialTheme.typography.bodyMedium,
                color = if (note.resolved) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
            )
            IconButton(onClick = { menu = true }, enabled = !busy) {
                Icon(Icons.Outlined.MoreVert, contentDescription = tr("asset_notes_actions_aria", "text" to note.excerpt))
            }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(
                    text = { Text(tr("common_edit")) },
                    leadingIcon = { Icon(Icons.Outlined.Edit, contentDescription = null) },
                    onClick = {
                        menu = false
                        onEdit()
                    },
                )
                if (note.resolved) {
                    DropdownMenuItem(
                        text = { Text(tr("asset_notes_reopen")) },
                        onClick = {
                            menu = false
                            onReopen()
                        },
                    )
                } else {
                    DropdownMenuItem(
                        text = { Text(tr("asset_notes_to_defect")) },
                        leadingIcon = { Icon(Icons.Outlined.Build, contentDescription = null) },
                        onClick = {
                            menu = false
                            onToDefect()
                        },
                    )
                }
                DropdownMenuItem(
                    text = { Text(tr("common_delete")) },
                    leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null) },
                    onClick = {
                        menu = false
                        onDelete()
                    },
                )
            }
        }
        Text(
            listOfNotNull(note.meta, note.doneText).joinToString(" · "),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (note.resolved) {
            if (note.defectId != null) {
                TextButton(onClick = { onOpenDefect(note.defectId!!) }) { Text(tr("asset_notes_via_defect"), maxLines = 1) }
            } else if (note.viaService) {
                Text(
                    tr("asset_notes_via_service"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        } else {
            OutlinedButton(onClick = onResolve, enabled = !busy) {
                Icon(Icons.Outlined.Check, contentDescription = tr("asset_notes_resolve_aria", "text" to note.excerpt))
                Text(tr("asset_notes_resolve"), maxLines = 1)
            }
        }
        HorizontalDivider()
    }
}

// ---------------------------------------------------------- service log

private class ServiceDialog(
    val item: ServiceItem?,
)

@Composable
internal fun AssetServiceLogSection(
    nav: NavController,
    assetId: String,
    snackbar: SnackbarHostState,
) {
    val store = rememberStore(key = assetId) { AssetServiceLogStore(it, assetId) }
    val state = store.collect()
    var dialog by remember { mutableStateOf<ServiceDialog?>(null) }
    var deleting by remember { mutableStateOf<ServiceItem?>(null) }
    NoticeEffect(state.notice, snackbar, store::dismissNotice)
    ErrorEffect(state.actionError, snackbar, store::dismissActionError)
    AddSection(
        tr("asset_service_title"),
        tr("service_add"),
        onAdd = {
            store.clearForm()
            dialog = ServiceDialog(null)
        },
    ) {
        state.error?.let { InlineError(it.message, Modifier.padding(horizontal = ScreenPadding)) }
        if (!state.loading && state.items.isEmpty() && state.error == null) {
            EmptyState(tr("service_empty_title"), tr("service_empty_body"))
        }
        state.items.forEach { entry ->
            var menu by remember { mutableStateOf(false) }
            ListRow(
                title = entry.title,
                subtitle =
                    listOfNotNull(
                        entry.kindLabel,
                        entry.dateText,
                        entry.contactName,
                        entry.costText,
                        entry.details.ifEmpty {
                            null
                        },
                    ).joinToString(" · "),
                subtitleLines = 3,
                leading = { RowIcon(Icons.Outlined.Build) },
                trailing = {
                    IconButton(onClick = { menu = true }) {
                        Icon(Icons.Outlined.MoreVert, contentDescription = tr("service_actions_aria", "title" to entry.title))
                    }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(
                            text = { Text(tr("common_edit")) },
                            leadingIcon = { Icon(Icons.Outlined.Edit, contentDescription = null) },
                            onClick = {
                                menu = false
                                store.clearForm()
                                dialog = ServiceDialog(entry)
                            },
                        )
                        DropdownMenuItem(
                            text = { Text(tr("common_delete")) },
                            leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null) },
                            onClick = {
                                menu = false
                                deleting = entry
                            },
                        )
                    }
                },
                onClick = entry.contactId?.let { id -> { nav.navigate(Routes.contact(id)) } },
            )
        }
        if (state.hasMore) {
            TextButton(onClick = store::loadMore, enabled = !state.loadingMore, modifier = Modifier.padding(horizontal = 8.dp)) {
                Text(tr("common_load_more"), maxLines = 1)
            }
        }
    }
    dialog?.let { open ->
        LaunchedEffect(state.saved) {
            if (state.saved) {
                dialog = null
                store.ackSaved()
            }
        }
        var form by remember { mutableStateOf(open.item?.form ?: state.blank) }
        FormDialog(
            title = tr(if (open.item == null) "service_create_title" else "service_edit_title"),
            onDismiss = { dialog = null },
            onSave = { store.save(open.item?.id, form) },
            pending = state.saving,
        ) {
            ChoiceField(tr("service_kind"), form.kind, state.kindOptions.pairs(), { form = form.copy(kind = it) })
            DateField(tr("service_date"), form.date, { form = form.copy(date = it) }, error = state.fieldErrors["date"], clearable = false)
            TextField(
                label = tr("service_title"),
                value = form.title,
                onChange = { form = form.copy(title = it) },
                error = state.fieldErrors["title"],
                capitalization = KeyboardCapitalization.Sentences,
            )
            TextField(
                label = tr("service_description"),
                value = form.details,
                onChange = { form = form.copy(details = it) },
                error = state.fieldErrors["descriptionMd"],
                singleLine = false,
                minLines = 3,
                capitalization = KeyboardCapitalization.Sentences,
            )
            ChoiceField(tr("service_contact"), form.contactId, state.contactOptions.pairs(), { form = form.copy(contactId = it) })
            MoneyField(
                label = tr("service_cost", "currency" to state.currency),
                value = form.cost,
                onChange = { form = form.copy(cost = it) },
                currency = state.currency,
                error = state.fieldErrors["costMinor"],
            )
            if (state.openNotes.isNotEmpty()) {
                Text(tr("asset_notes_picker_title"), style = MaterialTheme.typography.labelLarge)
                Text(
                    tr("asset_notes_picker_hint"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                state.openNotes.forEach { note ->
                    val checked = note.id in form.resolvedNoteIds
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(
                            checked = checked,
                            onCheckedChange = {
                                form =
                                    form.copy(
                                        resolvedNoteIds =
                                            if (checked) {
                                                form.resolvedNoteIds - note.id
                                            } else {
                                                form.resolvedNoteIds +
                                                    note.id
                                            },
                                    )
                            },
                        )
                        Text(note.excerpt, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            state.formError?.let { InlineError(it.message) }
        }
    }
    deleting?.let { entry ->
        ConfirmDialog(
            title = tr("service_delete_title"),
            text = tr("service_delete_description", "title" to entry.title),
            confirmLabel = tr("common_delete"),
            destructive = true,
            onConfirm = {
                deleting = null
                store.delete(entry.id)
            },
            onDismiss = { deleting = null },
        )
    }
}

// ------------------------------------------------------------- contacts

@Composable
internal fun AssetContactsSection(
    nav: NavController,
    assetId: String,
    snackbar: SnackbarHostState,
) {
    val store = rememberStore(key = assetId) { AssetContactsStore(it, assetId) }
    val state = store.collect()
    var dialog by remember { mutableStateOf(false) }
    NoticeEffect(state.notice, snackbar, store::dismissNotice, onUndo = store::undo)
    ErrorEffect(state.actionError, snackbar, store::dismissActionError)
    AddSection(
        tr("asset_contacts_title"),
        tr("contact_link_add"),
        onAdd = {
            store.clearForm()
            dialog = true
        },
    ) {
        state.error?.let { InlineError(it.message, Modifier.padding(horizontal = ScreenPadding)) }
        if (!state.loading && state.items.isEmpty() && state.error == null) {
            EmptyState(tr("asset_contacts_empty_title"), tr("asset_contacts_empty_body"))
        }
        state.items.forEach { link ->
            ListRow(
                title = link.name,
                subtitle = listOfNotNull(link.roleLabel, link.company).joinToString(" · "),
                leading = { RowIcon(Icons.Outlined.Extension) },
                trailing = {
                    IconButton(onClick = { store.unlink(link.linkId) }, enabled = !state.busy) {
                        Icon(Icons.Outlined.LinkOff, contentDescription = tr("contact_unlink_aria", "name" to link.name))
                    }
                },
                onClick = { nav.navigate(Routes.contact(link.contactId)) },
            )
        }
    }
    if (dialog) {
        LaunchedEffect(state.saved) {
            if (state.saved) {
                dialog = false
                store.ackSaved()
            }
        }
        var contactId by remember { mutableStateOf("") }
        var role by remember { mutableStateOf("service") }
        FormDialog(
            title = tr("contact_link_title"),
            onDismiss = { dialog = false },
            onSave = { store.link(contactId, role) },
            pending = state.saving,
            saveLabel = tr("contact_link_submit"),
        ) {
            if (state.contactOptions.isEmpty()) {
                Text(tr("contact_link_empty"), style = MaterialTheme.typography.bodyMedium)
            }
            ChoiceField(tr("contact_link_list"), contactId, state.contactOptions.pairs(), { contactId = it })
            ChoiceField(tr("contact_link_role"), role, state.roleOptions.pairs(), { role = it })
            state.formError?.let { InlineError(it.message) }
        }
    }
}

// ---------------------------------------------------------------- parts

@Composable
internal fun AssetPartsSection(
    nav: NavController,
    assetId: String,
    snackbar: SnackbarHostState,
) {
    val store = rememberStore(key = assetId) { AssetPartsStore(it, assetId) }
    val state = store.collect()
    var dialog by remember { mutableStateOf(false) }
    NoticeEffect(state.notice, snackbar, store::dismissNotice, onUndo = store::undo)
    ErrorEffect(state.actionError, snackbar, store::dismissActionError)
    AddSection(
        tr("asset_parts_title"),
        tr("part_link_add"),
        onAdd = {
            store.clearForm()
            dialog = true
        },
    ) {
        state.error?.let { InlineError(it.message, Modifier.padding(horizontal = ScreenPadding)) }
        if (!state.loading && state.items.isEmpty() && state.error == null) {
            EmptyState(tr("asset_parts_empty_title"), tr("asset_parts_empty_body"))
        }
        state.items.forEach { part ->
            ListRow(
                title = part.name,
                subtitle = listOfNotNull(part.subtitle.ifEmpty { null }, part.priceText).joinToString(" · "),
                leading = { RowIcon(Icons.Outlined.Extension) },
                trailing = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        StatusChip(part.stockText, tone = part.stockTone)
                        IconButton(onClick = { store.unlink(part.partId) }, enabled = !state.busy) {
                            Icon(Icons.Outlined.LinkOff, contentDescription = tr("part_unlink_aria", "name" to part.name))
                        }
                    }
                },
                onClick = { nav.navigate(Routes.part(part.partId)) },
            )
        }
    }
    if (dialog) {
        LaunchedEffect(state.saved) {
            if (state.saved) {
                dialog = false
                store.ackSaved()
            }
        }
        var partId by remember { mutableStateOf("") }
        FormDialog(
            title = tr("part_link_title"),
            onDismiss = { dialog = false },
            onSave = { store.link(partId) },
            pending = state.saving,
            saveLabel = tr("part_link_submit"),
        ) {
            if (state.partOptions.isEmpty()) {
                Text(tr("part_link_empty"), style = MaterialTheme.typography.bodyMedium)
            } else {
                ChoiceField(tr("part_link_list"), partId, state.partOptions.pairs(), { partId = it })
            }
            state.formError?.let { InlineError(it.message) }
        }
    }
}
