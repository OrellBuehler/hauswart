package ch.orellbuehler.hauswart.android.ui.parts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.material.icons.outlined.LocalShipping
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Remove
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.components.rememberUriOpener
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.android.ui.sections.AttachmentsSection
import ch.orellbuehler.hauswart.android.ui.sections.CommentsSection
import ch.orellbuehler.hauswart.android.ui.sections.DocumentLinksSection
import ch.orellbuehler.hauswart.feature.parts.PartDetailStore
import ch.orellbuehler.hauswart.feature.parts.PartTaskLink
import ch.orellbuehler.hauswart.feature.parts.PartView
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.launch

private sealed interface Dialog {
    data object Edit : Dialog

    data class Stock(
        val reason: String,
        val qty: Long,
    ) : Dialog

    data object Ordered : Dialog

    data object LinkAsset : Dialog

    data object LinkTask : Dialog

    data class TaskQty(
        val link: PartTaskLink,
    ) : Dialog
}

@Composable
fun PartDetailScreen(
    nav: NavController,
    id: String,
) {
    val store = rememberStore(key = id) { PartDetailStore(it, id) }
    val state = store.collect()
    val view = state.view
    val error = state.error
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val open = rememberUriOpener()
    val cannotOpen = tr("m_cannot_open")
    var menu by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var dialog by remember { mutableStateOf<Dialog?>(null) }
    var nonce by remember { mutableIntStateOf(0) }
    val show: (Dialog) -> Unit = {
        nonce++
        dialog = it
    }

    LaunchedEffect(state.deleted) { if (state.deleted) nav.popBackStack() }
    LaunchedEffect(state.notice) {
        state.notice?.let {
            snackbar.showSnackbar(it.message)
            store.dismissNotice()
        }
    }
    LaunchedEffect(state.actionError) {
        state.actionError?.let {
            snackbar.showSnackbar(it.message)
            store.dismissActionError()
        }
    }

    AppScaffold(
        title = view?.name ?: tr("nav_parts"),
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
        actions = {
            if (view != null) {
                IconButton(onClick = { show(Dialog.Edit) }) { Icon(Icons.Outlined.Edit, contentDescription = tr("common_edit")) }
                IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, contentDescription = tr("part_actions")) }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(
                        text = { Text(tr(if (view.archived) "part_restore" else "part_archive")) },
                        enabled = !state.busy,
                        onClick = {
                            menu = false
                            store.toggleArchive()
                        },
                    )
                    DropdownMenuItem(
                        text = { Text(tr("common_delete"), color = MaterialTheme.colorScheme.error) },
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
            view != null ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    Column(
                        Modifier.verticalScroll(rememberScrollState()).padding(ScreenPadding),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(view.name, style = MaterialTheme.typography.headlineSmall)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                StatusChip(view.stockLabel, tone = view.stockTone)
                                view.orderedLabel?.let { StatusChip(it) }
                                if (view.archived) StatusChip(tr("part_archived"))
                            }
                        }
                        StockCard(view, state.busy, show, store::quick, store::clearOrder)
                        SectionCard(title = tr("part_movements_title")) {
                            if (state.movements.isEmpty()) {
                                Text(
                                    tr("part_movements_empty"),
                                    Modifier.padding(horizontal = 16.dp),
                                    style = MaterialTheme.typography.bodyMedium,
                                )
                            }
                            state.movements.forEach { movement ->
                                ListRow(
                                    title = movement.reasonLabel,
                                    subtitle = listOfNotNull(movement.byText, movement.note).joinToString("\n"),
                                    subtitleLines = 3,
                                    trailing = {
                                        val scheme = MaterialTheme.colorScheme
                                        val color = if (movement.positive) scheme.tertiary else scheme.onSurface
                                        Text(movement.deltaText, style = MaterialTheme.typography.titleMedium, color = color)
                                    },
                                )
                            }
                            if (state.moreMovements) {
                                TextButton(
                                    onClick = store::loadMore,
                                    enabled = !state.loadingMore,
                                    modifier = Modifier.padding(horizontal = 8.dp),
                                ) {
                                    if (state.loadingMore) CircularProgressIndicator(Modifier.padding(end = 8.dp), strokeWidth = 2.dp)
                                    Text(tr("common_load_more"), maxLines = 1)
                                }
                            }
                        }
                        SectionCard(title = tr("part_facts_title")) {
                            LabeledValue(tr("part_number"), view.partNumber)
                            LabeledValue(tr("part_supplier"), view.supplier)
                            LabeledValue(tr("part_unit_price"), view.priceText)
                            view.shopUrl?.let { url ->
                                OutlinedButton(
                                    onClick = { if (!open(url)) scope.launch { snackbar.showSnackbar(cannotOpen) } },
                                    modifier = Modifier.padding(horizontal = 16.dp),
                                ) {
                                    Icon(Icons.AutoMirrored.Outlined.OpenInNew, contentDescription = null)
                                    Text(tr("order_now_shop"), maxLines = 1)
                                }
                            }
                            view.notes?.let { LabeledValue(tr("part_notes"), it) }
                        }
                        SectionCard(title = tr("part_assets_title")) {
                            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.End) {
                                TextButton(onClick = { show(Dialog.LinkAsset) }) {
                                    Icon(Icons.Outlined.Add, contentDescription = null)
                                    Text(tr("part_link_add"), maxLines = 1)
                                }
                            }
                            if (view.assets.isEmpty()) EmptyState(tr("part_assets_empty_title"), tr("part_assets_empty_body"))
                            view.assets.forEach { asset ->
                                ListRow(
                                    title = asset.name,
                                    trailing = {
                                        IconButton(onClick = { store.unlinkAsset(asset.id) }, enabled = !state.busy) {
                                            Icon(Icons.Outlined.LinkOff, contentDescription = tr("part_unlink_aria", "name" to asset.name))
                                        }
                                    },
                                    onClick = { nav.navigate(Routes.asset(asset.id)) },
                                )
                            }
                        }
                        SectionCard(title = tr("part_tasks_title")) {
                            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.End) {
                                TextButton(onClick = { show(Dialog.LinkTask) }) {
                                    Icon(Icons.Outlined.Add, contentDescription = null)
                                    Text(tr("part_link_add"), maxLines = 1)
                                }
                            }
                            if (view.tasks.isEmpty()) EmptyState(tr("part_tasks_empty_title"), tr("part_tasks_empty_body"))
                            view.tasks.forEach { task ->
                                ListRow(
                                    title = task.title,
                                    trailing = {
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            TextButton(onClick = { show(Dialog.TaskQty(task)) }) { Text(task.qtyText, maxLines = 1) }
                                            IconButton(onClick = { store.unlinkTask(task.id) }, enabled = !state.busy) {
                                                Icon(
                                                    Icons.Outlined.LinkOff,
                                                    contentDescription =
                                                        tr(
                                                            "part_unlink_aria",
                                                            "name" to task.title,
                                                        ),
                                                )
                                            }
                                        }
                                    },
                                    onClick = { nav.navigate(Routes.task(task.id)) },
                                )
                            }
                        }
                        CommentsSection(ownerType = "part", ownerId = id)
                        AttachmentsSection(ownerType = "part", ownerId = id)
                        DocumentLinksSection(ownerType = "part", ownerId = id)
                    }
                }
            error != null -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            else -> LoadingBox(Modifier.padding(padding))
        }
    }

    when (val current = dialog) {
        Dialog.Edit -> PartFormDialog(id = id, nonce = nonce, onDismiss = { dialog = null }) { dialog = null }
        is Dialog.Stock -> PartStockDialog(id, current.reason, current.qty, nonce) { dialog = null }
        Dialog.Ordered -> PartOrderedDialog(id, nonce) { dialog = null }
        Dialog.LinkAsset -> PartAssetLinkDialog(id, nonce) { dialog = null }
        Dialog.LinkTask -> PartTaskLinkDialog(id, nonce) { dialog = null }
        is Dialog.TaskQty -> PartTaskQtyDialog(id, current.link.id, current.link.title, current.link.qty, nonce) { dialog = null }
        null -> Unit
    }
    if (confirmDelete && view != null) {
        ConfirmDialog(
            title = tr("part_delete_title"),
            text = view.deleteText,
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
private fun StockCard(
    view: PartView,
    busy: Boolean,
    show: (Dialog) -> Unit,
    quick: (Boolean) -> Unit,
    clearOrder: () -> Unit,
) {
    SectionCard(title = tr("part_stock_title")) {
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
                Text(view.stockCount.toString(), style = MaterialTheme.typography.displaySmall)
                Column(horizontalAlignment = Alignment.End) {
                    Text(tr("part_min_stock") + ": " + view.minStock, style = MaterialTheme.typography.bodySmall)
                    Text(tr("part_reorder_qty") + ": " + view.reorderQty, style = MaterialTheme.typography.bodySmall)
                    Text(tr("part_lead_time") + ": " + view.leadTimeDays, style = MaterialTheme.typography.bodySmall)
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { quick(true) }, enabled = !busy && view.canUseOne, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Outlined.Remove, contentDescription = null)
                    Text(tr("part_quick_used"), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                OutlinedButton(onClick = { quick(false) }, enabled = !busy, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Outlined.Add, contentDescription = null)
                    Text(tr("part_quick_bought"), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            TextButton(onClick = { show(Dialog.Stock("used", 1)) }) { Text(tr("part_stock_adjust"), maxLines = 1) }
            if (view.onOrder) {
                Text(view.onOrderText, style = MaterialTheme.typography.bodyMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { show(Dialog.Stock("bought", view.orderedQty)) }, enabled = !busy) {
                        Text(tr("part_order_arrived"), maxLines = 1)
                    }
                    TextButton(onClick = clearOrder, enabled = !busy) { Text(tr("part_order_clear"), maxLines = 1) }
                }
            } else {
                Text(
                    tr("part_not_ordered"),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedButton(onClick = { show(Dialog.Ordered) }) {
                    Icon(Icons.Outlined.LocalShipping, contentDescription = null)
                    Text(tr("part_mark_ordered"), maxLines = 1)
                }
            }
        }
    }
}
