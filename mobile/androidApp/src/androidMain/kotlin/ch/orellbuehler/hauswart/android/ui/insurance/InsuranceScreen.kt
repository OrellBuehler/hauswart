package ch.orellbuehler.hauswart.android.ui.insurance

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
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
import ch.orellbuehler.hauswart.android.ui.components.EmptyState
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.RowIcon
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.insurance.INSURANCE_TYPES
import ch.orellbuehler.hauswart.feature.insurance.InsuranceListStore
import ch.orellbuehler.hauswart.feature.insurance.insuranceTypeLabel
import ch.orellbuehler.hauswart.i18n.tr

@Composable
fun InsuranceScreen(nav: NavController) {
    val store = rememberStore { InsuranceListStore(it) }
    val state = store.collect()
    val error = state.error
    AppScaffold(
        title = tr("nav_insurance"),
        onBack = { nav.popBackStack() },
        floatingActionButton = {
            FloatingActionButton(onClick = { nav.openInsuranceNew() }) {
                Icon(Icons.Outlined.Add, contentDescription = tr("insurance_new"))
            }
        },
    ) { padding ->
        when {
            state.loading -> LoadingBox(Modifier.padding(padding))
            error != null && !state.hasAny -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            !state.hasAny ->
                EmptyState(
                    tr("insurance_empty_title"),
                    tr("insurance_empty_body"),
                    Modifier.padding(padding),
                    Icons.Outlined.Shield,
                )
            else ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    LazyColumn(contentPadding = PaddingValues(bottom = 88.dp)) {
                        item {
                            Row(Modifier.padding(horizontal = ScreenPadding, vertical = 8.dp)) {
                                TextField(
                                    label = tr("insurance_search_label"),
                                    value = state.query,
                                    onChange = store::search,
                                    leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                                )
                            }
                        }
                        item {
                            Row(
                                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = ScreenPadding),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                FilterChip(
                                    selected = state.type.isEmpty(),
                                    onClick = { store.setType("") },
                                    label = { Text(tr("insurance_filter_type_all"), maxLines = 1) },
                                )
                                INSURANCE_TYPES.forEach { type ->
                                    FilterChip(
                                        selected = state.type == type,
                                        onClick = { store.setType(type) },
                                        label = { Text(insuranceTypeLabel(type), maxLines = 1) },
                                    )
                                }
                            }
                        }
                        if (state.hasArchived) {
                            item {
                                Row(
                                    Modifier.fillMaxWidth().padding(horizontal = ScreenPadding),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    Switch(checked = state.archived, onCheckedChange = store::setArchived)
                                    Text(tr("insurance_show_archived"), Modifier.weight(1f), maxLines = 1)
                                    if (state.filtered) {
                                        TextButton(onClick = store::resetFilters) { Text(tr("insurance_filter_reset"), maxLines = 1) }
                                    }
                                }
                            }
                        }
                        item {
                            Column(Modifier.padding(horizontal = ScreenPadding, vertical = 4.dp)) {
                                Text(
                                    listOf(
                                        tr("insurance_count", "count" to state.rows.size),
                                        state.total,
                                    ).filter { it.isNotEmpty() }.joinToString(" · "),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                if (state.otherCurrency.isNotEmpty()) {
                                    Text(
                                        state.otherCurrency,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                        if (state.rows.isEmpty()) {
                            item {
                                when {
                                    state.filtered ->
                                        EmptyState(
                                            tr("insurance_empty_filtered_title"),
                                            tr("insurance_empty_filtered_body"),
                                            icon = Icons.Outlined.Search,
                                        )
                                    state.archived ->
                                        EmptyState(
                                            tr("insurance_empty_archived_title"),
                                            tr("insurance_empty_archived_body"),
                                            icon = Icons.Outlined.Shield,
                                        )
                                    else ->
                                        EmptyState(
                                            tr("insurance_empty_title"),
                                            tr("insurance_empty_body"),
                                            icon = Icons.Outlined.Shield,
                                        )
                                }
                            }
                        }
                        items(state.rows, key = { it.id }) { row ->
                            ListRow(
                                title = row.title,
                                subtitle =
                                    listOf(
                                        row.subtitle,
                                        row.covers,
                                        row.deadline?.text.orEmpty(),
                                    ).filter { it.isNotEmpty() }.joinToString("\n"),
                                subtitleLines = 3,
                                leading = { RowIcon(Icons.Outlined.Shield) },
                                trailing = {
                                    Column(horizontalAlignment = Alignment.End) {
                                        Text(row.annual, style = MaterialTheme.typography.labelLarge, maxLines = 1)
                                        Text(
                                            tr("insurance_per_annual"),
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            maxLines = 1,
                                        )
                                        if (row.archived) StatusChip(tr("insurance_archived"))
                                    }
                                },
                                onClick = { nav.navigate(Routes.insurance(row.id)) },
                            )
                        }
                    }
                }
        }
    }
}
