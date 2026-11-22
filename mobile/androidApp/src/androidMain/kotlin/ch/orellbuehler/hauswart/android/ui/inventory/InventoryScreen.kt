package ch.orellbuehler.hauswart.android.ui.inventory

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.DirectionsCar
import androidx.compose.material.icons.outlined.Memory
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ChoiceField
import ch.orellbuehler.hauswart.android.ui.components.EmptyState
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.inventory.InventoryStore
import ch.orellbuehler.hauswart.i18n.tr

@Composable
fun InventoryScreen(nav: NavController) {
    val store = rememberStore { InventoryStore(it) }
    val state = store.collect()
    val error = state.error
    AppScaffold(
        title = tr("nav_inventory"),
        onBack = { nav.popBackStack() },
        actions = {
            IconButton(onClick = { nav.navigate(Routes.assetNew("vehicle")) }) {
                Icon(Icons.Outlined.DirectionsCar, contentDescription = tr("vehicle_create"))
            }
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { nav.navigate(Routes.assetNew("device")) }) {
                Icon(Icons.Outlined.Add, contentDescription = tr("inventory_create"))
            }
        },
    ) { padding ->
        when {
            state.loading -> LoadingBox(Modifier.padding(padding))
            error != null && state.assetCount == 0 -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            state.assetCount == 0 ->
                EmptyState(
                    title = tr("inventory_empty_title"),
                    body = tr("inventory_empty_body"),
                    icon = Icons.Outlined.Memory,
                    modifier = Modifier.padding(padding),
                )
            else ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    LazyColumn(contentPadding = PaddingValues(bottom = 88.dp)) {
                        item {
                            Column(
                                Modifier.padding(horizontal = ScreenPadding, vertical = 8.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                TextField(
                                    label = tr("inventory_search"),
                                    value = state.filter.query,
                                    onChange = store::search,
                                    hint = null,
                                    leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                                )
                                ChoiceField(
                                    label = tr("asset_room"),
                                    value = state.filter.roomId,
                                    options = state.roomOptions.pairs(),
                                    onChange = store::setRoom,
                                )
                                ChoiceField(
                                    label = tr("asset_kind"),
                                    value = state.filter.kind,
                                    options = state.kindOptions.pairs(),
                                    onChange = store::setKind,
                                )
                                ChoiceField(
                                    label = tr("asset_warranty"),
                                    value = state.filter.warranty,
                                    options = state.warrantyOptions.pairs(),
                                    onChange = store::setWarranty,
                                )
                                if (state.hasArchived) {
                                    Row(
                                        Modifier.fillMaxWidth(),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                                    ) {
                                        Switch(checked = state.filter.archived, onCheckedChange = store::setShowArchived)
                                        Text(
                                            tr("inventory_show_archived"),
                                            Modifier.weight(1f),
                                            style = MaterialTheme.typography.bodyMedium,
                                        )
                                    }
                                }
                            }
                        }
                        item {
                            Row(
                                Modifier.fillMaxWidth().padding(horizontal = ScreenPadding),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    state.countText,
                                    Modifier.weight(1f),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                if (state.filtered) {
                                    TextButton(onClick = store::resetFilter) { Text(tr("inventory_filter_reset"), maxLines = 1) }
                                }
                            }
                        }
                        if (state.rows.isEmpty()) {
                            item {
                                EmptyState(
                                    title = tr("inventory_no_results_title"),
                                    body = tr("inventory_no_results_body"),
                                    icon = Icons.Outlined.Search,
                                )
                            }
                        }
                        items(state.rows, key = { it.id }) { row ->
                            AssetListRow(row, onClick = { nav.navigate(Routes.asset(row.id)) })
                        }
                    }
                }
        }
    }
}
