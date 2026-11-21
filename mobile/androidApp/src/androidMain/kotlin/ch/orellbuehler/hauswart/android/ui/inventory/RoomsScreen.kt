package ch.orellbuehler.hauswart.android.ui.inventory

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ArrowDownward
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.MeetingRoom
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledIconToggleButton
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ConfirmDialog
import ch.orellbuehler.hauswart.android.ui.components.EmptyState
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.RowIcon
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.inventory.RoomEditStore
import ch.orellbuehler.hauswart.feature.inventory.RoomItem
import ch.orellbuehler.hauswart.feature.inventory.RoomsStore
import ch.orellbuehler.hauswart.i18n.tr

private class RoomDialog(
    val id: String?,
)

@Composable
fun RoomsScreen(nav: NavController) {
    val store = rememberStore { RoomsStore(it) }
    val state = store.collect()
    val error = state.error
    val snackbar = remember { SnackbarHostState() }
    var dialog by remember { mutableStateOf<RoomDialog?>(null) }
    var deleting by remember { mutableStateOf<RoomItem?>(null) }
    NoticeEffect(state.notice, snackbar, store::dismissNotice)
    ErrorEffect(state.actionError, snackbar, store::dismissActionError)
    AppScaffold(
        title = tr("nav_rooms"),
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
        floatingActionButton = {
            FloatingActionButton(onClick = { dialog = RoomDialog(null) }) {
                Icon(Icons.Outlined.Add, contentDescription = tr("rooms_create"))
            }
        },
    ) { padding ->
        when {
            state.loading -> LoadingBox(Modifier.padding(padding))
            error != null && state.rooms.isEmpty() -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            state.rooms.isEmpty() ->
                EmptyState(
                    title = tr("rooms_empty_title"),
                    body = tr("rooms_empty_body"),
                    icon = Icons.Outlined.MeetingRoom,
                    modifier = Modifier.padding(padding),
                )
            else ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    LazyColumn(contentPadding = PaddingValues(bottom = 88.dp)) {
                        items(state.rooms, key = { it.id }) { room ->
                            RoomRow(
                                room = room,
                                onOpen = { nav.navigate(Routes.room(room.id)) },
                                onEdit = { dialog = RoomDialog(room.id) },
                                onMove = { delta -> store.move(room.id, delta) },
                                onDelete = { deleting = room },
                            )
                        }
                    }
                }
        }
    }

    dialog?.let { RoomFormDialog(it.id, onDismiss = { dialog = null }) }
    deleting?.let { room ->
        ConfirmDialog(
            title = tr("rooms_delete_title"),
            text = tr("rooms_delete_description", "name" to room.name),
            confirmLabel = tr("common_delete"),
            destructive = true,
            onConfirm = {
                deleting = null
                store.delete(room.id)
            },
            onDismiss = { deleting = null },
        )
    }
}

@Composable
private fun RoomRow(
    room: RoomItem,
    onOpen: () -> Unit,
    onEdit: () -> Unit,
    onMove: (Int) -> Unit,
    onDelete: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    ListRow(
        title = room.name,
        subtitle = listOfNotNull(room.assetsText, room.tasksText).joinToString(" · "),
        leading = { RowIcon(roomIconVector(room.icon)) },
        trailing = {
            IconButton(onClick = { menu = true }) {
                Icon(Icons.Outlined.MoreVert, contentDescription = tr("rooms_actions", "name" to room.name))
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
                    text = { Text(tr("rooms_move_up_item")) },
                    leadingIcon = { Icon(Icons.Outlined.ArrowUpward, contentDescription = null) },
                    enabled = room.canMoveUp,
                    onClick = {
                        menu = false
                        onMove(-1)
                    },
                )
                DropdownMenuItem(
                    text = { Text(tr("rooms_move_down_item")) },
                    leadingIcon = { Icon(Icons.Outlined.ArrowDownward, contentDescription = null) },
                    enabled = room.canMoveDown,
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
        },
        onClick = onOpen,
    )
}

/** The dialog to create a room ([id] null) or edit one. */
@OptIn(ExperimentalLayoutApi::class, ExperimentalFoundationApi::class)
@Composable
internal fun RoomFormDialog(
    id: String?,
    onDismiss: () -> Unit,
) {
    val store = rememberStore(key = id ?: "new") { RoomEditStore(it, id) }
    val state = store.collect()
    val initial = state.initial
    var form by remember(initial) { mutableStateOf(initial) }
    androidx.compose.runtime.LaunchedEffect(state.savedId) { if (state.savedId != null) onDismiss() }
    val current = form
    FormDialog(
        title = tr(if (state.isNew) "rooms_create_title" else "rooms_edit_title"),
        onDismiss = onDismiss,
        onSave = { current?.let(store::save) },
        pending = state.saving || current == null,
    ) {
        if (current == null) {
            state.loadError?.let { InlineError(it.message) }
        } else {
            TextField(
                label = tr("rooms_name"),
                value = current.name,
                onChange = { form = current.copy(name = it) },
                error = state.fieldErrors["name"],
                capitalization = androidx.compose.ui.text.input.KeyboardCapitalization.Words,
            )
            Text(tr("rooms_icon"), style = androidx.compose.material3.MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                state.iconOptions.forEach { option ->
                    val selected = current.icon == option.name
                    FilledIconToggleButton(
                        checked = selected,
                        onCheckedChange = { form = current.copy(icon = if (selected) "" else option.name) },
                    ) {
                        Icon(roomIconVector(option.name), contentDescription = option.label)
                    }
                }
            }
            TextField(
                label = tr("rooms_notes"),
                value = current.notes,
                onChange = { form = current.copy(notes = it) },
                error = state.fieldErrors["notes"],
                hint = tr("rooms_notes_placeholder"),
                singleLine = false,
                minLines = 3,
                capitalization = androidx.compose.ui.text.input.KeyboardCapitalization.Sentences,
            )
            state.error?.let { InlineError(it.message) }
        }
    }
}
