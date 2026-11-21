package ch.orellbuehler.hauswart.android.ui.parts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Extension
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.ShoppingCart
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
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
import ch.orellbuehler.hauswart.android.ui.components.EmptyState
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.components.SwitchField
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.components.rememberUriOpener
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.parts.OrderNowRow
import ch.orellbuehler.hauswart.feature.parts.PartsListStore
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.launch

@Composable
fun PartsScreen(nav: NavController) {
    val store = rememberStore { PartsListStore(it) }
    val state = store.collect()
    val error = state.error
    val snackbar = remember { SnackbarHostState() }
    var creating by remember { mutableStateOf(false) }
    var nonce by remember { mutableIntStateOf(0) }
    val open = rememberUriOpener()
    val scope = rememberCoroutineScope()
    val cannotOpen = tr("m_cannot_open")
    val undoLabel = tr("common_undo")

    LaunchedEffect(state.notice) {
        val notice = state.notice ?: return@LaunchedEffect
        val undo = notice.undoPartId
        val result = snackbar.showSnackbar(notice.message, if (undo != null) undoLabel else null, duration = SnackbarDuration.Long)
        store.dismissNotice()
        if (result == SnackbarResult.ActionPerformed && undo != null) store.undoOrdered(undo)
    }
    LaunchedEffect(state.actionError) {
        state.actionError?.let {
            snackbar.showSnackbar(it.message)
            store.dismissActionError()
        }
    }

    AppScaffold(
        title = tr("nav_parts"),
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
        floatingActionButton = {
            FloatingActionButton(onClick = {
                nonce++
                creating = true
            }) { Icon(Icons.Outlined.Add, contentDescription = tr("parts_create")) }
        },
    ) { padding ->
        when {
            state.loading -> LoadingBox(Modifier.padding(padding))
            error != null && state.rows.isEmpty() && state.orderNow.isEmpty() ->
                ErrorBox(
                    error,
                    Modifier.padding(padding),
                    onRetry = store::refresh,
                )
            else ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    LazyColumn(contentPadding = PaddingValues(bottom = 88.dp)) {
                        if (state.orderNow.isNotEmpty()) {
                            item {
                                SectionCard(
                                    title = tr("order_now_title"),
                                    modifier = Modifier.padding(horizontal = ScreenPadding, vertical = 8.dp),
                                ) {
                                    Text(
                                        tr("order_now_description"),
                                        Modifier.padding(horizontal = 16.dp),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                    state.orderNow.forEach { item ->
                                        OrderNowItem(
                                            item,
                                            busy = state.busyPartId == item.partId,
                                            onOpenPart = { nav.navigate(Routes.part(item.partId)) },
                                            onOpenTask = { nav.navigate(Routes.task(item.taskId)) },
                                            onShop = { url -> if (!open(url)) scope.launch { snackbar.showSnackbar(cannotOpen) } },
                                            onOrdered = { store.markOrdered(item.partId) },
                                        )
                                    }
                                }
                            }
                        }
                        if (state.none) {
                            item {
                                EmptyState(
                                    tr("parts_empty_title"),
                                    tr("parts_empty_body"),
                                    icon = Icons.Outlined.Extension,
                                    action = {
                                        Button(onClick = {
                                            nonce++
                                            creating = true
                                        }) { Text(tr("parts_create"), maxLines = 1) }
                                    },
                                )
                            }
                        } else {
                            item {
                                Column(
                                    Modifier.padding(horizontal = ScreenPadding, vertical = 8.dp),
                                    verticalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    TextField(
                                        label = tr("parts_search"),
                                        value = state.query,
                                        onChange = store::search,
                                        leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                                    )
                                    Row(
                                        Modifier.fillMaxWidth(),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    ) {
                                        FilterChip(
                                            selected = state.lowOnly,
                                            onClick = { store.setLowOnly(!state.lowOnly) },
                                            label = {
                                                Text(
                                                    tr("parts_low_only") +
                                                        if (state.lowCount >
                                                            0
                                                        ) {
                                                            " (${state.lowCount})"
                                                        } else {
                                                            ""
                                                        },
                                                    maxLines = 1,
                                                )
                                            },
                                            leadingIcon = { Icon(Icons.Outlined.Warning, contentDescription = null) },
                                        )
                                        if (state.filtered) {
                                            TextButton(onClick = store::reset) { Text(tr("parts_filter_reset"), maxLines = 1) }
                                        }
                                    }
                                    if (state.hasArchived) {
                                        SwitchField(tr("parts_show_archived"), state.showArchived, store::setShowArchived)
                                    }
                                    Text(
                                        state.countText,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                            if (state.rows.isEmpty()) {
                                item {
                                    EmptyState(
                                        tr("parts_no_results_title"),
                                        tr("parts_no_results_body"),
                                        icon = Icons.Outlined.Search,
                                        action = { TextButton(onClick = store::reset) { Text(tr("parts_filter_reset")) } },
                                    )
                                }
                            }
                            items(state.rows, key = { it.id }) { row -> PartListRow(row) { nav.navigate(Routes.part(row.id)) } }
                        }
                    }
                }
        }
    }

    if (creating) {
        PartFormDialog(id = null, nonce = nonce, onDismiss = { creating = false }) { id ->
            creating = false
            nav.navigate(Routes.part(id))
        }
    }
}

@Composable
private fun OrderNowItem(
    item: OrderNowRow,
    busy: Boolean,
    onOpenPart: () -> Unit,
    onOpenTask: () -> Unit,
    onShop: (String) -> Unit,
    onOrdered: () -> Unit,
) {
    Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.weight(1f)) {
                TextButton(onClick = onOpenPart, contentPadding = PaddingValues(0.dp)) {
                    Text(item.partName, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleSmall)
                }
                TextButton(onClick = onOpenTask, contentPadding = PaddingValues(0.dp)) {
                    Text(tr("order_now_for_task") + " " + item.taskTitle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            Text(item.quantityText, style = MaterialTheme.typography.titleMedium)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(item.neededByText, style = MaterialTheme.typography.bodySmall)
            if (item.late) StatusChip(tr("order_now_late"), tone = "overdue")
        }
        if (item.late) Text(item.lateHint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            listOfNotNull(item.stockText, item.supplier, item.priceText).joinToString(" · "),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            item.shopUrl?.let { url ->
                OutlinedButton(onClick = { onShop(url) }) {
                    Icon(Icons.AutoMirrored.Outlined.OpenInNew, contentDescription = null)
                    Text(tr("order_now_shop"), maxLines = 1)
                }
            }
            Button(onClick = onOrdered, enabled = !busy) {
                Icon(if (busy) Icons.Outlined.ShoppingCart else Icons.Outlined.Check, contentDescription = null)
                Text(tr("order_now_ordered"), maxLines = 1)
            }
        }
    }
}
