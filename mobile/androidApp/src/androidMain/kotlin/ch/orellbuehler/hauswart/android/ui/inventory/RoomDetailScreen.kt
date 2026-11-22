package ch.orellbuehler.hauswart.android.ui.inventory

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.inventory.RoomDetailStore
import ch.orellbuehler.hauswart.i18n.tr

@Composable
fun RoomDetailScreen(
    nav: NavController,
    id: String,
) {
    val store = rememberStore(key = id) { RoomDetailStore(it, id) }
    val state = store.collect()
    val room = state.room
    val error = state.error
    val snackbar = remember { SnackbarHostState() }
    var editing by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    LaunchedEffect(state.deleted) { if (state.deleted) nav.popBackStack() }
    ErrorEffect(state.actionError, snackbar, store::dismissActionError)
    AppScaffold(
        title = room?.name ?: tr("nav_rooms"),
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
        actions = {
            if (room != null) {
                IconButton(onClick = { editing = true }) { Icon(Icons.Outlined.Edit, contentDescription = tr("common_edit")) }
                IconButton(onClick = { confirmDelete = true }, enabled = !state.deleting) {
                    Icon(Icons.Outlined.Delete, contentDescription = tr("common_delete"))
                }
            }
        },
    ) { padding ->
        when {
            room != null ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    Column(
                        Modifier.verticalScroll(rememberScrollState()).padding(ScreenPadding),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        Row(room.icon, room.name)
                        room.notes?.takeIf { it.isNotBlank() }?.let {
                            Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        AddSection(
                            title = tr("rooms_assets_title"),
                            addLabel = tr("m_room_new_asset"),
                            onAdd = { nav.navigate(Routes.assetNew("device", room.id)) },
                        ) {
                            if (state.assets.isEmpty()) {
                                EmptyState(tr("rooms_assets_empty_title"), tr("rooms_assets_empty_body"))
                            }
                            state.assets.forEach { row -> AssetListRow(row, onClick = { nav.navigate(Routes.asset(row.id)) }) }
                        }
                        ch.orellbuehler.hauswart.android.ui.components.SectionCard(title = tr("rooms_tasks_title")) {
                            if (state.tasks.isEmpty()) {
                                EmptyState(tr("rooms_tasks_empty_title"), tr("rooms_tasks_empty_body"))
                            }
                            state.tasks.forEach { line ->
                                TaskLineRow(line, showAsset = true, onClick = { nav.navigate(Routes.task(line.id)) })
                            }
                        }
                        RoomExtras(room.id)
                    }
                }
            error != null -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            else -> LoadingBox(Modifier.padding(padding))
        }
    }

    if (editing) RoomFormDialog(id, onDismiss = { editing = false })
    if (confirmDelete && room != null) {
        ConfirmDialog(
            title = tr("rooms_delete_title"),
            text = tr("rooms_delete_description", "name" to room.name),
            confirmLabel = tr("common_delete"),
            destructive = true,
            onConfirm = {
                confirmDelete = false
                store.delete()
            },
            onDismiss = { confirmDelete = false },
        )
    }
}

@Composable
private fun Row(
    icon: String?,
    name: String,
) {
    androidx.compose.foundation.layout.Row(
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
    ) {
        Icon(roomIconVector(icon), contentDescription = null)
        Text(name, style = MaterialTheme.typography.headlineSmall)
    }
}
