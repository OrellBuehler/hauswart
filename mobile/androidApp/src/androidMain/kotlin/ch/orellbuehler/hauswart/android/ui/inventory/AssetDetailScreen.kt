package ch.orellbuehler.hauswart.android.ui.inventory

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Unarchive
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ConfirmDialog
import ch.orellbuehler.hauswart.android.ui.components.EmptyState
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.LabeledValue
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.inventory.AssetDetailStore
import ch.orellbuehler.hauswart.i18n.tr

@Composable
fun AssetDetailScreen(
    nav: NavController,
    id: String,
) {
    val store = rememberStore(key = id) { AssetDetailStore(it, id) }
    val state = store.collect()
    val asset = state.asset
    val error = state.error
    val snackbar = remember { SnackbarHostState() }
    var menu by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    LaunchedEffect(state.deleted) { if (state.deleted) nav.popBackStack() }
    NoticeEffect(state.notice.takeUnless { state.deleted }, snackbar, store::dismissNotice)
    ErrorEffect(state.actionError, snackbar, store::dismissActionError)
    AppScaffold(
        title = asset?.name ?: tr("nav_inventory"),
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
        actions = {
            if (asset != null) {
                IconButton(onClick = { nav.openAssetEdit(id) }) { Icon(Icons.Outlined.Edit, contentDescription = tr("common_edit")) }
                IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, contentDescription = tr("asset_actions")) }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(
                        text = { Text(tr(if (asset.archived) "asset_restore" else "asset_archive")) },
                        leadingIcon = {
                            Icon(
                                if (asset.archived) Icons.Outlined.Unarchive else Icons.Outlined.Archive,
                                contentDescription = null,
                            )
                        },
                        enabled = !state.busy,
                        onClick = {
                            menu = false
                            store.toggleArchive()
                        },
                    )
                    DropdownMenuItem(
                        text = { Text(tr("common_delete")) },
                        leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null) },
                        enabled = !state.busy,
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
            asset != null ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    Column(
                        Modifier.verticalScroll(rememberScrollState()).padding(ScreenPadding),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(asset.name, style = MaterialTheme.typography.headlineSmall)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    listOfNotNull(asset.kindLabel, asset.plate).joinToString(" · "),
                                    Modifier.weight(1f, fill = false),
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                if (asset.archived) StatusChip(tr("asset_archived"), icon = Icons.Outlined.Archive)
                            }
                            if (asset.roomId != null && asset.roomName != null) {
                                TextButton(onClick = { nav.navigate(Routes.room(asset.roomId!!)) }) {
                                    Text(asset.roomName!!, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                        AssetVehicleSection(id)
                        SectionCard(title = tr("asset_facts_title")) {
                            asset.warranty?.let { w ->
                                Column(
                                    Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                                    verticalArrangement = Arrangement.spacedBy(4.dp),
                                ) {
                                    Text(
                                        tr("asset_warranty"),
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                    StatusChip(w.label, tone = w.tone)
                                    w.daysText?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                                    asset.warrantyDetail?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                                    if (asset.warrantyFromDocument) {
                                        Text(tr("asset_warranty_from_document"), style = MaterialTheme.typography.bodySmall)
                                    }
                                }
                            }
                            asset.facts.forEach { LabeledValue(it.label, it.value) }
                            LabeledValue(tr("asset_emergency_short"), tr(if (asset.showOnEmergency) "common_yes" else "common_no"))
                            asset.notes?.let { LabeledValue(tr("asset_notes"), it) }
                        }
                        AddSection(tr("asset_tasks_title"), tr("asset_add_task"), onAdd = { nav.navigate(Routes.taskNew(id)) }) {
                            if (state.tasks.isEmpty()) EmptyState(tr("asset_tasks_empty_title"), tr("asset_tasks_empty_body"))
                            state.tasks.forEach { line -> TaskLineRow(line, onClick = { nav.navigate(Routes.task(line.id)) }) }
                        }
                        AssetNotesSection(nav, id, snackbar)
                        AssetHintsSection(nav, id, snackbar)
                        AssetContactsSection(nav, id, snackbar)
                        AssetPartsSection(nav, id, snackbar)
                        AssetServiceLogSection(nav, id, snackbar)
                        AssetExtras(id)
                    }
                }
            error != null -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            else -> LoadingBox(Modifier.padding(padding))
        }
    }

    if (confirmDelete && asset != null) {
        ConfirmDialog(
            title = tr("asset_delete_title"),
            text = tr("asset_delete_description", "name" to asset.name),
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
